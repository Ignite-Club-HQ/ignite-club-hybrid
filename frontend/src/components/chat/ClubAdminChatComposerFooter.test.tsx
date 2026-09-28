import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClubAdminChatComposerFooter } from "./ClubAdminChatComposerFooter";

vi.mock("@/components/chat/TypingIndicator", () => ({
  TypingIndicator: ({ typingUsers }: any) => <div>Typing: {typingUsers.length}</div>,
}));
vi.mock("@/components/chat/ReplyPreview", () => ({
  ReplyPreview: ({ replyingTo, onCancel }: any) =>
    replyingTo ? (
      <div>
        <span>Replying to {replyingTo.text}</span>
        <button onClick={onCancel}>Cancel reply</button>
      </div>
    ) : null,
}));
vi.mock("@/components/chat/EditingBanner", () => ({
  EditingBanner: ({ text, onCancel }: any) => (
    <div>
      <span>Editing {text}</span>
      <button onClick={onCancel}>Cancel edit</button>
    </div>
  ),
}));
vi.mock("@/components/chat/ScheduledMessagesBanner", () => ({
  ScheduledMessagesBanner: ({ target }: any) => <div>Scheduled for {String(target?.chat_type ?? "target")}</div>,
}));
vi.mock("@/components/chat/ChatComposerShell", () => ({
  ChatComposerShell: ({ children, preview }: any) => (
    <div>
      {preview}
      {children}
    </div>
  ),
}));
vi.mock("@/components/chat/PollAttachmentPreview", () => ({
  PollAttachmentPreview: ({ pollId, onRemove }: any) => (
    <div>
      <span>Poll preview {pollId}</span>
      <button onClick={onRemove}>Remove poll</button>
    </div>
  ),
}));
vi.mock("@/components/chat/ChatImageInput", () => ({
  ChatImageInput: ({ onAppendToken }: any) => (
    <div>
      <button onClick={() => onAppendToken("[vault:1]")}>Append vault token</button>
    </div>
  ),
}));
vi.mock("@/components/chat/MentionInput", () => ({
  MentionInput: ({ value, onChange, onKeyPress, onGifSelect }: any) => (
    <div>
      <input aria-label="message" value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyPress} />
      <button onClick={() => onGifSelect("gif.png")}>Select gif</button>
    </div>
  ),
}));
vi.mock("@/components/chat/ChatSendButton", () => ({
  ChatSendButton: ({ onSend, onSchedule, canSend }: any) => (
    <div>
      <button onClick={onSend} disabled={!canSend}>
        Send
      </button>
      {onSchedule && <button onClick={onSchedule}>Schedule</button>}
    </div>
  ),
}));
vi.mock("@/components/chat/ScheduleMessageDialog", () => ({
  ScheduleMessageDialog: ({ open, onOpenChange, onScheduled }: any) =>
    open ? (
      <div>
        <span>Schedule dialog</span>
        <button onClick={onScheduled}>Confirm schedule</button>
        <button onClick={() => onOpenChange(false)}>Close schedule dialog</button>
      </div>
    ) : null,
}));
vi.mock("@/components/chat/CreatePollDialog", () => ({
  CreatePollDialog: ({ open, onCreated }: any) =>
    open ? (
      <div>
        <button onClick={() => onCreated("poll-1")}>Create poll</button>
      </div>
    ) : null,
}));

function baseProps(overrides: Partial<Parameters<typeof ClubAdminChatComposerFooter>[0]> = {}) {
  return {
    composerRef: { current: null },
    searchOpen: false,
    nativeKbHeight: 0,
    typingUsers: [],
    replyTo: null,
    onCancelReply: vi.fn(),
    editingMessage: null,
    onCancelEdit: vi.fn(),
    scheduleTarget: null,
    scheduleDialogOpen: false,
    onScheduleDialogOpenChange: vi.fn(),
    onScheduled: vi.fn(),
    pendingPollId: null,
    onPendingPollIdChange: vi.fn(),
    isSending: false,
    imageUrl: null,
    onImageUploaded: vi.fn(),
    clubId: "club-1",
    clubAdminMemberUserId: "member-1",
    message: "",
    onMessageChange: vi.fn(),
    onStartTyping: vi.fn(),
    onStopTyping: vi.fn(),
    onKeyPress: vi.fn(),
    onSend: vi.fn(),
    conversationId: "conversation-1",
    pollDialogOpen: false,
    onPollDialogOpenChange: vi.fn(),
    ...overrides,
  } as any;
}

describe("ClubAdminChatComposerFooter", () => {
  it("shows the reply preview and clears it on cancel", () => {
    const onCancelReply = vi.fn();
    render(
      <ClubAdminChatComposerFooter
        {...baseProps({ replyTo: { id: "m1", text: "Hello", author: { display_name: "Jo" } }, onCancelReply })}
      />,
    );
    expect(screen.getByText("Replying to Hello")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel reply"));
    expect(onCancelReply).toHaveBeenCalledTimes(1);
  });

  it("shows the editing banner and clears it on cancel", () => {
    const onCancelEdit = vi.fn();
    render(<ClubAdminChatComposerFooter {...baseProps({ editingMessage: { id: "m1", text: "Edit me" }, onCancelEdit })} />);
    expect(screen.getByText("Editing Edit me")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel edit"));
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it("removes a pending poll attachment preview", () => {
    const onPendingPollIdChange = vi.fn();
    render(<ClubAdminChatComposerFooter {...baseProps({ pendingPollId: "poll-1", onPendingPollIdChange })} />);
    fireEvent.click(screen.getByText("Remove poll"));
    expect(onPendingPollIdChange).toHaveBeenCalledWith(null);
  });

  it("appends a token with or without a leading space", () => {
    const onMessageChange = vi.fn();
    const { rerender } = render(<ClubAdminChatComposerFooter {...baseProps({ message: "", onMessageChange })} />);
    fireEvent.click(screen.getByText("Append vault token"));
    expect(onMessageChange).toHaveBeenCalledWith("[vault:1]");

    rerender(<ClubAdminChatComposerFooter {...baseProps({ message: "hi", onMessageChange })} />);
    fireEvent.click(screen.getByText("Append vault token"));
    expect(onMessageChange).toHaveBeenCalledWith("hi [vault:1]");
  });

  it("wires message typing to start/stop typing callbacks", () => {
    const onMessageChange = vi.fn();
    const onStartTyping = vi.fn();
    const onStopTyping = vi.fn();
    render(<ClubAdminChatComposerFooter {...baseProps({ onMessageChange, onStartTyping, onStopTyping })} />);
    fireEvent.change(screen.getByLabelText("message"), { target: { value: "hey" } });
    expect(onMessageChange).toHaveBeenCalledWith("hey");
    expect(onStartTyping).toHaveBeenCalledTimes(1);
    expect(onStopTyping).not.toHaveBeenCalled();
  });

  it("stops typing and sends on send button click", () => {
    const onStopTyping = vi.fn();
    const onSend = vi.fn();
    render(<ClubAdminChatComposerFooter {...baseProps({ message: "hi", onStopTyping, onSend })} />);
    fireEvent.click(screen.getByText("Send"));
    expect(onStopTyping).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("shows schedule controls only when a schedule target exists", () => {
    const { rerender } = render(<ClubAdminChatComposerFooter {...baseProps({ scheduleTarget: null })} />);
    expect(screen.queryByText("Schedule")).not.toBeInTheDocument();

    const onScheduleDialogOpenChange = vi.fn();
    rerender(
      <ClubAdminChatComposerFooter
        {...baseProps({
          scheduleTarget: { chat_type: "club_admin", conversation_id: "conversation-1" },
          onScheduleDialogOpenChange,
        })}
      />,
    );
    fireEvent.click(screen.getByText("Schedule"));
    expect(onScheduleDialogOpenChange).toHaveBeenCalledWith(true);
  });

  it("renders the schedule dialog and forwards onScheduled", () => {
    const onScheduled = vi.fn();
    render(
      <ClubAdminChatComposerFooter
        {...baseProps({
          scheduleTarget: { chat_type: "club_admin", conversation_id: "conversation-1" },
          scheduleDialogOpen: true,
          onScheduled,
        })}
      />,
    );
    fireEvent.click(screen.getByText("Confirm schedule"));
    expect(onScheduled).toHaveBeenCalledTimes(1);
  });

  it("renders the poll dialog only when a conversation id is present and forwards onCreated", () => {
    const onPendingPollIdChange = vi.fn();
    render(
      <ClubAdminChatComposerFooter
        {...baseProps({ pollDialogOpen: true, onPendingPollIdChange, conversationId: "conversation-1" })}
      />,
    );
    fireEvent.click(screen.getByText("Create poll"));
    expect(onPendingPollIdChange).toHaveBeenCalledWith("poll-1");
  });

  it("does not render the poll dialog without a conversation id", () => {
    render(<ClubAdminChatComposerFooter {...baseProps({ pollDialogOpen: true, conversationId: undefined })} />);
    expect(screen.queryByText("Create poll")).not.toBeInTheDocument();
  });
});
