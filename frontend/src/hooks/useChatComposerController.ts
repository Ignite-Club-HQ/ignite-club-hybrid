import { useCallback, useState } from "react";
import { useChatDraft, useChatDraftReply } from "./useChatDraft";
import {
  beginChatMessageEdit,
  cancelChatMessageEdit,
  type EditableChatMessage,
} from "@/lib/chatComposerEdit";
import { buildChatComposerText, hasChatComposerContent } from "@/lib/chatComposerIntent";
import { resetChatComposerAfterSend } from "@/lib/chatComposerSubmission";
import { restoreFailedSendComposer, type FailedSendContext } from "@/lib/failedSendRestore";

export interface ChatReplyTarget {
  id: string;
  text: string;
  authorName: string | null;
}

export interface ChatComposerSubmission {
  text: string;
  imageUrl: string | null;
  replyToId: string | null;
}

export interface ChatComposerControllerOptions {
  clearReplyOnEdit?: boolean;
}

/**
 * Owns composer UI state and transitions only. Database writes, permissions,
 * optimistic rows, uploads, scheduling and submission timing stay page-owned.
 */
export function useChatComposerController<
  TReply extends { id: string } = ChatReplyTarget,
  TEdit extends EditableChatMessage = EditableChatMessage,
>(
  draftId: string | undefined,
  { clearReplyOnEdit = true }: ChatComposerControllerOptions = {},
) {
  const [text, setText, clearDraft] = useChatDraft(draftId);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useChatDraftReply<TReply>(draftId);
  const [editingMessage, setEditingMessage] = useState<TEdit | null>(null);
  const [pendingPollId, setPendingPollId] = useState<string | null>(null);

  const canSend = hasChatComposerContent({ text, imageUrl, pendingPollId });

  const beginEdit = useCallback(
    (message: TEdit) => {
      const edit = beginChatMessageEdit(message);
      setEditingMessage(edit.editingMessage);
      setText(edit.composerText);
      if (clearReplyOnEdit) setReplyingTo(null);
    },
    [clearReplyOnEdit, setReplyingTo, setText],
  );

  const cancelEdit = useCallback(() => {
    const edit = cancelChatMessageEdit();
    setEditingMessage(edit.editingMessage);
    setText(edit.composerText);
  }, [setText]);

  const finishEdit = useCallback(() => {
    setText("");
    setEditingMessage(null);
  }, [setText]);

  const buildSubmission = useCallback(
    (): ChatComposerSubmission => ({
      text: buildChatComposerText(text, pendingPollId),
      imageUrl,
      replyToId: replyingTo?.id ?? null,
    }),
    [imageUrl, pendingPollId, replyingTo, text],
  );

  const resetAfterSend = useCallback(() => {
    resetChatComposerAfterSend({
      setText,
      setImage: setImageUrl,
      setReply: setReplyingTo,
      setPoll: setPendingPollId,
    });
  }, [setReplyingTo, setText]);

  const restoreAfterFailedSend = useCallback(
    (context: FailedSendContext<TReply> | null | undefined) => {
      restoreFailedSendComposer({
        context,
        setText,
        setImage: setImageUrl,
        setReply: setReplyingTo,
        setPoll: setPendingPollId,
      });
    },
    [setReplyingTo, setText],
  );

  return {
    text,
    setText,
    clearDraft,
    imageUrl,
    setImageUrl,
    replyingTo,
    setReplyingTo,
    editingMessage,
    pendingPollId,
    setPendingPollId,
    canSend,
    beginEdit,
    cancelEdit,
    finishEdit,
    buildSubmission,
    resetAfterSend,
    restoreAfterFailedSend,
  };
}
