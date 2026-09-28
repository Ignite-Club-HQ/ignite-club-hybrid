import { type Dispatch, type SetStateAction, useLayoutEffect } from "react";
import { debugLogEvent } from "@/components/chat/chatVirtDebug";
import { cacheMessages } from "@/lib/messageCache";
import { sortChatMessagesChronologically } from "@/lib/chatMessageOrder";
import { isTombstoned, reconcileMessages } from "@/lib/chatMessageReconciliation";
import { reconcileReactions } from "@/lib/chatReactionReconciliation";
import type { GroupMessage, MessageReaction } from "@/features/messaging/thread/groupChatData";

interface UseGroupLocalMessagesSyncOptions {
  messages: GroupMessage[];
  reactions: MessageReaction[];
  groupId?: string;
  threadPhase: string;
  reconcileScope: string;
  localMessages: GroupMessage[] | undefined;
  setLocalMessages: Dispatch<SetStateAction<GroupMessage[] | undefined>>;
}

export const useGroupLocalMessagesSync = ({
  messages,
  reactions,
  groupId,
  threadPhase,
  reconcileScope,
  localMessages,
  setLocalMessages,
}: UseGroupLocalMessagesSyncOptions) => {
  useLayoutEffect(() => {
    // Sync local render state with query cache without dropping newer optimistic/realtime reactions.
    // IMPORTANT: In GroupChatPage, reactions come as a separate top-level array in messagesData,
    // NOT embedded on each message. We must merge the top-level reactions onto each message here.
    // Guard: never replace existing messages with an empty array, and only
    // commit an empty thread once the classifier says it is authoritatively
    // empty (not paused/pending/recovering).
    if (!messages || !groupId) return;
    if (messages.length === 0 && localMessages && localMessages.length > 0) return;
    if (messages.length === 0 && threadPhase !== "empty") return;

    // Build a map of incoming reactions from the top-level reactions array
    const incomingReactionsByMsg = new Map<string, MessageReaction[]>();
    reactions.forEach((r: MessageReaction) => {
      if (!r.group_message_id) return;
      if (!incomingReactionsByMsg.has(r.group_message_id)) incomingReactionsByMsg.set(r.group_message_id, []);
      incomingReactionsByMsg.get(r.group_message_id)!.push(r);
    });

    setLocalMessages((prev) => {
      const incomingIds = new Set(messages.map((message) => message.id));
      const realByAuthorText = new Set(
        messages
          .filter((m: any) => !m.id.startsWith("temp-") && !m.id.startsWith("queued-"))
          .map((m: any) => `${m.author_id}::${m.text ?? ""}::${m.image_url ?? ""}`),
      );
      const previousOnly = (prev || []).filter((message: any) => {
        // SECURITY (cross-group bleed): this merge is deliberately fail-open —
        // it keeps prior rows that are absent from the incoming snapshot. A row
        // left over from another group's thread (route param changed without a
        // remount) would otherwise satisfy every keep-condition below and be
        // merged into THIS group permanently, then persisted to this group's
        // offline cache. Foreign rows are never kept.
        if (message.group_id && message.group_id !== groupId) return false;
        if (incomingIds.has(message.id)) return false;
        // A soft-deleted row is absent from `messages`; without this guard the
        // fail-open branch below would re-add it on every sync.

        // fail-open branch below would re-add it on every sync.
        if (isTombstoned(reconcileScope, message.id)) return false;
        if (message.id.startsWith("temp-") || message.id.startsWith("queued-")) {
          const key = `${message.author_id}::${message.text ?? ""}::${message.image_url ?? ""}`;
          if (realByAuthorText.has(key)) return false;
        }
        return true;
      });
      const mergedIncomingMessages = messages.map((message) => {
        // The flat reactions array is only refreshed by fetch + realtime, but
        // ChatMessage's optimistic add/remove writes to the EMBEDDED
        // message.reactions in the query cache. Union both sources so a
        // tap-to-react survives this merge; recorded realtime deletes are
        // re-applied to the final list below so a stale in-flight fetch can't
        // revive a removed row.
        const flatIncoming = incomingReactionsByMsg.get(message.id) || [];
        const embeddedIncoming = ((message as any).reactions || []) as MessageReaction[];
        const flatIds = new Set(flatIncoming.map((r) => r.id));
        const incomingReactions = [
          ...flatIncoming,
          ...embeddedIncoming.filter(
            (r) =>
              r &&
              r.id &&
              !flatIds.has(r.id) &&
              // One reaction per user per message: once the flat array holds
              // the confirmed row, drop the user's leftover temp row.
              !(r.id.startsWith("temp-") && flatIncoming.some((f) => f.user_id === r.user_id)),
          ),
        ];
        const previousMessage = prev?.find((item) => item.id === message.id);
        const previousReactions: MessageReaction[] = (previousMessage as any)?.reactions || [];

        if (previousReactions.length === 0) {
          return { ...message, reactions: incomingReactions };
        }

        const incomingIds = new Set(incomingReactions.map((r) => r.id));
        const incomingByUser = new Map<string, MessageReaction>();
        incomingReactions.forEach((r) => incomingByUser.set(r.user_id, r));

        // Only preserve temporary optimistic reactions that have not been
        // reconciled yet. Keeping confirmed reactions here can revive deleted
        // group reactions until the next full refresh.
        const missingFromIncoming = previousReactions.filter((reaction) => {
          if (incomingIds.has(reaction.id)) return false;
          if (!reaction.id.startsWith("temp-")) return false;
          return !incomingByUser.has(reaction.user_id);
        });

        return {
          ...message,
          reactions: [...incomingReactions, ...missingFromIncoming],
        };
      });
      const mergedMessages = (reconcileReactions(
        reconcileScope,
        (reconcileMessages(
          reconcileScope,
          sortChatMessagesChronologically([...previousOnly, ...mergedIncomingMessages]),
        ) ?? []) as GroupMessage[],
      ) ?? []) as GroupMessage[];
      if (prev && mergedMessages.length < prev.length - 5) {
        debugLogEvent("local-replace", {
          cause: "merge-shrink",
          prevLen: prev.length,
          nextLen: mergedMessages.length,
          incomingLen: messages.length,
        });
      }

      cacheMessages("group", groupId, mergedMessages.map((m) => ({
        id: m.id,
        text: m.text,
        author_id: m.author_id,
        created_at: m.created_at,
        image_url: m.image_url,
        reply_to_id: m.reply_to_id,
        profiles: m.author ? { display_name: m.author.display_name, avatar_url: m.author.avatar_url } : null,
        reactions: ((m as any).reactions || []).map((reaction: any) => ({
          id: reaction.id,
          user_id: reaction.user_id,
          reaction_type: reaction.reaction_type,
        })),
        reply_to: m.reply_to,
      })));

      // Identity bail-out: if merged is structurally identical to prev
      // (same IDs in same order, same reaction id-set per message, same
      // text/image_url), return prev so Virtuoso doesn't see a new `data`
      // reference and doesn't run a re-layout pass that flashes the
      // viewport blank for a frame on cold-start push taps.
      if (prev && prev.length === mergedMessages.length) {
        let identical = true;
        for (let i = 0; i < prev.length; i++) {
          const a = prev[i] as any;
          const b = mergedMessages[i] as any;
          if (
            a.id !== b.id ||
            a.text !== b.text ||
            a.image_url !== b.image_url ||
            a.reply_to_id !== b.reply_to_id
          ) { identical = false; break; }
          const ar: any[] = a.reactions || [];
          const br: any[] = b.reactions || [];
          if (ar.length !== br.length) { identical = false; break; }
          if (ar.length > 0) {
            // Compare reaction CONTENT (id + user + type), not just the id set,
            // so a temp -> confirmed reaction transition with an equal id set
            // still bails out instead of producing a new array identity on
            // every pass (React #185 guard).
            const sig = (list: any[]) =>
              list
                .map((r) => `${r.id}::${r.user_id}::${r.reaction_type}`)
                .sort()
                .join("|");
            if (sig(ar) !== sig(br)) { identical = false; break; }
          }
        }
        if (identical) return prev;
      }

      return mergedMessages;
    });
  }, [messages, reactions, groupId, threadPhase]);
};
