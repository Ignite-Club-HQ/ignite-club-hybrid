import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PinnedMessagesBanner } from "./PinnedMessagesBanner";

vi.mock("@/lib/haptics", () => ({ hapticSelectionTick: vi.fn() }));

const pin = (id: string, text: string) => ({
  id: `pin-${id}`,
  message_id: id,
  text,
  image_url: null,
  author_name: "Alex Member",
  author_avatar: null,
  pinned_at: "2026-07-27T00:00:00.000Z",
  pinned_by: "user-1",
  chat_id: "team-1",
  chat_type: "team" as const,
});

afterEach(cleanup);

describe("PinnedMessagesBanner", () => {
  it("jumps directly to the only pinned message", () => {
    const onJump = vi.fn();
    render(<PinnedMessagesBanner pins={[pin("message-1", "Important update") as any]} onJumpToMessage={onJump} />);

    fireEvent.click(screen.getByRole("button", { name: "Jump to pinned message" }));
    expect(onJump).toHaveBeenCalledWith("message-1");
  });

  it("opens the pin list and jumps to the selected message, not merely the newest pin", () => {
    const onJump = vi.fn();
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    render(
      <PinnedMessagesBanner
        pins={[pin("message-new", "Newest"), pin("message-old", "Older target")] as any}
        onJumpToMessage={onJump}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View 2 pinned messages" }));
    fireEvent.click(screen.getByRole("button", { name: /Older target/ }));
    expect(onJump).toHaveBeenCalledWith("message-old");
    raf.mockRestore();
  });

  it("requires confirmation before unpinning and never turns unpin into a jump", () => {
    const onJump = vi.fn();
    const onUnpin = vi.fn();
    render(
      <PinnedMessagesBanner
        pins={[pin("message-1", "Keep this") as any]}
        onJumpToMessage={onJump}
        onUnpin={onUnpin}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Unpin message" }));
    expect(onUnpin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Unpin" }));
    expect(onUnpin).toHaveBeenCalledWith("message-1");
    expect(onJump).not.toHaveBeenCalled();
  });
});
