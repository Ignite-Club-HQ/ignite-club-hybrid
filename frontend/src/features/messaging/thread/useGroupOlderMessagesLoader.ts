import { type Dispatch, type RefObject, type SetStateAction, useCallback } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { fetchProfilesWithCache } from "@/lib/profileCache";
import { splitPageWindow } from "@/lib/chatPageWindow";
import { reconcileMessages } from "@/lib/chatMessageReconciliation";
import { withFeatureBackend } from "@/live/featureRouter";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { listLiveLatestMessagesPage } from "@/live/features/messaging";
import { mapLiveGroupRows } from "@/features/messaging/thread/useGroupMessagesQuery";
import type { GroupChatSupabaseClient, GroupMessage, MessageReaction } from "@/features/messaging/thread/groupChatData";


interface UseGroupOlderMessagesLoaderOptions {
  groupId?: string;
  queryClient: QueryClient;
  localMessagesRef: RefObject<GroupMessage[] | undefined>;
  isLoadingOlder: boolean;
  setIsLoadingOlder: Dispatch<SetStateAction<boolean>>;
  hasOlderMessages: boolean;
  setHasOlderMessages: Dispatch<SetStateAction<boolean>>;
  reconcileScope: string;
  pageSize: number;
  supabaseClient: GroupChatSupabaseClient;
  /** Backward cursor for live ICP scroll-back paging (set by the messages query). */
  icpOlderCursorRef?: RefObject<number | null>;
}


export const useGroupOlderMessagesLoader = ({
  groupId,
  queryClient,
  localMessagesRef,
  isLoadingOlder,
  setIsLoadingOlder,
  hasOlderMessages,
  setHasOlderMessages,
  reconcileScope,
  pageSize,
  supabaseClient,
  icpOlderCursorRef,
}: UseGroupOlderMessagesLoaderOptions) => {

  // Virtuoso owns scroll-anchoring on prepend natively (firstItemIndex +
  // followOutput). No DOM scrollTop math required — just commit the cache
  // mutation and let Virtuoso preserve the visible window.
  const queueAnchoredPrepend = useCallback((commit: () => void) => commit(), []);

  // Load older messages function with timeout protection
  return useCallback(async () => {
    const currentMessages = localMessagesRef.current;
    if (!currentMessages?.length || isLoadingOlder || !hasOlderMessages) return;
    // Live ICP: walk the canister's backward cursor. Each page returns the
    // newest rows older than the cursor plus the next cursor (null = start of
    // the chat).
    if (isFeatureRoutedToIcp("messaging")) {
      const cursor = icpOlderCursorRef?.current ?? null;
      if (cursor == null) {
        setHasOlderMessages(false);
        return;
      }
      setIsLoadingOlder(true);
      try {
        const result = await withFeatureBackend("messaging", {
          supabase: async () => { throw new Error("unreachable: messaging routed to ICP"); },
          icp: async (ctx) => {
            const page = await listLiveLatestMessagesPage(ctx, groupId!, cursor, pageSize);
            const older = await mapLiveGroupRows(ctx, groupId!, page.messages);
            const nextCursor =
              Array.isArray(page.next_sequence) && page.next_sequence.length > 0
                ? Number(page.next_sequence[0])
                : null;
            return { older, nextCursor };
          },
        });
        if (icpOlderCursorRef) icpOlderCursorRef.current = result.nextCursor;
        setHasOlderMessages(result.nextCursor !== null);
        queueAnchoredPrepend(() => {
          queryClient.setQueryData(["group-messages", groupId], (old: any) => {
            if (!old) {
              return { messages: result.older, reactions: [] as MessageReaction[], hasOlderMessages: result.nextCursor !== null };
            }
            const existingIds = new Set((old.messages || []).map((m: GroupMessage) => m.id));
            return {
              ...old,
              messages: [
                ...result.older.filter((m) => !existingIds.has(m.id)),
                ...old.messages,
              ],
              hasOlderMessages: result.nextCursor !== null,
            };
          });
        });
      } catch (err) {
        console.error("Failed to load older messages:", err);
      } finally {
        setIsLoadingOlder(false);
      }
      return;
    }


    setIsLoadingOlder(true);

    // Create abort controller for timeout. 25s gives slow networks/cold queries
    // enough headroom; the previous 10s was tripping AbortError on real users.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    try {
      const oldestMessage = currentMessages.reduce((oldest, message) =>
        new Date(message.created_at).getTime() < new Date(oldest.created_at).getTime() ? message : oldest,
      currentMessages[0]);

      const { data: olderData, error } = await supabaseClient
        .from("group_messages")
        .select("id, text, image_url, created_at, edited_at, author_id, group_id, reply_to_id, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label")
        .eq("group_id", groupId!)
        .is("deleted_at", null)
        .lt("created_at", oldestMessage.created_at)
        .order("created_at", { ascending: false })
        .limit(pageSize + 1)
        .abortSignal(controller.signal);

      clearTimeout(timeoutId);

      if (error) throw error;
      if (!olderData?.length) {
        setHasOlderMessages(false);
        return;
      }

      const { items: dataToUse, hasMore } = splitPageWindow(olderData, pageSize);
      setHasOlderMessages(hasMore);

      // Reverse to get chronological order
      const reversedOlder = [...dataToUse].reverse();
      const messageIds = reversedOlder.map((m) => m.id);
      const replyToIds = reversedOlder.filter((m) => m.reply_to_id).map((m) => m.reply_to_id);
      const authorIds = [...new Set(reversedOlder.map((m) => m.author_id))];

      // Single-pass enrichment: fetch reactions, reply-to, profiles BEFORE
      // prepending. Rendering rows first as `reply_to: null` and patching them
      // a moment later causes reply pills to grow above the user's anchor —
      // visible as "messages keep moving after I stop scrolling".
      let reactionsData: any[] = [];
      let replyToData: any[] = [];
      const profilesMap = new Map<string, { display_name: string | null; avatar_url: string | null }>();

      try {
        const secondaryController = new AbortController();
        const secondaryTimeout = setTimeout(() => secondaryController.abort(), 5000);

        const [reactionsResult, replyToResult, cachedProfiles] = await Promise.all([
          supabaseClient
            .from("message_reactions")
            .select("id, user_id, reaction_type, group_message_id")
            .in("group_message_id", messageIds)
            .abortSignal(secondaryController.signal),
          replyToIds.length > 0
            ? supabaseClient
                .from("group_messages")
                .select("id, text, author_id")
                .in("id", replyToIds)
                .abortSignal(secondaryController.signal)
            : Promise.resolve({ data: [] as any[], error: null }),
          fetchProfilesWithCache(authorIds),
        ]);

        clearTimeout(secondaryTimeout);
        reactionsData = reactionsResult.data || [];
        replyToData = replyToResult.data || [];
        cachedProfiles.forEach((p, id) => {
          profilesMap.set(id, { display_name: p.display_name, avatar_url: p.avatar_url });
        });
      } catch {
        // Continue without enrichment if it fails/timeouts.
      }

      const enrichedOlderMessages = (reconcileMessages(
        reconcileScope,
        reversedOlder.map((msg) => ({
          ...msg,
          author: profilesMap.get(msg.author_id) || null,
          reply_to: replyToData.find((r) => r.id === msg.reply_to_id) || null,
        })) as GroupMessage[],
      ) ?? []) as GroupMessage[];

      // Prepend + restore scroll anchor synchronously inside flushSync (no jolt).
      queueAnchoredPrepend(() => {
        queryClient.setQueryData<{ messages: GroupMessage[], reactions: MessageReaction[], hasOlderMessages?: boolean }>(["group-messages", groupId], (old: any) => {
          if (!old) return { messages: enrichedOlderMessages, reactions: reactionsData as MessageReaction[], hasOlderMessages: hasMore };
          const existingIds = new Set((old.messages || []).map((m: GroupMessage) => m.id));
          return {
            ...old,
            messages: [
              ...enrichedOlderMessages.filter((m) => !existingIds.has(m.id)),
              ...old.messages,
            ],
            reactions: [...(reactionsData as MessageReaction[]), ...(old.reactions || [])],
            hasOlderMessages: hasMore,
          };
        });
      });
      return;
    } catch (err) {
      clearTimeout(timeoutId);
      console.error('Failed to load older messages:', err);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [
    groupId,
    queryClient,
    localMessagesRef,
    isLoadingOlder,
    setIsLoadingOlder,
    hasOlderMessages,
    setHasOlderMessages,
    reconcileScope,
    pageSize,
    supabaseClient,
    icpOlderCursorRef,
    queueAnchoredPrepend,
  ]);

};
