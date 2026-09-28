import React, { Suspense } from "react";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import type { ScheduleTarget } from "@/hooks/useScheduledMessages";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { ReplyPreview } from "@/components/chat/ReplyPreview";
import { EditingBanner } from "@/components/chat/EditingBanner";
import { ScheduledMessagesBanner } from "@/components/chat/ScheduledMessagesBanner";
import { ChatComposerShell } from "@/components/chat/ChatComposerShell";
import { PollAttachmentPreview } from "@/components/chat/PollAttachmentPreview";
import { NewsAttachmentPreview } from "@/components/chat/NewsAttachmentPreview";
import { ChatImageInput } from "@/components/chat/ChatImageInput";
import { MentionInput } from "@/components/chat/MentionInput";
import { ChatSendButton } from "@/components/chat/ChatSendButton";
import { ChatAttachmentPickers } from "@/components/chat/ChatAttachmentPickers";

const ScheduleMessageDialog = lazyWithRetry(() => import("@/components/chat/ScheduleMessageDialog").then(m => ({ default: m.ScheduleMessageDialog })));
const CreatePollDialog = lazyWithRetry(() => import("@/components/chat/CreatePollDialog").then(m => ({ default: m.CreatePollDialog })));

type ReplyingTo = { id: string; text: string; authorName: string | null } | null;
type EditingMessage = { id: string; text: string } | null;

export interface ClubChatComposerProps {
  composerRef: React.RefObject<HTMLDivElement>;
  nativeKbHeight: number;
  typingUsers: React.ComponentProps<typeof TypingIndicator>["typingUsers"];
  replyingTo: ReplyingTo;
  onReplyCancel: () => void;
  editingMessage: EditingMessage;
  onCancelEdit: () => void;
  scheduleTarget: ScheduleTarget | null;
  pendingPollId: string | null;
  onRemovePoll: () => void;
  pendingNewsId: string | null;
  onRemoveNews: () => void;
  sendPending: boolean;
  imageUrl: string | null;
  onImageUploaded: (url: string | null) => void;
  clubId?: string;
  onEventPicker: () => void;
  onNewsPicker: () => void;
  onPollCreator: () => void;
  onBoardPicker: () => void;
  onAppendToken: (token: string) => void;
  hasText: boolean;
  message: string;
  onMessageChange: (value: string) => void;
  onKeyPress: (event: React.KeyboardEvent) => void;
  onGifSelect: (url: string) => void;
  onStartTyping: () => void;
  onStopTyping: () => void;
  onSend: () => void;
  onSchedule: () => void;
  onScheduleOpenChange: (open: boolean) => void;
  scheduleDialogOpen: boolean;
  onScheduled: () => void;
  onEventPickerOpenChange: (open: boolean) => void;
  onSelectEvent: (eventId: string) => void;
  eventPickerOpen: boolean;
  onNewsPickerOpenChange: (open: boolean) => void;
  onSelectNews: (newsId: string) => void;
  newsPickerOpen: boolean;
  onBoardPickerOpenChange: (open: boolean) => void;
  onSelectBoard: (gameId: string) => void;
  boardPickerOpen: boolean;
  pollDialogOpen: boolean;
  onPollDialogOpenChange: (open: boolean) => void;
  onPollCreated: (pollId: string) => void;
}

export function ClubChatComposer({
  composerRef,
  nativeKbHeight,
  typingUsers,
  replyingTo,
  onReplyCancel,
  editingMessage,
  onCancelEdit,
  scheduleTarget,
  pendingPollId,
  onRemovePoll,
  pendingNewsId,
  onRemoveNews,
  sendPending,
  imageUrl,
  onImageUploaded,
  clubId,
  onEventPicker,
  onNewsPicker,
  onPollCreator,
  onBoardPicker,
  onAppendToken,
  hasText,
  message,
  onMessageChange,
  onKeyPress,
  onGifSelect,
  onStartTyping,
  onStopTyping,
  onSend,
  onSchedule,
  onScheduleOpenChange,
  scheduleDialogOpen,
  onScheduled,
  onEventPickerOpenChange,
  onSelectEvent,
  eventPickerOpen,
  onNewsPickerOpenChange,
  onSelectNews,
  newsPickerOpen,
  onBoardPickerOpenChange,
  onSelectBoard,
  boardPickerOpen,
  pollDialogOpen,
  onPollDialogOpenChange,
  onPollCreated,
}: ClubChatComposerProps) {
  return (
    <>
      <div className="fixed left-0 right-0 bg-background z-[49] pointer-events-none" style={{ bottom: nativeKbHeight, height: nativeKbHeight > 0 ? "3rem" : "calc(var(--bottom-nav-offset, 0px) + 3rem)" }} />
      <div ref={composerRef} data-chat-chrome="true" data-chat-composer="true" className="fixed left-0 right-0 w-full max-w-full overflow-visible border-t border-border/30 pt-1 pb-2 px-2 bg-background/95 z-[51]" style={{ bottom: nativeKbHeight > 0 ? nativeKbHeight : "var(--bottom-nav-offset, 0px)" }}>
        <TypingIndicator typingUsers={typingUsers} />
        <ReplyPreview replyingTo={replyingTo} onCancel={onReplyCancel} />
        {editingMessage && <EditingBanner text={editingMessage.text} onCancel={onCancelEdit} />}
        {scheduleTarget && <ScheduledMessagesBanner target={scheduleTarget} />}
        <ChatComposerShell
          preview={
            (pendingPollId || pendingNewsId) && !editingMessage ? (
              <div className="space-y-1.5">
                {pendingPollId && <PollAttachmentPreview pollId={pendingPollId} onRemove={onRemovePoll} disabled={sendPending} />}
                {pendingNewsId && <NewsAttachmentPreview newsId={pendingNewsId} onRemove={onRemoveNews} disabled={sendPending} />}
              </div>
            ) : undefined
          }
        >
          <ChatImageInput
            imageUrl={imageUrl}
            onImageUploaded={onImageUploaded}
            disabled={false}
            clubId={clubId}
            showEventPicker
            onEventSelect={onEventPicker}
            showNewsPicker={!!clubId}
            onNewsSelect={onNewsPicker}
            showPollCreator
            onPollCreate={onPollCreator}
            showBoardPicker={false}
            onBoardPick={onBoardPicker}
            showVaultPicker
            onAppendToken={onAppendToken}
            hasText={hasText}
          />
          <MentionInput
            bare
            placeholder="Type a message..."
            value={message}
            onChange={(value) => {
              onMessageChange(value);
              if (value.trim()) onStartTyping();
              else onStopTyping();
            }}
            onKeyPress={onKeyPress}
            disabled={false}
            clubId={clubId}
            onGifSelect={onGifSelect}
          />
          <ChatSendButton
            onSend={() => {
              onStopTyping();
              onSend();
            }}
            onSchedule={scheduleTarget ? onSchedule : undefined}
            disabled={!message.trim() && !imageUrl && !pendingPollId && !pendingNewsId}
            loading={sendPending}
            canSend={!!message.trim() || !!imageUrl || !!pendingPollId || !!pendingNewsId}
          />
        </ChatComposerShell>
        {scheduleTarget && (
          <Suspense fallback={null}>
            <ScheduleMessageDialog
              open={scheduleDialogOpen}
              onOpenChange={onScheduleOpenChange}
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
          onSelectEvent={onSelectEvent}
          newsPickerOpen={newsPickerOpen}
          onNewsPickerOpenChange={onNewsPickerOpenChange}
          onSelectNews={onSelectNews}
          boardPickerOpen={boardPickerOpen}
          onBoardPickerOpenChange={onBoardPickerOpenChange}
          onSelectBoard={onSelectBoard}
          clubId={clubId}
        />
        {clubId && (
          <Suspense fallback={null}>
            <CreatePollDialog
              open={pollDialogOpen}
              onOpenChange={onPollDialogOpenChange}
              chatType="club"
              chatId={clubId}
              onCreated={onPollCreated}
            />
          </Suspense>
        )}
      </div>
    </>
  );
}
