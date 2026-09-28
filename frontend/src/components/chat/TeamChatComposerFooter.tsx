import { Suspense } from "react";
import { ChatAttachmentPickers } from "@/components/chat/ChatAttachmentPickers";
import { ChatComposerShell } from "@/components/chat/ChatComposerShell";
import { ChatImageInput } from "@/components/chat/ChatImageInput";
import { ChatSendButton } from "@/components/chat/ChatSendButton";
import { EditingBanner } from "@/components/chat/EditingBanner";
import { MentionInput } from "@/components/chat/MentionInput";
import { NewsAttachmentPreview } from "@/components/chat/NewsAttachmentPreview";
import { PollAttachmentPreview } from "@/components/chat/PollAttachmentPreview";
import { ReplyPreview } from "@/components/chat/ReplyPreview";
import { ScheduledMessagesBanner } from "@/components/chat/ScheduledMessagesBanner";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import type { ScheduleTarget } from "@/hooks/useScheduledMessages";

const ScheduleMessageDialog = lazyWithRetry(() =>
  import("@/components/chat/ScheduleMessageDialog").then((m) => ({ default: m.ScheduleMessageDialog })),
);
const CreatePollDialog = lazyWithRetry(() =>
  import("@/components/chat/CreatePollDialog").then((m) => ({ default: m.CreatePollDialog })),
);

interface TeamChatComposerFooterProps {
  composerRef: React.RefObject<HTMLDivElement>;
  searchOpen: boolean;
  nativeKbHeight: number;
  typingUsers: { id: string; name: string }[];
  replyingTo: { id: string; text: string; authorName: string | null } | null;
  onCancelReply: () => void;
  editingMessage: { id: string; text: string } | null;
  onCancelEdit: () => void;
  scheduleTarget: ScheduleTarget | null;
  scheduleDialogOpen: boolean;
  onScheduleDialogOpenChange: (open: boolean) => void;
  onScheduled: () => void;
  pendingPollId: string | null;
  onPendingPollIdChange: (pollId: string | null) => void;
  pendingNewsId: string | null;
  onPendingNewsIdChange: (newsId: string | null) => void;
  isSending: boolean;
  imageUrl: string | null;
  onImageUploaded: (url: string | null) => void;
  clubId?: string | null;
  teamId?: string;
  eventPickerOpen: boolean;
  onEventPickerOpenChange: (open: boolean) => void;
  newsPickerOpen: boolean;
  onNewsPickerOpenChange: (open: boolean) => void;
  boardPickerOpen: boolean;
  onBoardPickerOpenChange: (open: boolean) => void;
  pollDialogOpen: boolean;
  onPollDialogOpenChange: (open: boolean) => void;
  message: string;
  onMessageChange: (value: string) => void;
  onStartTyping: () => void;
  onStopTyping: () => void;
  onKeyPress: (e: React.KeyboardEvent) => void;
  onSend: () => void;
}

/**
 * The fixed composer footer: typing/reply/edit/schedule banners, the message
 * composer shell (image/poll/board/event pickers, mention input, send
 * button), and the attachment/poll/schedule dialogs it opens. Extracted from
 * TeamChatPage so the page keeps only state and mutation ownership; all
 * open/close and token-append wiring lives here.
 */
export function TeamChatComposerFooter({
  composerRef,
  searchOpen,
  nativeKbHeight,
  typingUsers,
  replyingTo,
  onCancelReply,
  editingMessage,
  onCancelEdit,
  scheduleTarget,
  scheduleDialogOpen,
  onScheduleDialogOpenChange,
  onScheduled,
  pendingPollId,
  onPendingPollIdChange,
  pendingNewsId,
  onPendingNewsIdChange,
  isSending,
  imageUrl,
  onImageUploaded,
  clubId,
  teamId,
  eventPickerOpen,
  onEventPickerOpenChange,
  newsPickerOpen,
  onNewsPickerOpenChange,
  boardPickerOpen,
  onBoardPickerOpenChange,
  pollDialogOpen,
  onPollDialogOpenChange,
  message,
  onMessageChange,
  onStartTyping,
  onStopTyping,
  onKeyPress,
  onSend,
}: TeamChatComposerFooterProps) {
  const appendToken = (token: string) => onMessageChange(message ? `${message} ${token}` : token);

  return (
    <>
      <div
        className={`fixed left-0 right-0 bg-background z-[49] pointer-events-none ${searchOpen ? "hidden" : ""}`}
        style={{ bottom: nativeKbHeight, height: nativeKbHeight > 0 ? "3rem" : "calc(var(--bottom-nav-offset, 0px) + 3rem)" }}
      />
      <div
        ref={composerRef}
        data-chat-chrome="true"
        data-chat-composer="true"
        className={`fixed left-0 right-0 w-full max-w-full overflow-visible border-t border-border/30 pt-1 pb-2 px-2 bg-background/95 z-[51] ${searchOpen ? "hidden" : ""}`}
        style={{ bottom: nativeKbHeight > 0 ? nativeKbHeight : "var(--bottom-nav-offset, 0px)" }}
      >
        <TypingIndicator typingUsers={typingUsers} />
        <ReplyPreview replyingTo={replyingTo} onCancel={onCancelReply} />
        {editingMessage && <EditingBanner text={editingMessage.text} onCancel={onCancelEdit} />}
        {scheduleTarget && <ScheduledMessagesBanner target={scheduleTarget} />}
        <ChatComposerShell
          preview={
            (pendingPollId || pendingNewsId) && !editingMessage ? (
              <div className="space-y-1.5">
                {pendingPollId && (
                  <PollAttachmentPreview
                    pollId={pendingPollId}
                    onRemove={() => onPendingPollIdChange(null)}
                    disabled={isSending}
                  />
                )}
                {pendingNewsId && (
                  <NewsAttachmentPreview
                    newsId={pendingNewsId}
                    onRemove={() => onPendingNewsIdChange(null)}
                    disabled={isSending}
                  />
                )}
              </div>
            ) : undefined
          }
        >
          <ChatImageInput
            imageUrl={imageUrl}
            onImageUploaded={onImageUploaded}
            disabled={false}
            clubId={clubId}
            teamId={teamId}
            showEventPicker={true}
            onEventSelect={() => onEventPickerOpenChange(true)}
            showNewsPicker={!!clubId}
            onNewsSelect={() => onNewsPickerOpenChange(true)}
            showPollCreator={true}
            onPollCreate={() => onPollDialogOpenChange(true)}
            showBoardPicker={true}
            onBoardPick={() => onBoardPickerOpenChange(true)}
            showVaultPicker={true}
            onAppendToken={appendToken}
            hasText={!!message.trim()}
          />
          <MentionInput
            bare
            placeholder="Type a message..."
            value={message}
            onChange={(val) => {
              onMessageChange(val);
              if (val.trim()) onStartTyping();
              else onStopTyping();
            }}
            onKeyPress={onKeyPress}
            disabled={false}
            teamId={teamId}
            clubId={clubId}
            onGifSelect={onImageUploaded}
          />
          <ChatSendButton
            onSend={() => {
              onStopTyping();
              onSend();
            }}
            onSchedule={scheduleTarget ? () => onScheduleDialogOpenChange(true) : undefined}
            disabled={!message.trim() && !imageUrl && !pendingPollId && !pendingNewsId}
            loading={isSending}
            canSend={!!message.trim() || !!imageUrl || !!pendingPollId || !!pendingNewsId}
          />
        </ChatComposerShell>
        {scheduleTarget && (
          <Suspense fallback={null}>
            <ScheduleMessageDialog
              open={scheduleDialogOpen}
              onOpenChange={onScheduleDialogOpenChange}
              target={scheduleTarget}
              initialText={message}
              initialImageUrl={imageUrl}
              onScheduled={onScheduled}
            />
          </Suspense>
        )}
        <ChatAttachmentPickers
          eventPickerOpen={eventPickerOpen}
          onEventPickerOpenChange={onEventPickerOpenChange}
          onSelectEvent={(eventId) => appendToken(`[event:${eventId}]`)}
          newsPickerOpen={newsPickerOpen}
          onNewsPickerOpenChange={onNewsPickerOpenChange}
          onSelectNews={onPendingNewsIdChange}
          boardPickerOpen={boardPickerOpen}
          onBoardPickerOpenChange={onBoardPickerOpenChange}
          onSelectBoard={(gameId) => appendToken(`[board:${gameId}]`)}
          teamId={teamId}
          clubId={clubId}
        />
        {teamId && (
          <Suspense fallback={null}>
            <CreatePollDialog
              open={pollDialogOpen}
              onOpenChange={onPollDialogOpenChange}
              chatType="team"
              chatId={teamId}
              onCreated={onPendingPollIdChange}
            />
          </Suspense>
        )}
      </div>
    </>
  );
}
