import { type Dispatch, type RefObject, type SetStateAction, useEffect } from "react";
import { debugLogEvent } from "@/components/chat/chatVirtDebug";
import { sortChatMessagesChronologically } from "@/lib/chatMessageOrder";
import { reconcileMessages } from "@/lib/chatMessageReconciliation";
import { fetchProfilesWithCache } from "@/lib/profileCache";
import type { GroupChatSupabaseClient, GroupMessage, MessageReaction } from "@/features/messaging/thread/groupChatData";

interface UseGroupTargetWindowHydrationOptions {
  targetMessageId: string | null;
  targetJumpNonce: string | number | null;
  groupId?: string;
  authReady: boolean;
  reconcileScope: string;
  localMessagesRef: RefObject<GroupMessage[] | undefined>;
  setLocalMessages: Dispatch<SetStateAction<GroupMessage[] | undefined>>;
  setHasOlderMessages: Dispatch<SetStateAction<boolean>>;
  setJumpRenderNonce: Dispatch<SetStateAction<number | string | null>>;
  supabaseClient: GroupChatSupabaseClient;
}

export const useGroupTargetWindowHydration = ({
  targetMessageId,
  targetJumpNonce,
  groupId,
  authReady,
  reconcileScope,
  localMessagesRef,
  setLocalMessages,
  setHasOlderMessages,
  setJumpRenderNonce,
  supabaseClient,
}: UseGroupTargetWindowHydrationOptions) => {
  // Notification deep-links must be target-anchored, not index-estimated. On
  // repeat taps in long Grounds-style histories, the target already exists in
  // the cached array but Virtuoso can estimate `scrollToIndex` too high and
  // never mount the target row. For every fresh tap, replace first paint with a
  // small window around the exact target so the DOM row is guaranteed to exist.
  useEffect(() => {
    if (!targetMessageId || !groupId || !authReady) return;

    let cancelled = false;

    const hydrateTargetWindow = async () => {
      const { data: target, error } = await supabaseClient
        .from("group_messages")
        .select("id, text, image_url, created_at, edited_at, author_id, group_id, reply_to_id, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label")
        .eq("id", targetMessageId)
        .eq("group_id", groupId)
        .is("deleted_at", null)
        .maybeSingle();

      if (cancelled || error || !target) return;

      const WINDOW_BEFORE = 12;
      const WINDOW_AFTER = 24;
      const [beforeResult, afterResult] = await Promise.all([
        supabaseClient
          .from("group_messages")
          .select("id, text, image_url, created_at, edited_at, author_id, group_id, reply_to_id, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label")
          .eq("group_id", groupId)
          .is("deleted_at", null)
          .lt("created_at", target.created_at)
          .order("created_at", { ascending: false })
          .limit(WINDOW_BEFORE),
        supabaseClient
          .from("group_messages")
          .select("id, text, image_url, created_at, edited_at, author_id, group_id, reply_to_id, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label")
          .eq("group_id", groupId)
          .is("deleted_at", null)
          .gt("created_at", target.created_at)
          .order("created_at", { ascending: true })
          .limit(WINDOW_AFTER),
      ]);

      if (cancelled) return;

      const existingNewer = (localMessagesRef.current || []).filter(
        (message) => new Date(message.created_at).getTime() > new Date(target.created_at).getTime(),
      );
      const rawWindow = [
        ...((beforeResult.data || []) as any[]).reverse(),
        target,
        ...((afterResult.data || []) as any[]),
        ...existingNewer,
      ];
      const byId = new Map<string, any>();
      rawWindow.forEach((message) => byId.set(message.id, message));
      const windowRows = sortChatMessagesChronologically([...byId.values()]);
      const messageIds = windowRows.map((message) => message.id);
      const replyToIds = [...new Set(windowRows.filter((message) => message.reply_to_id).map((message) => message.reply_to_id as string))];
      const authorIds = [...new Set(windowRows.map((message) => message.author_id).filter(Boolean))];

      const [reactionsResult, replyToResult, profilesMap] = await Promise.all([
        supabaseClient
          .from("message_reactions")
          .select("id, user_id, reaction_type, group_message_id")
          .in("group_message_id", messageIds),
        replyToIds.length > 0
          ? supabaseClient
              .from("group_messages")
              .select("id, text, author_id")
              .in("id", replyToIds)
          : Promise.resolve({ data: [] as any[] }),
        fetchProfilesWithCache(authorIds),
      ]);

      if (cancelled) return;

      const replyToMap = new Map((replyToResult.data || []).map((reply: any) => [reply.id, reply]));
      const reactionsByMessage = new Map<string, MessageReaction[]>();
      ((reactionsResult.data || []) as MessageReaction[]).forEach((reaction) => {
        if (!reaction.group_message_id) return;
        if (!reactionsByMessage.has(reaction.group_message_id)) reactionsByMessage.set(reaction.group_message_id, []);
        reactionsByMessage.get(reaction.group_message_id)!.push(reaction);
      });
      const anchoredWindow = windowRows.map((message: any) => {
        const author = profilesMap.get(message.author_id);
        return {
          ...message,
          author: author ? { display_name: author.display_name, avatar_url: author.avatar_url } : message.author ?? null,
          reply_to: message.reply_to_id ? replyToMap.get(message.reply_to_id) || message.reply_to || null : null,
          reactions: reactionsByMessage.get(message.id) || (message as any).reactions || [],
        } as GroupMessage;
      });

      debugLogEvent("local-replace", { cause: "jump-window", nextLen: anchoredWindow.length });
      // See TeamChatPage: only remount the scroller if the target row wasn't
      // already painted, otherwise the remount flashes blank + skeleton.
      const targetAlreadyRendered = (localMessagesRef.current || []).some((m) => m.id === targetMessageId);
      setLocalMessages((reconcileMessages(reconcileScope, anchoredWindow) ?? []) as GroupMessage[]);
      setHasOlderMessages((beforeResult.data || []).length >= WINDOW_BEFORE);
      if (!targetAlreadyRendered) setJumpRenderNonce(targetJumpNonce ?? Date.now());
    };

    void hydrateTargetWindow();

    return () => {
      cancelled = true;
    };
  }, [
    targetMessageId,
    targetJumpNonce,
    groupId,
    authReady,
    reconcileScope,
    localMessagesRef,
    setLocalMessages,
    setHasOlderMessages,
    setJumpRenderNonce,
    supabaseClient,
  ]);
};
