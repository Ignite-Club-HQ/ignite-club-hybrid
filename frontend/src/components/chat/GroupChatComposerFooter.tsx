import React, { Suspense } from "react";
import { ChatAttachmentPickers } from "@/components/chat/ChatAttachmentPickers";
import { ChatComposerShell } from "@/components/chat/ChatComposerShell";
import { ChatImageInput } from "@/components/chat/ChatImageInput";
import { ChatSendButton } from "@/components/chat/ChatSendButton";
import { MentionInput } from "@/components/chat/MentionInput";
import { NewsAttachmentPreview } from "@/components/chat/NewsAttachmentPreview";
import { PollAttachmentPreview } from "@/components/chat/PollAttachmentPreview";
import { ReplyPreview } from "@/components/chat/ReplyPreview";
import { ScheduledMessagesBanner } from "@/components/chat/ScheduledMessagesBanner";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { Button } from "@/components/ui/button";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import type { ScheduleTarget } from "@/hooks/useScheduledMessages";

const ScheduleMessageDialog = lazyWithRetry(() =>
  import("@/components/chat/ScheduleMessageDialog").then((m) => ({ default: m.ScheduleMessageDialog })),
);
const CreatePollDialog = lazyWithRetry(() =>
  import("@/components/chat/CreatePollDialog").then((m) => ({ default: m.CreatePollDialog })),
);

interface GroupChatComposerFooterProps {
  composerRef: React.RefObject<HTMLDivElement>;
  searchOpen: boolean;
  nativeKbHeight: number;
  canPost: boolean;
  typingUsers: { id: string; name: string }[];
  replyTo: { id: string; text: string; author?: { display_name?: string | null } | null } | null;
  onCancelReply: () => void;
  editingMessage: { id: string; text: string } | null;
  onCancelEdit: () => void;
  scheduleTarget: ScheduleTarget | null;
  scheduleDialogOpen: boolean;
  onScheduleDialogOpenChange: (open: boolean) => void;
  onScheduled: () => void;
  pendingPollId: string | null;
  onPendingPollIdChange: (id: string | null) => void;
  pendingNewsId: string | null;
  onPendingNewsIdChange: (id: string | null) => void;
  isSending: boolean;
  imageUrl: string | null;
  onImageUploaded: (url: string | null) => void;
  message: string;
  onMessageChange: (value: string) => void;
  onStartTyping: () => void;
  onStopTyping: () => void;
  onKeyPress: (event: React.KeyboardEvent) => void;
  onSend: () => void;
  groupId?: string | null;
  teamId?: string | null;
  clubId?: string | null;
  miniLeagueId?: string | null;
  competitionId?: string | null;
  eventPickerOpen: boolean;
  onEventPickerOpenChange: (open: boolean) => void;
  newsPickerOpen: boolean;
  onNewsPickerOpenChange: (open: boolean) => void;
  boardPickerOpen: boolean;
  onBoardPickerOpenChange: (open: boolean) => void;
  pollDialogOpen: boolean;
  onPollDialogOpenChange: (open: boolean) => void;
}

export function GroupChatComposerFooter({
  composerRef,
  searchOpen,
  nativeKbHeight,
  canPost,
  typingUsers,
  replyTo,
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
  message,
  onMessageChange,
  onStartTyping,
  onStopTyping,
  onKeyPress,
  onSend,
  groupId,
  teamId,
  clubId,
  miniLeagueId,
  competitionId,
  eventPickerOpen,
  onEventPickerOpenChange,
  newsPickerOpen,
  onNewsPickerOpenChange,
  boardPickerOpen,
  onBoardPickerOpenChange,
  pollDialogOpen,
  onPollDialogOpenChange,
}: GroupChatComposerFooterProps) {
  const appendToken = (token: string) => onMessageChange(message ? `${message} ${token}` : token);

  return (
    <>
      <div className={`fixed left-0 right-0 bg-background z-[49] pointer-events-none ${searchOpen ? "hidden" : ""}`} style={{ bottom: nativeKbHeight, height: nativeKbHeight > 0 ? "3rem" : "calc(var(--bottom-nav-offset, 0px) + 3rem)" }} />
      <div ref={composerRef} data-chat-chrome="true" data-chat-composer="true" className={`fixed left-0 right-0 w-full max-w-full overflow-visible border-t border-border/30 pt-1 pb-2 px-2 bg-background/95 z-[51] ${searchOpen ? "hidden" : ""}`} style={{ bottom: nativeKbHeight > 0 ? nativeKbHeight : "var(--bottom-nav-offset, 0px)" }}>
        {!canPost ? (
          <p className="py-3 text-center text-sm text-muted-foreground">Only competition organisers can post in this chat.</p>
        ) : (
          <>
            <TypingIndicator typingUsers={typingUsers} />
            {replyTo && (
              <ReplyPreview
                replyingTo={{ id: replyTo.id, text: replyTo.text, authorName: replyTo.author?.display_name || null }}
                onCancel={onCancelReply}
              />
            )}
            {editingMessage && (
              <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
                <span>Editing message</span>
                <Button variant="ghost" size="sm" onClick={onCancelEdit}>Cancel</Button>
              </div>
            )}
            {scheduleTarget && <ScheduledMessagesBanner target={scheduleTarget} />}
            <ChatComposerShell
              preview={
                (pendingPollId || pendingNewsId) && !editingMessage ? (
                  <div className="space-y-1.5">
                    {pendingPollId && <PollAttachmentPreview pollId={pendingPollId} onRemove={() => onPendingPollIdChange(null)} disabled={isSending} />}
                    {pendingNewsId && <NewsAttachmentPreview newsId={pendingNewsId} onRemove={() => onPendingNewsIdChange(null)} disabled={isSending} />}
                  </div>
                ) : undefined
              }
            >
              <ChatImageInput
                onImageUploaded={onImageUploaded}
                imageUrl={imageUrl}
                clubId={clubId || undefined}
                teamId={teamId || undefined}
                showEventPicker
                onEventSelect={() => onEventPickerOpenChange(true)}
                showNewsPicker={!!clubId}
                onNewsSelect={() => onNewsPickerOpenChange(true)}
                showPollCreator
                onPollCreate={() => onPollDialogOpenChange(true)}
                showBoardPicker={false}
                onBoardPick={() => onBoardPickerOpenChange(true)}
                showVaultPicker={!!clubId}
                onAppendToken={appendToken}
                hasText={!!message.trim()}
              />
              <MentionInput
                bare
                value={message}
                onChange={(value) => {
                  onMessageChange(value);
                  if (value.trim()) onStartTyping();
                  else onStopTyping();
                }}
                placeholder="Type a message..."
                onKeyPress={onKeyPress}
                groupId={groupId || undefined}
                teamId={teamId || undefined}
                clubId={clubId || undefined}
                disabled={false}
                onGifSelect={onImageUploaded}
              />
              <ChatSendButton
                onSend={() => { onStopTyping(); onSend(); }}
                onSchedule={scheduleTarget ? () => onScheduleDialogOpenChange(true) : undefined}
                disabled={!message.trim() && !imageUrl && !pendingPollId && !pendingNewsId}
                loading={isSending}
                canSend={!!message.trim() || !!imageUrl || !!pendingPollId || !!pendingNewsId}
              />
            </ChatComposerShell>
          </>
        )}
        {scheduleTarget && (
          <Suspense fallback={null}>
            <ScheduleMessageDialog open={scheduleDialogOpen} onOpenChange={onScheduleDialogOpenChange} target={scheduleTarget} initialText={message} initialImageUrl={imageUrl} onScheduled={onScheduled} />
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
          teamId={teamId || undefined}
          clubId={clubId || undefined}
          miniLeagueId={miniLeagueId}
          competitionId={competitionId}
        />
        {groupId && (
          <Suspense fallback={null}>
            <CreatePollDialog open={pollDialogOpen} onOpenChange={onPollDialogOpenChange} chatType="group" chatId={groupId} onCreated={onPendingPollIdChange} />
          </Suspense>
        )}
      </div>
    </>
  );
}
