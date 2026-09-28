import { describe, it, expect, vi } from "vitest";
import { createRef, type ReactNode } from "react";
import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  VirtualizedChatMessageList,
  type VirtualizedChatMessageListHandle,
} from "./VirtualizedChatMessageList";

function withQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

const renderItem = (m: any) => <div key={m.id}>{m.id}</div>;

const baseProps = {
  hasOlder: false,
  isLoadingOlder: false,
  onLoadOlder: () => {},
  renderItem,
} as const;

/**
 * Regression guard for the Android team/club chat notification crash:
 *
 *   "Cannot read properties of undefined (reading 'index')"
 *
 * Root cause: on a notification cold-start the React Query cache is empty for
 * ~200–800ms while the fetch resolves. During that window the chat page used
 * to mount <Virtuoso> against `messages=[]` and pass scroll commands at
 * indices that didn't exist, so Virtuoso's internal `range` was undefined
 * when it tried to read `.index` → white screen.
 *
 * The fix:
 *  1. The Virtuoso tree is conditionally rendered behind `messages.length > 0`.
 *  2. Imperative `scrollToIndex` / `scrollToBottom` calls early-return when
 *     the list is empty (`safeScrollToIndex`).
 *
 * These tests assert both invariants without needing a Capacitor device.
 * They will fail if a future edit re-introduces an unconditional Virtuoso
 * mount or a raw `scrollToIndex` against an empty list.
 */
describe("VirtualizedChatMessageList — empty/cold-start guards", () => {
  it("renders with messages=[] without throwing (Virtuoso mount is gated)", () => {
    const ref = createRef<VirtualizedChatMessageListHandle>();
    expect(() =>
      render(withQuery(<VirtualizedChatMessageList ref={ref} messages={[]} {...baseProps} />)),
    ).not.toThrow();
  });

  it("imperative scroll commands no-op safely on an empty list", () => {
    // Fake timers here (matching the "cold-open" test below) so that any
    // Virtuoso-internal scroll-settle frame chain triggered by these
    // imperative calls is deterministically drained inside this test's own
    // boundary instead of continuing on real timers after the test (and
    // this file's) run has finished - a real leaked chain can eventually hit
    // `requestAnimationFrame is not defined` once Vitest recycles the
    // jsdom environment for a later, unrelated test file.
    vi.useFakeTimers();
    try {
      const ref = createRef<VirtualizedChatMessageListHandle>();
      render(withQuery(<VirtualizedChatMessageList ref={ref} messages={[]} {...baseProps} />));

      expect(() => {
        act(() => {
          ref.current?.scrollToBottom?.("auto");
          ref.current?.scrollToIndex?.(0);
          ref.current?.scrollToIndex?.(999);
          ref.current?.scrollToMessageId?.("does-not-exist");
        });
      }).not.toThrow();

      act(() => {
        vi.runAllTimers();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("isAtBottom / isNearBottom are safe to query before any messages mount", () => {
    const ref = createRef<VirtualizedChatMessageListHandle>();
    render(withQuery(<VirtualizedChatMessageList ref={ref} messages={[]} {...baseProps} />));

    expect(() => {
      ref.current?.isAtBottom?.();
      ref.current?.isNearBottom?.(120);
    }).not.toThrow();
  });

  it("transitioning from empty → populated messages does not throw", () => {
    // Drain Virtuoso's RAF-driven settle chain inside this test boundary.
    vi.useFakeTimers();
    try {
      const ref = createRef<VirtualizedChatMessageListHandle>();
      const { rerender } = render(
        withQuery(<VirtualizedChatMessageList ref={ref} messages={[]} {...baseProps} />),
      );

      const messages = Array.from({ length: 20 }, (_, i) => ({
        id: `m${i}`,
        text: `msg ${i}`,
        author_id: "u1",
        created_at: new Date(Date.now() - (20 - i) * 60_000).toISOString(),
      }));

      expect(() =>
        rerender(
          withQuery(<VirtualizedChatMessageList ref={ref} messages={messages} {...baseProps} />),
        ),
      ).not.toThrow();

      act(() => {
        vi.runAllTimers();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("notification cold-start: initialTargetMessageId on an empty list does not crash", () => {
    // Simulates a push payload arriving before the fetch resolves — one of
    // the exact paths that produced "Cannot read properties of undefined".
    const ref = createRef<VirtualizedChatMessageListHandle>();
    expect(() =>
      render(
        withQuery(
          <VirtualizedChatMessageList
            ref={ref}
            messages={[]}
            initialTargetMessageId="not-loaded-yet"
            {...baseProps}
          />,
        ),
      ),
    ).not.toThrow();
  });
  /**
   * Regression guard for "chat thread moves up and down after skeleton
   * reveal" (cold open of group/committee chats):
   *
   * Root cause: the list mounts EMPTY (React Query cache cold), the empty
   * branch's 700ms grace reveals the empty state, and that reveal armed the
   * one-way `hasRevealedOnceRef` latch. When the real messages landed
   * (>700ms fetch — normal on cold start), `armRevealMask()` was disarmed, so
   * the whole bottom-pin stabilisation sequence (immediate/raf/stability/
   * settle pins + Virtuoso's end-align park → true-maxTop correction) played
   * out VISIBLY for seconds.
   *
   * Invariant: an empty-state reveal must NOT disarm re-masking — the latch
   * may only arm once content (messages.length > 0) has actually painted.
   */
  it("cold-open: an empty-state reveal must NOT disarm re-masking when messages land", () => {
    vi.useFakeTimers();
    try {
      const ref = createRef<VirtualizedChatMessageListHandle>();
      const { rerender, container } = render(
        withQuery(<VirtualizedChatMessageList ref={ref} messages={[]} {...baseProps} />),
      );

      // Empty branch: the 700ms grace reveals the EMPTY thread (in the real
      // app the page-level skeleton is still covering the list at this point).
      act(() => {
        vi.advanceTimersByTime(900);
      });

      // The cold fetch resolves AFTER the grace — the regression window.
      const messages = Array.from({ length: 30 }, (_, i) => ({
        id: `m${i}`,
        text: `msg ${i}`,
        author_id: "u1",
        created_at: new Date(Date.now() - (30 - i) * 60_000).toISOString(),
      }));
      rerender(
        withQuery(<VirtualizedChatMessageList ref={ref} messages={messages} {...baseProps} />),
      );

      // The reveal mask MUST be re-armed (content wrapper back to opacity 0)
      // so the pin/stabilise sequence runs behind the skeleton.
      const findMaskedWrapper = () =>
        Array.from(container.querySelectorAll<HTMLElement>("div")).find(
          (el) => el.style.opacity === "0" && el.style.position === "relative",
        );
      expect(findMaskedWrapper()).toBeTruthy();

      // And the mask must eventually lift on its own (reveal deadline +
      // settle budget), never leaving the thread permanently hidden.
      act(() => {
        vi.advanceTimersByTime(7000);
      });
      expect(findMaskedWrapper()).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

// Silence noisy Virtuoso ResizeObserver warnings that jsdom can't fulfil.
vi.spyOn(console, "error").mockImplementation((msg, ...rest) => {
  if (typeof msg === "string" && /ResizeObserver|act\(\)/.test(msg)) return;
  // eslint-disable-next-line no-console
  console.warn(msg, ...rest);
});
