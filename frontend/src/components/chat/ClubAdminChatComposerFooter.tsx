import React, { Suspense } from "react";
import { PollAttachmentPreview } from "@/components/chat/PollAttachmentPreview";
import { ReplyPreview } from "@/components/chat/ReplyPreview";
import { EditingBanner } from "@/components/chat/EditingBanner";
import { ScheduledMessagesBanner } from "@/components/chat/ScheduledMessagesBanner";
import { ChatComposerShell } from "@/components/chat/ChatComposerShell";
import { ChatImageInput } from "@/components/chat/ChatImageInput";
import { MentionInput } from "@/components/chat/MentionInput";
import { ChatSendButton } from "@/components/chat/ChatSendButton";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import type { ScheduleTarget } from "@/hooks/useScheduledMessages";

const ScheduleMessageDialog = lazyWithRetry(() =>
  import("@/components/chat/ScheduleMessageDialog").then((m) => ({ default: m.ScheduleMessageDialog })),
);
const CreatePollDialog = lazyWithRetry(() =>
  import("@/components/chat/CreatePollDialog").then((m) => ({ default: m.CreatePollDialog })),
);

interface ClubAdminChatComposerFooterProps {
  composerRef: React.RefObject<HTMLDivElement>;
  searchOpen: boolean;
  nativeKbHeight: number;
  typingUsers: { id: string; name: string }[];
  replyTo: { id: string; text: string; author?: { display_name: string | null } } | null;
  onCancelReply: () => void;
  editingMessage: { id: string; text: string } | null;
  onCancelEdit: () => void;
  scheduleTarget: ScheduleTarget | null;
  scheduleDialogOpen: boolean;
  onScheduleDialogOpenChange: (open: boolean) => void;
  onScheduled: () => void;
  pendingPollId: string | null;
  onPendingPollIdChange: (pollId: string | null) => void;
  isSending: boolean;
  imageUrl: string | null;
  onImageUploaded: (url: string | null) => void;
  clubId?: string;
  clubAdminMemberUserId?: string;
  message: string;
  onMessageChange: (value: string) => void;
  onStartTyping: () => void;
  onStopTyping: () => void;
  onKeyPress: (event: React.KeyboardEvent) => void;
  onSend: () => void;
  conversationId?: string;
  pollDialogOpen: boolean;
  onPollDialogOpenChange: (open: boolean) => void;
}

export function ClubAdminChatComposerFooter({
  composerRef,
  searchOpen,
  nativeKbHeight,
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
  isSending,
  imageUrl,
  onImageUploaded,
  clubId,
  clubAdminMemberUserId,
  message,
  onMessageChange,
  onStartTyping,
  onStopTyping,
  onKeyPress,
  onSend,
  conversationId,
  pollDialogOpen,
  onPollDialogOpenChange,
}: ClubAdminChatComposerFooterProps) {
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
        {replyTo && (
          <ReplyPreview
            replyingTo={{ id: replyTo.id, text: replyTo.text, authorName: replyTo.author?.display_name || null }}
            onCancel={onCancelReply}
          />
        )}
        {editingMessage && <EditingBanner text={editingMessage.text} onCancel={onCancelEdit} />}
        {scheduleTarget && <ScheduledMessagesBanner target={scheduleTarget} />}
        <ChatComposerShell
          preview={
            pendingPollId && !editingMessage ? (
              <PollAttachmentPreview
                pollId={pendingPollId}
                onRemove={() => onPendingPollIdChange(null)}
                disabled={isSending}
              />
            ) : undefined
          }
        >
          <ChatImageInput
            imageUrl={imageUrl}
            onImageUploaded={onImageUploaded}
            disabled={false}
            clubId={clubId}
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
            onKeyPress={onKeyPress}
            placeholder="Type a message..."
            disabled={false}
            clubId={clubId}
            clubAdminMemberUserId={clubAdminMemberUserId}
            onGifSelect={onImageUploaded}
          />
          <ChatSendButton
            onSend={() => {
              onStopTyping();
              onSend();
            }}
            onSchedule={scheduleTarget ? () => onScheduleDialogOpenChange(true) : undefined}
            disabled={!message.trim() && !imageUrl && !pendingPollId}
            loading={isSending}
            canSend={!!message.trim() || !!imageUrl || !!pendingPollId}
          />
        </ChatComposerShell>
        {scheduleTarget && (
          <Suspense fallback={null}>
            <ScheduleMessageDialog
              open={scheduleDialogOpen}
              onOpenChange={onScheduleDialogOpenChange}
              target={scheduleTarget}
              initialText={message}
              onScheduled={onScheduled}
            />
          </Suspense>
        )}
        {conversationId && (
          <Suspense fallback={null}>
            <CreatePollDialog
              open={pollDialogOpen}
              onOpenChange={onPollDialogOpenChange}
              chatType="club_admin"
              chatId={conversationId}
              onCreated={onPendingPollIdChange}
            />
          </Suspense>
        )}
      </div>
    </>
  );
}
