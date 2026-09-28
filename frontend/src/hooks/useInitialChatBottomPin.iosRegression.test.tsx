/**
 * iOS regression test — first-install chat open should land at the bottom
 * with NO upward jolt.
 *
 * The historical bug: on a fresh install, the chat would reveal at bottom,
 * then late-loading avatars/attachment thumbnails would grow scrollHeight
 * AFTER reveal, visibly shifting content upward before the post-pin guards
 * snapped it back. Users experienced this as a "jolt".
 *
 * Fix under test: `useInitialChatBottomPin` now waits for in-flight images
 * inside the viewport to finish loading BEFORE flipping `isPinned` to true,
 * so the user only ever sees the chat already pinned to the true bottom.
 *
 * This test simulates iOS via userAgent override and reproduces the
 * cached-render → late-image-load sequence.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useRef } from "react";

import { useInitialChatBottomPin } from "./useInitialChatBottomPin";

const ORIGINAL_UA = navigator.userAgent;
const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function setIOSUserAgent() {
  Object.defineProperty(navigator, "userAgent", {
    value: IOS_UA,
    configurable: true,
  });
}

function restoreUserAgent() {
  Object.defineProperty(navigator, "userAgent", {
    value: ORIGINAL_UA,
    configurable: true,
  });
}

/** Build a fake scrollable viewport with a tall content child + N images. */
function buildFakeViewport(opts: {
  contentHeight: number;
  viewportHeight: number;
  imageCount: number;
}) {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientHeight", {
    configurable: true,
    get: () => opts.viewportHeight,
  });

  // Mutable scrollHeight — grows when images "load".
  let _scrollHeight = opts.contentHeight;
  Object.defineProperty(container, "scrollHeight", {
    configurable: true,
    get: () => _scrollHeight,
  });

  let _scrollTop = 0;
  Object.defineProperty(container, "scrollTop", {
    configurable: true,
    get: () => _scrollTop,
    set: (v: number) => {
      _scrollTop = Math.max(0, Math.min(v, _scrollHeight - opts.viewportHeight));
    },
  });

  const inner = document.createElement("div");
  container.appendChild(inner);

  const images: HTMLImageElement[] = [];
  for (let i = 0; i < opts.imageCount; i += 1) {
    const img = document.createElement("img");
    // Pretend the image hasn't decoded yet.
    Object.defineProperty(img, "complete", { configurable: true, value: false });
    Object.defineProperty(img, "naturalHeight", { configurable: true, value: 0 });
    inner.appendChild(img);
    images.push(img);
  }

  document.body.appendChild(container);

  return {
    container,
    images,
    growBy(px: number) {
      _scrollHeight += px;
    },
    getScrollTop: () => _scrollTop,
  };
}

interface HarnessProps {
  containerEl: HTMLElement;
  itemCount: number;
  onPinned: () => void;
}

function Harness({ containerEl, itemCount, onPinned }: HarnessProps) {
  const ref = useRef<HTMLElement>(containerEl);
  const { isPinned } = useInitialChatBottomPin({
    scrollContainerRef: ref,
    itemCount,
    resetKey: "thread-1",
    onPinned,
  });
  return <div data-testid="state" data-pinned={String(isPinned)} />;
}

describe("useInitialChatBottomPin — iOS first-install regression", () => {
  beforeEach(() => {
    setIOSUserAgent();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreUserAgent();
    document.body.innerHTML = "";
  });

  it("does not reveal until in-flight images load, then lands exactly at the bottom (no upward jolt)", async () => {
    const VIEWPORT_H = 600;
    const INITIAL_CONTENT_H = 2000;
    const fake = buildFakeViewport({
      contentHeight: INITIAL_CONTENT_H,
      viewportHeight: VIEWPORT_H,
      imageCount: 2,
    });

    const onPinned = vi.fn();
    render(
      <Harness containerEl={fake.container} itemCount={20} onPinned={onPinned} />,
    );

    // Drive the stability + settle phases.
    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    // Critical: must NOT have revealed yet — images are still pending.
    expect(onPinned).not.toHaveBeenCalled();

    // Simulate avatar/attachment hydration AFTER the would-be reveal point.
    // This is the exact sequence that caused the historical jolt.
    await act(async () => {
      fake.growBy(400);
      fake.images[0].dispatchEvent(new Event("load"));
      fake.growBy(250);
      fake.images[1].dispatchEvent(new Event("load"));
    });

    // Allow the post-image snap + reveal to flush.
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    expect(onPinned).toHaveBeenCalled();

    // No upward jolt: scrollTop must equal the maximum (true bottom),
    // computed against the FINAL grown scrollHeight — not the initial one.
    const finalMaxScroll = 2000 + 400 + 250 - VIEWPORT_H;
    expect(fake.getScrollTop()).toBe(finalMaxScroll);
  });

  it("falls back to revealing within the image-wait cap if an image never loads", async () => {
    const fake = buildFakeViewport({
      contentHeight: 1500,
      viewportHeight: 600,
      imageCount: 1,
    });

    const onPinned = vi.fn();
    render(
      <Harness containerEl={fake.container} itemCount={10} onPinned={onPinned} />,
    );

    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(onPinned).not.toHaveBeenCalled();

    // Image never fires load — cap should release reveal (~600ms).
    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(onPinned).toHaveBeenCalled();
    expect(fake.getScrollTop()).toBe(1500 - 600);
  });
});
