import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GroupChatComposerFooter } from "./GroupChatComposerFooter";

vi.mock("@/components/chat/TypingIndicator", () => ({ TypingIndicator: () => null }));
vi.mock("@/components/chat/ChatComposerShell", () => ({
  ChatComposerShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/chat/ChatImageInput", () => ({
  ChatImageInput: ({ competitionId }: { competitionId?: string }) => (
    <output data-testid="photo-upload-competition">{competitionId ?? "none"}</output>
  ),
}));
vi.mock("@/components/chat/MentionInput", () => ({ MentionInput: () => null }));
vi.mock("@/components/chat/ChatSendButton", () => ({ ChatSendButton: () => null }));
vi.mock("@/components/chat/ChatAttachmentPickers", () => ({ ChatAttachmentPickers: () => null }));

const baseProps = {
  composerRef: { current: null },
  searchOpen: false,
  nativeKbHeight: 0,
  canPost: true,
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
  pendingNewsId: null,
  onPendingNewsIdChange: vi.fn(),
  isSending: false,
  imageUrl: null,
  onImageUploaded: vi.fn(),
  message: "",
  onMessageChange: vi.fn(),
  onStartTyping: vi.fn(),
  onStopTyping: vi.fn(),
  onKeyPress: vi.fn(),
  onSend: vi.fn(),
  eventPickerOpen: false,
  onEventPickerOpenChange: vi.fn(),
  newsPickerOpen: false,
  onNewsPickerOpenChange: vi.fn(),
  boardPickerOpen: false,
  onBoardPickerOpenChange: vi.fn(),
  pollDialogOpen: false,
  onPollDialogOpenChange: vi.fn(),
};

describe("GroupChatComposerFooter competition photo scope", () => {
  it("passes competition scope to the photo uploader", () => {
    render(<GroupChatComposerFooter {...baseProps} competitionId="competition-1" />);
    expect(screen.getByTestId("photo-upload-competition")).toHaveTextContent("competition-1");
  });
});