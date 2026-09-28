import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ safeOpenUrl: vi.fn() }));
vi.mock("@/lib/safeOpenUrl", () => ({ safeOpenUrl: mocks.safeOpenUrl }));

import { MessageActionSheet } from "./MessageActionSheet";

function props(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    isOwn: true,
    canReply: true,
    canEdit: true,
    canDelete: true,
    messageText: "Hello team",
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onReport: vi.fn(),
    onBlock: vi.fn(),
    ...overrides,
  };
}

async function openMore() {
  fireEvent.click(screen.getByRole("button", { name: "More…" }));
  await screen.findByRole("button", { name: "Back" });
}

describe("MessageActionSheet characterization — permissions and safety actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders nothing when the caller grants no action", () => {
    render(<MessageActionSheet {...props({
      canReply: false,
      canEdit: false,
      canDelete: false,
      messageText: "",
    })} />);
    expect(screen.queryByText("Message Actions")).not.toBeInTheDocument();
  });

  it("shows only actions explicitly granted by the caller", async () => {
    render(<MessageActionSheet {...props({ canEdit: false, canDelete: false })} />);
    expect(screen.getByRole("button", { name: "Reply" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    await openMore();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("dispatches a granted delete exactly once after closing the sheet", async () => {
    const actionProps = props();
    render(<MessageActionSheet {...actionProps} />);
    await openMore();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(actionProps.onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(actionProps.onDelete).toHaveBeenCalledOnce());
  });

  it("never exposes or dispatches deletion when the caller denies moderation", async () => {
    const onDelete = vi.fn();
    render(<MessageActionSheet {...props({ canDelete: false, onDelete })} />);
    await openMore();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("never offers report or block for the current user's own message", async () => {
    render(<MessageActionSheet {...props({ isOwn: true })} />);
    await openMore();
    expect(screen.queryByRole("button", { name: "Report Message" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Block User" })).not.toBeInTheDocument();
  });

  it("offers report and block for another user's ordinary message", async () => {
    render(<MessageActionSheet {...props({ isOwn: false })} />);
    await openMore();
    expect(screen.getByRole("button", { name: "Report Message" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Block User" })).toBeInTheDocument();
  });

  it("never offers report or block for system messages", async () => {
    render(<MessageActionSheet {...props({ isOwn: false, isSystemMessage: true })} />);
    await openMore();
    expect(screen.queryByRole("button", { name: "Report Message" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Block User" })).not.toBeInTheDocument();
  });

  it.each([
    ["Reply", "onReply"],
    ["Edit", "onEdit"],
  ])("closes before dispatching the %s action", async (label, callbackName) => {
    const actionProps = props();
    render(<MessageActionSheet {...actionProps} />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(actionProps.onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(actionProps[callbackName as keyof typeof actionProps]).toHaveBeenCalledOnce());
  });

  it("gates forwarding on both permission and a callback", async () => {
    const onForward = vi.fn();
    const { rerender } = render(<MessageActionSheet {...props({ canForward: false, onForward })} />);
    await openMore();
    expect(screen.queryByRole("button", { name: "Forward" })).not.toBeInTheDocument();

    rerender(<MessageActionSheet {...props({ canForward: true, onForward })} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await openMore();
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(onForward).toHaveBeenCalledOnce());
  });

  it("does not offer gallery publication without an image", async () => {
    render(<MessageActionSheet {...props({ canPublishToGallery: true, hasImage: false, onPublishToGallery: vi.fn() })} />);
    await openMore();
    expect(screen.queryByRole("button", { name: /publish to gallery/i })).not.toBeInTheDocument();
  });

  it("opens only the selected image and keeps gallery publication as a separate action", async () => {
    const onViewImage = vi.fn();
    const onPublishToGallery = vi.fn();
    render(<MessageActionSheet {...props({
      hasImage: true,
      onViewImage,
      canPublishToGallery: true,
      onPublishToGallery,
    })} />);
    await openMore();
    fireEvent.click(screen.getByRole("button", { name: "View Image" }));
    await waitFor(() => expect(onViewImage).toHaveBeenCalledOnce());
    expect(onPublishToGallery).not.toHaveBeenCalled();
  });

  it("prevents repeat publication while an image is publishing or already published", async () => {
    const onPublish = vi.fn();
    const { rerender } = render(<MessageActionSheet {...props({
      hasImage: true,
      canPublishToGallery: true,
      isPublishingToGallery: true,
      onPublishToGallery: onPublish,
    })} />);
    await openMore();
    fireEvent.click(screen.getByRole("button", { name: "Publishing…" }));
    expect(onPublish).not.toHaveBeenCalled();

    rerender(<MessageActionSheet {...props({
      hasImage: true,
      canPublishToGallery: true,
      isPublishedToGallery: true,
      onPublishToGallery: onPublish,
    })} />);
    await openMore();
    fireEvent.click(screen.getByRole("button", { name: "Published to Gallery" }));
    expect(onPublish).not.toHaveBeenCalled();
  });

  it("normalizes a bare domain before opening it", async () => {
    render(<MessageActionSheet {...props({ messageText: "Details at riversidefc.com.au/events" })} />);
    await openMore();
    fireEvent.click(screen.getByRole("button", { name: "Open Link" }));
    await waitFor(() => expect(mocks.safeOpenUrl).toHaveBeenCalledWith("https://riversidefc.com.au/events"));
  });
});
