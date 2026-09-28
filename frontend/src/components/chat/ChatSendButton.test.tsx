import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ haptic: vi.fn() }));

vi.mock("@/lib/haptics", () => ({ hapticSelectionTick: mocks.haptic }));

import { ChatSendButton } from "./ChatSendButton";

describe("ChatSendButton visibility and send contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("remains rendered and discoverable while an empty message is disabled", () => {
    render(<ChatSendButton onSend={vi.fn()} disabled canSend={false} />);
    const send = screen.getByRole("button", { name: "Send message" });
    expect(send).toBeVisible();
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute("data-chat-send-button", "true");
  });

  it("uses the scheduling-aware accessible name without hiding the send action", () => {
    render(<ChatSendButton onSend={vi.fn()} onSchedule={vi.fn()} disabled canSend={false} />);
    expect(screen.getByRole("button", { name: "Send message (hold to schedule)" })).toBeVisible();
  });

  it("sends exactly once for a normal click", () => {
    const onSend = vi.fn();
    render(<ChatSendButton onSend={onSend} canSend />);
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(mocks.haptic).toHaveBeenCalledTimes(1);
  });

  it("coalesces rapid clicks into one send gesture", () => {
    const onSend = vi.fn();
    render(<ChatSendButton onSend={onSend} canSend />);
    const send = screen.getByRole("button", { name: "Send message" });

    fireEvent.click(send);
    fireEvent.click(send);
    fireEvent.click(send);

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(mocks.haptic).toHaveBeenCalledTimes(1);
  });

  it("supports keyboard activation through the semantic button", () => {
    const onSend = vi.fn();
    render(<ChatSendButton onSend={onSend} canSend />);
    const send = screen.getByRole("button", { name: "Send message" });
    send.focus();
    fireEvent.keyDown(send, { key: "Enter" });
    fireEvent.click(send);
    expect(send).toHaveFocus();
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("does not send while disabled or loading", () => {
    const disabledSend = vi.fn();
    const { rerender } = render(<ChatSendButton onSend={disabledSend} disabled canSend={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(disabledSend).not.toHaveBeenCalled();

    rerender(<ChatSendButton onSend={disabledSend} loading canSend />);
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(disabledSend).not.toHaveBeenCalled();
  });

  it("rejects a swipe that ends on the button instead of treating it as send", () => {
    const onSend = vi.fn();
    render(<ChatSendButton onSend={onSend} canSend />);
    const send = screen.getByRole("button", { name: "Send message" });
    fireEvent.pointerDown(send, { clientX: 0, clientY: 0 });
    fireEvent.pointerUp(send, { clientX: 40, clientY: 0 });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("keeps the fixed 40px hit target and cannot shrink out of the composer", () => {
    render(<ChatSendButton onSend={vi.fn()} canSend />);
    const send = screen.getByRole("button", { name: "Send message" });
    expect(send.className).toContain("h-10");
    expect(send.className).toContain("w-10");
    expect(send.className).toContain("shrink-0");
  });
});
