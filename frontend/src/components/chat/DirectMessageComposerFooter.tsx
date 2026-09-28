import React, { Suspense } from "react";
import { ChatAttachmentPickers } from "@/components/chat/ChatAttachmentPickers";
import { ChatComposerShell } from "@/components/chat/ChatComposerShell";
import { ChatImageInput } from "@/components/chat/ChatImageInput";
import { ChatSendButton } from "@/components/chat/ChatSendButton";
import { EditingBanner } from "@/components/chat/EditingBanner";
import { MentionInput } from "@/components/chat/MentionInput";
import { NewsAttachmentPreview } from "@/components/chat/NewsAttachmentPreview";
import { ReplyPreview } from "@/components/chat/ReplyPreview";
import { ScheduledMessagesBanner } from "@/components/chat/ScheduledMessagesBanner";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import type { ScheduleTarget } from "@/hooks/useScheduledMessages";

const ScheduleMessageDialog = lazyWithRetry(() =>
  import("@/components/chat/ScheduleMessageDialog").then((module) => ({
    default: module.ScheduleMessageDialog,
  })),
);

interface DirectMessageComposerFooterProps {
  composerRef: React.RefObject<HTMLDivElement>;
  searchOpen: boolean;
  nativeKbHeight: number;
  isIgniteSupportConversation: boolean;
  attachmentsDisabled: boolean;
  typingUsers: { id: string; name: string }[];
  replyTo: { id: string; text: string; authorName: string | null } | null;
  onCancelReply: () => void;
  editingMessage: { id: string; text: string } | null;
  onCancelEdit: () => void;
  scheduleTarget: ScheduleTarget | null;
  scheduleDialogOpen: boolean;
  onScheduleDialogOpenChange: (open: boolean) => void;
  onScheduled: () => void;
  pendingNewsId: string | null;
  onPendingNewsIdChange: (newsId: string | null) => void;
  isSending: boolean;
  imageUrl: string | null;
  onImageUploaded: (url: string | null) => void;
  message: string;
  onMessageChange: (value: string | ((prev: string) => string)) => void;
  onStartTyping: () => void;
  onStopTyping: () => void;
  onKeyPress: (event: React.KeyboardEvent) => void;
  onSend: () => void;
  sharedClubId?: string | null;
  otherUserId?: string;
  eventPickerOpen: boolean;
  onEventPickerOpenChange: (open: boolean) => void;
  newsPickerOpen: boolean;
  onNewsPickerOpenChange: (open: boolean) => void;
  boardPickerOpen: boolean;
  onBoardPickerOpenChange: (open: boolean) => void;
}

export function DirectMessageComposerFooter({
  composerRef,
  searchOpen,
  nativeKbHeight,
  isIgniteSupportConversation,
  attachmentsDisabled,
  typingUsers,
  replyTo,
  onCancelReply,
  editingMessage,
  onCancelEdit,
  scheduleTarget,
  scheduleDialogOpen,
  onScheduleDialogOpenChange,
  onScheduled,
  pendingNewsId,
  onPendingNewsIdChange,
  isSending,
  imageUrl,
  onImageUploaded,
  message,
  onMessageChange,
  onStartTyping,
  onStopTyping,
  onKeyPress,
  onSend,
  sharedClubId,
  otherUserId,
  eventPickerOpen,
  onEventPickerOpenChange,
  newsPickerOpen,
  onNewsPickerOpenChange,
  boardPickerOpen,
  onBoardPickerOpenChange,
}: DirectMessageComposerFooterProps) {
  const appendToken = (token: string) =>
    onMessageChange((prev) => (prev ? `${prev} ${token}` : token));

  return (
    <>
      <div
        className={`fixed left-0 right-0 bg-background z-[49] pointer-events-none ${searchOpen ? "hidden" : ""}`}
        style={{
          bottom: nativeKbHeight,
          height: nativeKbHeight > 0 ? "3rem" : "calc(var(--bottom-nav-offset, 0px) + 3rem)",
        }}
      />
      <div
        ref={composerRef}
        data-chat-chrome="true"
        data-chat-composer="true"
        className={`fixed left-0 right-0 border-t border-border/30 bg-background z-[51] ${isIgniteSupportConversation ? "pt-1 pb-2 px-4" : "w-full max-w-full overflow-visible pt-1 pb-2 px-2 bg-background/95"} ${searchOpen ? "hidden" : ""}`}
        style={{ bottom: nativeKbHeight > 0 ? nativeKbHeight : "var(--bottom-nav-offset, 0px)" }}
      >
        {isIgniteSupportConversation ? (
          <div className="rounded-lg bg-muted/50 py-3 text-center text-sm text-muted-foreground">
            This is a welcome message from Ignite Support. Replies are not available.
          </div>
        ) : (
          <>
            <TypingIndicator typingUsers={typingUsers} />
            <ReplyPreview replyingTo={replyTo} onCancel={onCancelReply} />
            {editingMessage && <EditingBanner text={editingMessage.text} onCancel={onCancelEdit} />}
            {scheduleTarget && <ScheduledMessagesBanner target={scheduleTarget} />}
            <ChatComposerShell
              preview={
                pendingNewsId && !editingMessage ? (
                  <NewsAttachmentPreview
                    newsId={pendingNewsId}
                    onRemove={() => onPendingNewsIdChange(null)}
                    disabled={isSending}
                  />
                ) : undefined
              }
            >
              {!attachmentsDisabled && (
                <ChatImageInput
                  imageUrl={imageUrl}
                  onImageUploaded={onImageUploaded}
                  disabled={false}
                  clubId={sharedClubId || undefined}
                  showEventPicker={!!sharedClubId}
                  onEventSelect={() => onEventPickerOpenChange(true)}
                  showNewsPicker={!!sharedClubId}
                  onNewsSelect={() => onNewsPickerOpenChange(true)}
                  showBoardPicker={false}
                  onBoardPick={() => onBoardPickerOpenChange(true)}
                  showVaultPicker={!!sharedClubId}
                  onAppendToken={appendToken}
                  hasText={!!message.trim()}
                />
              )}
              <MentionInput
                bare
                value={message}
                onChange={(value) => {
                  onMessageChange(value);
                  if (value.trim()) onStartTyping();
                  else onStopTyping();
                }}
                onKeyPress={onKeyPress}
                placeholder="Type a message..."
                disabled={false}
                dmOtherUserId={otherUserId}
                onGifSelect={onImageUploaded}
              />
              <ChatSendButton
                onSend={onSend}
                onSchedule={scheduleTarget ? () => onScheduleDialogOpenChange(true) : undefined}
                disabled={!message.trim() && !imageUrl && !pendingNewsId}
                loading={isSending}
                canSend={!!message.trim() || !!imageUrl || !!pendingNewsId}
              />
            </ChatComposerShell>
            {scheduleTarget && scheduleDialogOpen && (
              <Suspense fallback={null}>
                <ScheduleMessageDialog
                  open
                  onOpenChange={onScheduleDialogOpenChange}
                  target={scheduleTarget}
                  initialText={message}
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
              clubId={sharedClubId || undefined}
            />
          </>
        )}
      </div>
    </>
  );
}
