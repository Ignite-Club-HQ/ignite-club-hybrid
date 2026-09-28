import { type Dispatch, type RefObject, type SetStateAction, useRef } from "react";
import { useMutation, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ensureFreshSession } from "@/lib/ensureFreshSession";
import {
  normalizeGroupReactionType,
  type GroupChatSupabaseClient,
  type GroupMessage,
  type MessageReaction,
} from "@/features/messaging/thread/groupChatData";

interface UseGroupReactionToggleOptions {
  groupId?: string;
  userId?: string;
  useIcpLab: boolean;
  queryClient: QueryClient;
  localMessagesRef: RefObject<GroupMessage[] | undefined>;
  setLocalMessages: Dispatch<SetStateAction<GroupMessage[] | undefined>>;
  supabaseClient: GroupChatSupabaseClient;
}

// One reaction per user per message. Toggling the same emoji removes it;
// toggling a different emoji swaps it. Optimistic updates land on the query
// cache immediately; local render state is fail-open for temp reactions so
// it is patched too, and rolled back per-user (never another user's row) on
// final failure after retries are exhausted.
export const useGroupReactionToggle = ({
  groupId,
  userId,
  useIcpLab,
  queryClient,
  localMessagesRef,
  setLocalMessages,
  supabaseClient,
}: UseGroupReactionToggleOptions) => {
  const lastReactionIntentRef = useRef<Record<string, { reactionType: string; action: "add" | "remove" | "update" }>>({});

  return useMutation({
    retry: 1,
    mutationFn: async ({ messageId, reactionType }: { messageId: string; reactionType: string }) => {
      if (!userId) return { action: 'none' as const };

      const normalizedReactionType = normalizeGroupReactionType(reactionType);
      if (useIcpLab) {
        throw new Error("Group message reactions are not available in the local ICP contract.");
      }

      // Ensure the auth token is fresh — a stale/expired JWT causes RLS to
      // reject the insert/update with "Failed to update reaction".
      try {
        await ensureFreshSession();
      } catch (e) {
        console.error('[Reaction] Session not ready:', e);
        throw new Error('Not authenticated');
      }

      console.log('[Reaction] Starting mutation for message:', messageId, 'type:', normalizedReactionType);

      const optimisticIntent = lastReactionIntentRef.current[messageId];

      const { data: existingReaction, error: fetchError } = await supabaseClient
        .from("message_reactions")
        .select("id, reaction_type")
        .eq("group_message_id", messageId)
        .eq("user_id", userId)
        .maybeSingle();

      if (fetchError) {
        console.error('[Reaction] Fetch existing error:', fetchError);
        throw fetchError;
      }

      console.log('[Reaction] Existing reaction from DB:', existingReaction, 'optimisticIntent:', optimisticIntent);

      if (existingReaction) {
        const normalizedExistingReactionType = normalizeGroupReactionType(existingReaction.reaction_type);

        if (normalizedExistingReactionType === normalizedReactionType) {
          console.log('[Reaction] Removing existing reaction');
          const { error } = await supabaseClient.from("message_reactions").delete().eq("id", existingReaction.id);
          if (error) {
            console.error('[Reaction] Delete error:', error);
            throw error;
          }
          return { action: 'removed' as const, reactionId: existingReaction.id, messageId };
        }

        console.log('[Reaction] Updating existing reaction to:', normalizedReactionType);
        const { data, error } = await supabaseClient.from("message_reactions")
          .update({ reaction_type: normalizedReactionType })
          .eq("id", existingReaction.id)
          .select()
          .maybeSingle();
        if (error) {
          console.error('[Reaction] Update error:', error);
          throw error;
        }
        console.log('[Reaction] Update success:', data);
        return { action: 'updated' as const, reaction: data, oldReactionId: existingReaction.id, messageId };
      }

      if (optimisticIntent?.reactionType === normalizedReactionType && optimisticIntent.action === 'remove') {
        console.log('[Reaction] Skipping re-add because latest optimistic intent is remove');
        return { action: 'removed' as const, reactionId: null, messageId };
      }

      console.log('[Reaction] Adding new reaction');
      const { data, error } = await supabaseClient.from("message_reactions").insert({
        group_message_id: messageId,
        user_id: userId,
        reaction_type: normalizedReactionType,
      }).select().maybeSingle();

      if (error) {
        if (error.code === '23505') {
          console.warn('[Reaction] Duplicate reaction, reconciling existing row');
          const { data: conflictingReaction, error: conflictFetchError } = await supabaseClient
            .from("message_reactions")
            .select("*")
            .eq("group_message_id", messageId)
            .eq("user_id", userId)
            .maybeSingle();

          if (conflictFetchError) throw conflictFetchError;

          if (normalizeGroupReactionType(conflictingReaction?.reaction_type) === normalizedReactionType) {
            if (optimisticIntent?.reactionType === normalizedReactionType && optimisticIntent.action === 'remove') {
              const { error: deleteError } = await supabaseClient
                .from("message_reactions")
                .delete()
                .eq("id", conflictingReaction.id);
              if (deleteError) throw deleteError;
              return { action: 'removed' as const, reactionId: conflictingReaction.id, messageId };
            }

            return { action: 'updated' as const, reaction: conflictingReaction, oldReactionId: conflictingReaction.id, messageId };
          }

          const { data: updatedReaction, error: updateError } = await supabaseClient
            .from("message_reactions")
            .update({ reaction_type: normalizedReactionType })
            .eq("id", conflictingReaction?.id)
            .select()
            .maybeSingle();

          if (updateError) throw updateError;
          return { action: 'updated' as const, reaction: updatedReaction, oldReactionId: conflictingReaction?.id, messageId };
        }

        console.error('[Reaction] Insert error:', error);
        throw error;
      }

      console.log('[Reaction] Insert success:', data);
      return { action: 'added' as const, reaction: data ?? { id: `server-${Date.now()}`, user_id: userId, reaction_type: normalizedReactionType, group_message_id: messageId }, messageId };
    },
    onMutate: async ({ messageId, reactionType }) => {
      await queryClient.cancelQueries({ queryKey: ["group-messages", groupId] });

      const liveData = queryClient.getQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId]);

      // Immutable pre-mutation snapshot: copy the arrays (and the reaction
      // rows themselves) so later optimistic/realtime cache writes can never
      // mutate what we roll back to after retries are exhausted.
      const previousData = liveData
        ? {
            ...liveData,
            messages: [...(liveData.messages || [])],
            reactions: (liveData.reactions || []).map((r) => ({ ...r })),
          }
        : undefined;

      // Snapshot of the rendered reaction rows for this message, used to
      // restore local render state (which is fail-open for temp reactions).
      const previousLocalReactions = ((localMessagesRef.current || []) as any[])
        .find((m: any) => m.id === messageId)
        ?.reactions?.map((r: any) => ({ ...r })) as MessageReaction[] | undefined;

      const existingReaction = previousData?.reactions.find(
        r => r.group_message_id === messageId && r.user_id === userId
      );
      const normalizedReactionType = normalizeGroupReactionType(reactionType);
      const normalizedExistingReactionType = normalizeGroupReactionType(existingReaction?.reaction_type);

      lastReactionIntentRef.current[messageId] = {
        reactionType: normalizedReactionType,
        action: !existingReaction ? 'add' : normalizedExistingReactionType === normalizedReactionType ? 'remove' : 'update',
      };

      const tempReactionId = `temp-reaction-${Date.now()}`;

      queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
        if (!old) return { messages: [], reactions: [] };

        if (existingReaction) {
          if (normalizedExistingReactionType === normalizedReactionType) {
            return { ...old, reactions: old.reactions.filter(r => r.id !== existingReaction.id) };
          }

          return {
            ...old,
            reactions: old.reactions.map(r =>
              r.id === existingReaction.id
                ? { ...r, reaction_type: normalizedReactionType }
                : r
            )
          };
        }

        const tempReaction: MessageReaction = {
          id: tempReactionId,
          user_id: userId!,
          reaction_type: normalizedReactionType,
          group_message_id: messageId,
        };
        return { ...old, reactions: [...old.reactions, tempReaction] };
      });

      return { previousData, previousLocalReactions, existingReaction, messageId, tempReactionId };
    },
    onError: (err, variables, context) => {
      // Fires only after all retries are exhausted, so this is the single
      // final rollback.
      const currentUserId = userId;

      // Roll back only THIS user's reaction rows. Reactions from other users
      // that arrived via realtime while the mutation was in flight are kept,
      // so a failed rollback can't erase someone else's reaction.
      if (context?.previousData) {
        const snapshotMine = (context.previousData.reactions || []).filter(
          (r) => r.user_id === currentUserId,
        );
        queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(
          ["group-messages", groupId],
          (live) => {
            if (!live) return context.previousData!;
            const othersReactions = (live.reactions || []).filter((r) => r.user_id !== currentUserId);
            return { ...live, reactions: [...othersReactions, ...snapshotMine.map((r) => ({ ...r }))] };
          },
        );
      }

      if (context?.messageId) {
        const messageId = context.messageId;
        // The rendered list is fail-open for un-reconciled `temp-` reactions,
        // so restoring the query cache alone leaves the unsaved reaction on
        // screen. Restore this user's exact pre-interaction rows for this
        // message while preserving other users' rows.
        const snapshotMineForMessage = (context.previousLocalReactions ?? []).filter(
          (r: any) => r.user_id === currentUserId,
        );
        setLocalMessages((prev) => {
          if (!prev) return prev;
          let changed = false;
          const next = prev.map((m: any) => {
            if (m.id !== messageId) return m;
            const current: any[] = m.reactions || [];
            const restored = [
              ...current.filter((r) => r.user_id !== currentUserId),
              ...snapshotMineForMessage.map((r: any) => ({ ...r })),
            ];
            const sameSet =
              current.length === restored.length &&
              current.every((r) => restored.some((p: any) => p.id === r.id && p.reaction_type === r.reaction_type));
            if (sameSet) return m;
            changed = true;
            return { ...m, reactions: restored };
          });
          return changed ? next : prev;
        });
        delete lastReactionIntentRef.current[messageId];
      }

      toast.error("Couldn't update reaction. Please try again.");
    },

    onSuccess: (result) => {
      if (!result) return;

      queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[] }>(["group-messages", groupId], (old) => {
        if (!old) return { messages: [], reactions: [] };

        if (result.action === 'added' && result.reaction) {
          const filteredReactions = old.reactions.filter(r =>
            !(r.id.startsWith('temp-reaction-') &&
              r.group_message_id === result.reaction.group_message_id &&
              r.user_id === result.reaction.user_id)
          );
          if (!filteredReactions.some(r => r.id === result.reaction.id)) {
            return { ...old, reactions: [...filteredReactions, result.reaction] };
          }
          return { ...old, reactions: filteredReactions };
        }

        if (result.action === 'updated' && result.reaction) {
          return {
            ...old,
            reactions: old.reactions.map(r =>
              r.id === result.reaction.id || (r.id.startsWith('temp-reaction-') && r.group_message_id === result.reaction.group_message_id && r.user_id === result.reaction.user_id)
                ? result.reaction
                : r
            )
          };
        }

        if (result.action === 'removed') {
          return {
            ...old,
            reactions: old.reactions.filter(r => !(r.group_message_id === result.messageId && r.user_id === userId))
          };
        }

        return old;
      });

      if ('messageId' in result && result.messageId) {
        delete lastReactionIntentRef.current[result.messageId];
      }
    },
  });
};
