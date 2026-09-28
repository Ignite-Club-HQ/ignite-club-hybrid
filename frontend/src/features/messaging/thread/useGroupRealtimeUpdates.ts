import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { startChatRealtimeChannel } from "@/features/messaging/thread/chatRealtimeChannelLifecycle";
import { sortChatMessagesChronologically } from "@/lib/chatMessageOrder";
import {
  applyMessageUpdate,
  recordRealtimeMutation,
  removeMessage,
} from "@/lib/chatMessageReconciliation";
import { findLocalReplyMessage } from "@/lib/chatRealtimeReply";
import { findSupersededOptimisticIndex } from "@/lib/failedSendRestore";
import { fetchSingleProfileWithCache, getProfilesFromCache } from "@/lib/profileCache";
import type { GroupChatSupabaseClient, GroupMessage, MessageReaction } from "@/features/messaging/thread/groupChatData";

interface UseGroupRealtimeUpdatesOptions {
  groupId?: string;
  userId?: string;
  useIcpLab: boolean;
  queryClient: QueryClient;
  groupRealtimeMode: "realtime" | "polling";
  groupPollIntervalMs: number;
  reconcileScope: string;
  setLocalMessages: Dispatch<SetStateAction<GroupMessage[] | undefined>>;
  applyGroupReaction: (reaction: any) => void;
  applyGroupReactionDelete: (reaction: any) => void;
  supabaseClient: GroupChatSupabaseClient;
}

export const useGroupRealtimeUpdates = ({
  groupId,
  userId,
  useIcpLab,
  queryClient,
  groupRealtimeMode,
  groupPollIntervalMs,
  reconcileScope,
  setLocalMessages,
  applyGroupReaction,
  applyGroupReactionDelete,
  supabaseClient,
}: UseGroupRealtimeUpdatesOptions) => {
  useEffect(() => {
    if (!groupId || groupRealtimeMode !== "polling") return;
    const id = window.setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["group-messages", groupId] });
    }, groupPollIntervalMs);
    return () => window.clearInterval(id);
  }, [groupId, groupRealtimeMode, groupPollIntervalMs, queryClient]);

  // Real-time subscription - directly update cache instead of invalidating
  useEffect(() => {
    if (!groupId || useIcpLab) return;
    if (groupRealtimeMode === "polling") return;

    const channel = supabaseClient
      .channel(`group-messages-${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "group_messages",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const newMsg = payload.new as any;

          // Get cached profile synchronously (instant, non-blocking)
          const { cached: cachedProfiles } = getProfilesFromCache([newMsg.author_id]);
          const cachedProfile = cachedProfiles.get(newMsg.author_id);
          const currentMessages = queryClient.getQueryData<{ messages: GroupMessage[] }>(["group-messages", groupId])?.messages;
          const localReplyMessage = findLocalReplyMessage(currentMessages, newMsg.reply_to_id);
          const localReply = localReplyMessage
            ? { text: localReplyMessage.text, author: localReplyMessage.author ?? undefined }
            : null;

          // IMMEDIATELY update cache with message (don't wait for profile fetch)
          queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
            if (!old) return { messages: [{
              ...newMsg,
              author: cachedProfile
                ? { display_name: cachedProfile.display_name, avatar_url: cachedProfile.avatar_url }
                : null,
              reply_to: localReply,
            }], reactions: [] };

            // Check if message already exists with real ID
            if (old.messages.some(m => m.id === newMsg.id)) {
              return old;
            }

            // Check for temp message to replace
            const tempIndex = findSupersededOptimisticIndex(old.messages, newMsg);

            const messageToAdd: GroupMessage = {
              ...newMsg,
              author: cachedProfile
                ? { display_name: cachedProfile.display_name, avatar_url: cachedProfile.avatar_url }
                : null,
              reply_to: null,
            };

            if (tempIndex !== -1) {
              // Replace temp message with real one, preserving author from temp message
              const updatedMessages = [...old.messages];
              updatedMessages[tempIndex] = {
                ...messageToAdd,
                author: messageToAdd.author?.display_name
                  ? messageToAdd.author
                  : old.messages[tempIndex].author,
                reply_to: old.messages[tempIndex].reply_to,
              };
              return { ...old, messages: updatedMessages };
            }

            // Add new message (from other user)
            const updatedMessages = sortChatMessagesChronologically([...old.messages, messageToAdd]);
            return { ...old, messages: updatedMessages };
          });

          // Asynchronously fetch profile and reply_to data if needed, then update
          const needsProfileFetch = !cachedProfile;
          const needsReplyFetch = !!newMsg.reply_to_id && !localReplyMessage;

          if (needsProfileFetch || needsReplyFetch) {
            Promise.all([
              needsProfileFetch
                ? fetchSingleProfileWithCache(newMsg.author_id)
                : Promise.resolve(cachedProfile),
              needsReplyFetch
                ? supabaseClient
                    .from("group_messages")
                    .select("text, author:profiles!group_messages_author_id_fkey(display_name)")
                    .eq("id", newMsg.reply_to_id)
                    .single()
                : Promise.resolve({ data: null }),
            ]).then(([profileData, replyToResult]) => {
              // Update the message with fetched data
              queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
                if (!old) return old;
                return {
                  ...old,
                  messages: old.messages.map(m => {
                    if (m.id !== newMsg.id) return m;
                    return {
                      ...m,
                      author: profileData
                        ? { display_name: profileData.display_name, avatar_url: profileData.avatar_url }
                        : m.author,
                      reply_to: replyToResult?.data
                        ? { text: replyToResult.data.text, author: replyToResult.data.author }
                        : m.reply_to,
                    };
                  }),
                };
              });
            });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "group_messages",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const deletedId = (payload.old as any)?.id;
          if (!deletedId) return;
          // Tombstone so an older in-flight fetch cannot resurrect the row.
          recordRealtimeMutation(reconcileScope, { id: deletedId, deleted_at: new Date().toISOString() });
          queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
            if (!old) return { messages: [], reactions: [] };
            return { ...old, messages: removeMessage(old.messages, deletedId) };
          });
          setLocalMessages((prev) => (prev ? removeMessage(prev, deletedId) : prev));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "group_messages",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          if (!updated?.id) return;
          // Record first so any query response already in flight is reconciled
          // when it lands (stale-fetch resurrection guard). Idempotent.
          const outcome = recordRealtimeMutation(reconcileScope, updated);

          if (outcome === "deleted") {
            queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
              if (!old) return { messages: [], reactions: [] };
              return { ...old, messages: removeMessage(old.messages, updated.id) };
            });
            setLocalMessages((prev) => (prev ? removeMessage(prev, updated.id) : prev));
            return;
          }

          // Apply the edit to BOTH stores with the same pure helper so they
          // can never diverge. Fields absent from the payload are preserved.
          queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
            if (!old) return { messages: [], reactions: [] };
            return { ...old, messages: applyMessageUpdate(old.messages, updated) };
          });
          setLocalMessages((prev) => (prev ? applyMessageUpdate(prev, updated) : prev));
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reactions" },
        (payload) => applyGroupReaction(payload.new as any),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "message_reactions" },
        (payload) => applyGroupReaction(payload.new as any),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "message_reactions" },
        (payload) => applyGroupReactionDelete(payload.old as any),
      );
    return startChatRealtimeChannel({
      channel,
      channelKey: `group-messages-${groupId}`,
      userId,
      scope: { kind: "group", id: groupId },
    });
  }, [
    groupId,
    queryClient,
    groupRealtimeMode,
    userId,
    reconcileScope,
    applyGroupReaction,
    applyGroupReactionDelete,
    useIcpLab,
    setLocalMessages,
    supabaseClient,
  ]);
};
