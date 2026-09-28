import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TeamChatComposerFooter } from "./TeamChatComposerFooter";

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
  ScheduledMessagesBanner: ({ target }: any) => <div>Scheduled for {String(target?.sendAt ?? "target")}</div>,
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
vi.mock("@/components/chat/NewsAttachmentPreview", () => ({
  NewsAttachmentPreview: ({ newsId, onRemove }: any) => (
    <div>
      <span>News preview {newsId}</span>
      <button onClick={onRemove}>Remove news</button>
    </div>
  ),
}));
vi.mock("@/components/chat/ChatImageInput", () => ({
  ChatImageInput: ({ onEventSelect, onNewsSelect, onPollCreate, onBoardPick, onAppendToken }: any) => (
    <div>
      <button onClick={onEventSelect}>Open event picker</button>
      <button onClick={onNewsSelect}>Open news picker</button>
      <button onClick={onPollCreate}>Open poll dialog</button>
      <button onClick={onBoardPick}>Open board picker</button>
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
vi.mock("@/components/chat/ChatAttachmentPickers", () => ({
  ChatAttachmentPickers: ({ onSelectEvent, onSelectNews, onSelectBoard }: any) => (
    <div>
      <button onClick={() => onSelectEvent("event-1")}>Select event</button>
      <button onClick={() => onSelectNews("news-1")}>Select news</button>
      <button onClick={() => onSelectBoard("board-1")}>Select board</button>
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

function baseProps(overrides: Partial<Parameters<typeof TeamChatComposerFooter>[0]> = {}) {
  return {
    composerRef: { current: null },
    searchOpen: false,
    nativeKbHeight: 0,
    typingUsers: [],
    replyingTo: null,
    onCancelReply: vi.fn(),
    editingMessage: null,
    onCancelEdit: vi.fn(),
    scheduleTarget: null,
    scheduleDialogOpen: false,
    onScheduleDialogOpenChange: vi.fn(),
    onScheduled: vi.fn(),
    pendingPollId: null,
    onPendingPollIdChange: vi.fn(),
    pendingNewsId: null,
    onPendingNewsIdChange: vi.fn(),
    isSending: false,
    imageUrl: null,
    onImageUploaded: vi.fn(),
    clubId: "club-1",
    teamId: "team-1",
    eventPickerOpen: false,
    onEventPickerOpenChange: vi.fn(),
    newsPickerOpen: false,
    onNewsPickerOpenChange: vi.fn(),
    boardPickerOpen: false,
    onBoardPickerOpenChange: vi.fn(),
    pollDialogOpen: false,
    onPollDialogOpenChange: vi.fn(),
    message: "",
    onMessageChange: vi.fn(),
    onStartTyping: vi.fn(),
    onStopTyping: vi.fn(),
    onKeyPress: vi.fn(),
    onSend: vi.fn(),
    ...overrides,
  } as any;
}

describe("TeamChatComposerFooter", () => {
  it("shows the reply preview and clears it on cancel", () => {
    const onCancelReply = vi.fn();
    render(
      <TeamChatComposerFooter
        {...baseProps({ replyingTo: { id: "m1", text: "Hello", authorName: "Jo" }, onCancelReply })}
      />,
    );
    expect(screen.getByText("Replying to Hello")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel reply"));
    expect(onCancelReply).toHaveBeenCalledTimes(1);
  });

  it("shows the editing banner and clears it on cancel", () => {
    const onCancelEdit = vi.fn();
    render(<TeamChatComposerFooter {...baseProps({ editingMessage: { id: "m1", text: "Edit me" }, onCancelEdit })} />);
    expect(screen.getByText("Editing Edit me")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel edit"));
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it("removes a pending poll/news attachment preview", () => {
    const onPendingPollIdChange = vi.fn();
    const onPendingNewsIdChange = vi.fn();
    render(
      <TeamChatComposerFooter
        {...baseProps({ pendingPollId: "poll-1", pendingNewsId: "news-1", onPendingPollIdChange, onPendingNewsIdChange })}
      />,
    );
    fireEvent.click(screen.getByText("Remove poll"));
    expect(onPendingPollIdChange).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByText("Remove news"));
    expect(onPendingNewsIdChange).toHaveBeenCalledWith(null);
  });

  it("opens the event/news/poll/board pickers via the image input's callbacks", () => {
    const onEventPickerOpenChange = vi.fn();
    const onNewsPickerOpenChange = vi.fn();
    const onPollDialogOpenChange = vi.fn();
    const onBoardPickerOpenChange = vi.fn();
    render(
      <TeamChatComposerFooter
        {...baseProps({ onEventPickerOpenChange, onNewsPickerOpenChange, onPollDialogOpenChange, onBoardPickerOpenChange })}
      />,
    );
    fireEvent.click(screen.getByText("Open event picker"));
    expect(onEventPickerOpenChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText("Open news picker"));
    expect(onNewsPickerOpenChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText("Open poll dialog"));
    expect(onPollDialogOpenChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText("Open board picker"));
    expect(onBoardPickerOpenChange).toHaveBeenCalledWith(true);
  });

  it("appends a token to an empty message", () => {
    const onMessageChange = vi.fn();
    render(<TeamChatComposerFooter {...baseProps({ message: "", onMessageChange })} />);
    fireEvent.click(screen.getByText("Append vault token"));
    expect(onMessageChange).toHaveBeenCalledWith("[vault:1]");
  });

  it("appends a token with a leading space to a non-empty message", () => {
    const onMessageChange = vi.fn();
    render(<TeamChatComposerFooter {...baseProps({ message: "hi", onMessageChange })} />);
    fireEvent.click(screen.getByText("Append vault token"));
    expect(onMessageChange).toHaveBeenCalledWith("hi [vault:1]");
  });

  it("builds event and board tokens from the attachment pickers", () => {
    const onMessageChange = vi.fn();
    render(<TeamChatComposerFooter {...baseProps({ message: "hi", onMessageChange })} />);
    fireEvent.click(screen.getByText("Select event"));
    expect(onMessageChange).toHaveBeenCalledWith("hi [event:event-1]");
    fireEvent.click(screen.getByText("Select board"));
    expect(onMessageChange).toHaveBeenCalledWith("hi [board:board-1]");
  });

  it("forwards selected news directly to onPendingNewsIdChange", () => {
    const onPendingNewsIdChange = vi.fn();
    render(<TeamChatComposerFooter {...baseProps({ onPendingNewsIdChange })} />);
    fireEvent.click(screen.getByText("Select news"));
    expect(onPendingNewsIdChange).toHaveBeenCalledWith("news-1");
  });

  it("wires message typing to start/stop typing callbacks", () => {
    const onMessageChange = vi.fn();
    const onStartTyping = vi.fn();
    const onStopTyping = vi.fn();
    render(<TeamChatComposerFooter {...baseProps({ onMessageChange, onStartTyping, onStopTyping })} />);
    fireEvent.change(screen.getByLabelText("message"), { target: { value: "hey" } });
    expect(onMessageChange).toHaveBeenCalledWith("hey");
    expect(onStartTyping).toHaveBeenCalledTimes(1);
    expect(onStopTyping).not.toHaveBeenCalled();
  });

  it("stops typing and sends on send button click", () => {
    const onStopTyping = vi.fn();
    const onSend = vi.fn();
    render(<TeamChatComposerFooter {...baseProps({ message: "hi", onStopTyping, onSend })} />);
    fireEvent.click(screen.getByText("Send"));
    expect(onStopTyping).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("only shows schedule action when a scheduleTarget exists", () => {
    const { rerender } = render(<TeamChatComposerFooter {...baseProps({ scheduleTarget: null })} />);
    expect(screen.queryByText("Schedule")).not.toBeInTheDocument();

    const onScheduleDialogOpenChange = vi.fn();
    rerender(
      <TeamChatComposerFooter
        {...baseProps({ scheduleTarget: { chatType: "team", chatId: "team-1" } as any, onScheduleDialogOpenChange })}
      />,
    );
    fireEvent.click(screen.getByText("Schedule"));
    expect(onScheduleDialogOpenChange).toHaveBeenCalledWith(true);
  });

  it("renders the schedule dialog and forwards onScheduled", () => {
    const onScheduled = vi.fn();
    render(
      <TeamChatComposerFooter
        {...baseProps({
          scheduleTarget: { chatType: "team", chatId: "team-1" } as any,
          scheduleDialogOpen: true,
          onScheduled,
        })}
      />,
    );
    fireEvent.click(screen.getByText("Confirm schedule"));
    expect(onScheduled).toHaveBeenCalledTimes(1);
  });

  it("renders the poll dialog only when teamId is present and forwards onCreated", () => {
    const onPendingPollIdChange = vi.fn();
    render(
      <TeamChatComposerFooter {...baseProps({ pollDialogOpen: true, onPendingPollIdChange, teamId: "team-1" })} />,
    );
    fireEvent.click(screen.getByText("Create poll"));
    expect(onPendingPollIdChange).toHaveBeenCalledWith("poll-1");
  });

  it("does not render the poll dialog without a teamId", () => {
    render(<TeamChatComposerFooter {...baseProps({ pollDialogOpen: true, teamId: undefined })} />);
    expect(screen.queryByText("Create poll")).not.toBeInTheDocument();
  });
});
