import type { RefObject } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { markChatFetch } from "@/hooks/useChatPerfMarks";
import { splitPageWindow } from "@/lib/chatPageWindow";
import { getCachedMessages, cacheMessages } from "@/lib/messageCache";
import { fetchProfilesWithCache } from "@/lib/profileCache";
import { isUsableCachedThread } from "@/lib/chatThreadLoadState";
import * as fixtureData from "@/lab/fixtureDataLayer";
import {
  attachReactionsToMessages,
  getCachedGroupMessages,
  type GroupChatSupabaseClient,
  type GroupMessage,
  type MessageReaction,
} from "@/features/messaging/thread/groupChatData";

export interface GroupMessagesQueryData {
  messages: GroupMessage[];
  hasOlderMessages: boolean;
  reactions: MessageReaction[];
  fromCache?: boolean;
}

interface UseGroupMessagesQueryOptions {
  groupId?: string;
  userId?: string;
  useIcpLab: boolean;
  isOnline: boolean;
  queryClient: QueryClient;
  openedFromNotificationRef: RefObject<number | null>;
  pageSize: number;
  supabaseClient: GroupChatSupabaseClient;
}

const fetchGroupMessages = async ({
  groupId,
  userId,
  useIcpLab,
  isOnline,
  queryClient,
  pageSize,
  supabaseClient,
}: Omit<UseGroupMessagesQueryOptions, "openedFromNotificationRef">): Promise<GroupMessagesQueryData> => {
  markChatFetch();
  if (!groupId || !userId) {
    throw new Error("Group message query requires a group and user");
  }

  if (useIcpLab) {
    const messages = fixtureData.getLocalLabGroupMessages(groupId, userId) as GroupMessage[];
    return { messages, hasOlderMessages: false, reactions: [], fromCache: true };
  }

  // If offline, return cached messages using the shared online manager
  // so native app resume does not incorrectly fall back to stale cache.
  if (!isOnline) {
    const cached = getCachedMessages("group", groupId);
    if (cached.length > 0) {
      // Transform cached messages to GroupMessage format
      const groupMessages = cached.map(m => ({
        id: m.id,
        text: m.text,
        image_url: m.image_url,
        created_at: m.created_at,
        author_id: m.author_id,
        group_id: groupId,
        reply_to_id: m.reply_to_id,
        author: m.profiles ? { display_name: m.profiles.display_name, avatar_url: m.profiles.avatar_url } : null,
        reply_to: m.reply_to,
      })) as GroupMessage[];
      const cachedReactions = cached.flatMap((message) =>
        (message.reactions || []).map((reaction) => ({
          id: reaction.id || `cached-${message.id}-${reaction.user_id}-${reaction.reaction_type}`,
          user_id: reaction.user_id,
          reaction_type: reaction.reaction_type,
          group_message_id: message.id,
        }))
      ) as MessageReaction[];
      return {
        messages: attachReactionsToMessages(groupMessages, cachedReactions),
        hasOlderMessages: false,
        reactions: cachedReactions,
        fromCache: true,
      };

    }
    throw new Error("No cached messages available offline");
  }

  // Fetch messages WITHOUT profile join to avoid timeout from large avatar_url
  const { data: rawMessages, error } = await supabaseClient
    .from("group_messages")
    .select("id, text, image_url, created_at, edited_at, author_id, group_id, reply_to_id, deleted_at, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label")
    .eq("group_id", groupId)
    .is("deleted_at", null) // Only fetch non-deleted messages
    .order("created_at", { ascending: false })
    .limit(pageSize + 1);
  if (error) throw error;

  if (!rawMessages?.length) {
    return { messages: [] as GroupMessage[], hasOlderMessages: false, reactions: [] as MessageReaction[] };
  }

  const { items: dataToDisplay, hasMore } = splitPageWindow(rawMessages, pageSize);

  const messageIds = dataToDisplay.map((m) => m.id);
  const replyToIds = dataToDisplay
    .filter((m) => m.reply_to_id)
    .map((m) => m.reply_to_id as string);
  const authorIds = [...new Set(dataToDisplay.map((m) => m.author_id))];

  // Preserve cached reactions when the reactions query fails transiently
  const cachedQueryData = queryClient.getQueryData(["group-messages", groupId]) as GroupMessagesQueryData | undefined;
  const cachedReactions: MessageReaction[] = cachedQueryData?.reactions || [];

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

  if (reactionsResult.error) {
    console.warn("[GroupChat] Failed to fetch reactions, keeping cached reactions", reactionsResult.error);
  }

  const replyToMap = new Map(
    (replyToResult.data || []).map((r: any) => [r.id, {
      ...r,
      author: profilesMap.get(r.author_id) ? { display_name: profilesMap.get(r.author_id)?.display_name } : null,
    }])
  );

  // Map to expected format - use fetched profiles
  const messages = dataToDisplay.map((msg: any) => {
    const replyTo = msg.reply_to_id ? replyToMap.get(msg.reply_to_id) || null : null;
    const profile = profilesMap.get(msg.author_id);
    return {
      ...msg,
      author: profile ? { display_name: profile.display_name, avatar_url: profile.avatar_url } : null,
      reply_to: replyTo,
    };
  }) as GroupMessage[];

  // Cache messages for offline access
  cacheMessages("group", groupId, messages.map(m => ({
    id: m.id,
    text: m.text,
    author_id: m.author_id,
    created_at: m.created_at,
    image_url: m.image_url,
    reply_to_id: m.reply_to_id,
    profiles: m.author ? { display_name: m.author.display_name, avatar_url: m.author.avatar_url } : null,
    reactions: (reactionsResult.data || []).filter((r: any) => r.group_message_id === m.id),
    reply_to: m.reply_to,
  })));

  const resolvedReactions = (
    reactionsResult.error ? cachedReactions : (reactionsResult.data || [])
  ) as MessageReaction[];

  return {
    // Reactions are embedded on the rows as well as returned flat, so any
    // render that seeds straight from this payload shows them immediately.
    messages: attachReactionsToMessages(messages, resolvedReactions),
    hasOlderMessages: hasMore,
    reactions: resolvedReactions,
  };
};

const getGroupMessagesPlaceholderData = (
  prev: GroupMessagesQueryData | undefined,
  groupId: string | undefined,
  openedFromNotificationRef: RefObject<number | null>,
) => {
  if (!groupId) return undefined;
  // SECURITY (cross-group bleed): `prev` is whatever THIS hook instance
  // last rendered. When the route param changes without a remount, that is
  // the PREVIOUS group's message list — returning it verbatim renders
  // group A's messages under group B's header (and bakes them into group
  // B's offline cache). Never reuse `prev` unless every row belongs to the
  // current group.
  const prevBelongsToThisGroup =
    !!prev &&
    Array.isArray(prev.messages) &&
    prev.messages.length > 0 &&
    prev.messages.every((m: any) => !m?.group_id || m.group_id === groupId);
  // From-push freshness: prefer the just-preloaded localStorage cache
  // over a stale `prev` so the new message renders at first paint —
  // but only when the cache has a meaningful history window. A single
  // preloaded row replacing `prev` strands the user with one message
  // floating at the top of an empty viewport.
  if (openedFromNotificationRef.current) {
    const cachedData = getCachedGroupMessages(groupId);
    // Require a meaningful history window (>=5). The notification preload
    // writes a SINGLE message into cache before the chat mounts.
    const cachedHasHistory = cachedData.messages.length >= 5;
    if (cachedHasHistory) {
      return { ...cachedData, hasOlderMessages: false, fromCache: true };
    }
  }
  if (prevBelongsToThisGroup) return prev;

  const cachedData = getCachedGroupMessages(groupId);
  // A genuine one-message thread is usable; a notification-preload stub is not.
  if (!isUsableCachedThread(cachedData.messages as any)) return undefined;

  return { ...cachedData, hasOlderMessages: false, fromCache: true };
};

export const useGroupMessagesQuery = (options: UseGroupMessagesQueryOptions) => {
  const { groupId, userId, openedFromNotificationRef } = options;
  return useQuery({
    queryKey: ["group-messages", groupId],
    queryFn: () => fetchGroupMessages(options),
    enabled: !!groupId && !!userId, // session token is sufficient; don't wait for profile fetch (`authReady`) to unblock first paint
    staleTime: 1000 * 60 * 5, // 5 minutes - show cache instantly
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnMount: "always", // Force refetch on every mount so reactions/messages added while away are picked up (true is a no-op while staleTime is unmet)
    refetchOnWindowFocus: false,
    placeholderData: (prev) => getGroupMessagesPlaceholderData(prev as GroupMessagesQueryData | undefined, groupId, openedFromNotificationRef),
  });
};
