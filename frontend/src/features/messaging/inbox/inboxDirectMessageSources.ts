import {
  cacheProfiles,
  fetchProfilesWithCache,
  selectCachedProfilesByIds,
  type CachedProfile,
} from "@/lib/profileCache";

export interface CachedDirectMessagePreview {
  text?: string | null;
  image_url?: string | null;
  created_at: string;
  author?: string | null;
}

export interface CachedDirectMessageRow {
  id: string;
  created_at?: string | null;
  updated_at?: string | null;
  created_by?: string | null;
  other_user?: { id?: string | null } | null;
}

export type HydratedDirectMessageRow<T extends CachedDirectMessageRow> = T & {
  created_at: string | null;
  created_by: string | null;
  last_message: {
    text: string | null;
    image_url: string | null;
    created_at: string;
    author_id: string;
  } | null;
};

export interface DirectMessagePeerProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface DirectMessageConversationIdentitySource {
  other_user?: DirectMessagePeerProfile | null;
}

export type LoadedDirectMessagePeerProfile = CachedProfile & { cached_at?: number };

export async function loadDirectMessagePeerProfiles(
  userIds: readonly string[],
  options: {
    selectProfiles?: typeof selectCachedProfilesByIds;
    refreshCache?: typeof cacheProfiles;
    fetchStale?: typeof fetchProfilesWithCache;
    now?: () => number;
  } = {},
): Promise<Map<string, LoadedDirectMessagePeerProfile>> {
  const selectProfiles = options.selectProfiles ?? selectCachedProfilesByIds;
  const refreshCache = options.refreshCache ?? cacheProfiles;
  const fetchStale = options.fetchStale ?? fetchProfilesWithCache;
  const now = options.now ?? Date.now;

  try {
    const { data } = await selectProfiles(userIds);
    if (data?.length) refreshCache(data);
    const loaded = new Map<string, LoadedDirectMessagePeerProfile>();
    const cachedAt = now();
    for (const profile of data ?? []) loaded.set(profile.id, { ...profile, cached_at: cachedAt });
    return loaded;
  } catch {
    return fetchStale(userIds, { allowStale: true, timeout: 15_000 });
  }
}

export function buildPreviousDirectMessagePeerMap(options: {
  live?: readonly DirectMessageConversationIdentitySource[] | null;
  cached?: readonly DirectMessageConversationIdentitySource[] | null;
}): Map<string, DirectMessagePeerProfile> {
  const peers = new Map<string, DirectMessagePeerProfile>();
  for (const conversation of options.live ?? []) {
    const peer = conversation.other_user;
    if (peer?.id && peer.display_name) peers.set(peer.id, peer);
  }
  for (const conversation of options.cached ?? []) {
    const peer = conversation.other_user;
    if (peer?.id && peer.display_name && !peers.has(peer.id)) peers.set(peer.id, peer);
  }
  return peers;
}

export function resolveDirectMessagePeerProfile(options: {
  otherUserId: string;
  fetched?: DirectMessagePeerProfile | null;
  previous?: DirectMessagePeerProfile | null;
  globalCached?: DirectMessagePeerProfile | null;
}): DirectMessagePeerProfile | null {
  const { otherUserId, fetched, previous, globalCached } = options;

  if (fetched?.display_name) {
    return {
      id: otherUserId,
      display_name: fetched.display_name,
      avatar_url: fetched.avatar_url ?? previous?.avatar_url ?? globalCached?.avatar_url ?? null,
    };
  }
  if (previous?.display_name) return previous;
  if (globalCached) {
    return {
      id: otherUserId,
      display_name: globalCached.display_name,
      avatar_url: globalCached.avatar_url ?? null,
    };
  }
  if (fetched) {
    return {
      id: otherUserId,
      display_name: null,
      avatar_url: fetched.avatar_url ?? null,
    };
  }
  return null;
}

export interface DirectMessageConversationSource {
  id: string;
  participant_1: string;
  participant_2: string;
}

export interface DirectMessagePreviewSource {
  text: string;
  image_url: string | null;
  created_at: string;
  author_id: string;
}

export type AssembledDirectMessageConversation<T extends DirectMessageConversationSource> = T & {
  other_user: DirectMessagePeerProfile | null;
  last_message: DirectMessagePreviewSource | null;
};

export function assembleDirectMessageInboxConversations<T extends DirectMessageConversationSource>(options: {
  conversations: readonly T[];
  currentUserId: string;
  fetchedProfiles: ReadonlyMap<string, DirectMessagePeerProfile>;
  previousProfiles: ReadonlyMap<string, DirectMessagePeerProfile>;
  latestMessages: ReadonlyMap<string, DirectMessagePreviewSource | null>;
  getGlobalProfile: (userId: string) => DirectMessagePeerProfile | null | undefined;
}): AssembledDirectMessageConversation<T>[] {
  return options.conversations.map((conversation) => {
    const otherUserId = conversation.participant_1 === options.currentUserId
      ? conversation.participant_2
      : conversation.participant_1;
    const otherUser = resolveDirectMessagePeerProfile({
      otherUserId,
      fetched: options.fetchedProfiles.get(otherUserId),
      previous: options.previousProfiles.get(otherUserId),
      globalCached: options.getGlobalProfile(otherUserId),
    });
    return {
      ...conversation,
      other_user: otherUser,
      last_message: options.latestMessages.get(conversation.id) || null,
    };
  });
}

export interface DirectMessageCacheConversationSource extends DirectMessageConversationSource {
  updated_at: string | null;
  created_at?: string | null;
  created_by?: string | null;
  other_user: DirectMessagePeerProfile | null;
  last_message: DirectMessagePreviewSource | null;
}

export interface DirectMessageCachePayload {
  dmConversations: Array<{
    id: string;
    participant_1: string;
    participant_2: string;
    updated_at: string | null;
    created_at: string | null | undefined;
    created_by: string | null;
    other_user: DirectMessagePeerProfile | null;
  }>;
  latestDMMessages: Record<string, {
    text: string;
    author: string;
    created_at: string;
    image_url?: string | null;
  }>;
}

export function buildDirectMessageCachePayload(options: {
  conversations: readonly DirectMessageCacheConversationSource[];
  currentUserId: string;
}): DirectMessageCachePayload {
  const dmConversations = options.conversations.map((conversation) => ({
    id: conversation.id,
    participant_1: conversation.participant_1,
    participant_2: conversation.participant_2,
    updated_at: conversation.updated_at,
    created_at: conversation.created_at,
    created_by: conversation.created_by ?? null,
    other_user: conversation.other_user,
  }));
  const latestDMMessages: DirectMessageCachePayload["latestDMMessages"] = {};
  for (const conversation of options.conversations) {
    if (!conversation.last_message) continue;
    latestDMMessages[conversation.id] = {
      text: conversation.last_message.text,
      author: conversation.last_message.author_id === options.currentUserId
        ? "You"
        : (conversation.other_user?.display_name || ""),
      created_at: conversation.last_message.created_at,
      image_url: conversation.last_message.image_url,
    };
  }
  return { dmConversations, latestDMMessages };
}

export function hydrateCachedDirectMessages<T extends CachedDirectMessageRow>(options: {
  conversations?: readonly T[] | null;
  latestMessages?: Record<string, CachedDirectMessagePreview | null | undefined> | null;
  currentUserId?: string | null;
}): HydratedDirectMessageRow<T>[] {
  const { conversations, latestMessages, currentUserId } = options;
  if (!conversations?.length) return [];

  return conversations.map((conversation) => {
    const preview = latestMessages?.[conversation.id];
    return {
      ...conversation,
      created_at: conversation.created_at || conversation.updated_at || null,
      created_by: conversation.created_by || null,
      last_message: preview
        ? {
            text: preview.text ?? null,
            image_url: preview.image_url || null,
            created_at: preview.created_at,
            author_id: preview.author === "You"
              ? currentUserId || ""
              : conversation.other_user?.id || "",
          }
        : null,
    };
  });
}

export function resolveEffectiveDirectMessages<T>(options: {
  sticky?: readonly T[] | null;
  offlineCached?: readonly T[] | null;
  isOnline: boolean;
}): readonly T[] {
  const { sticky, offlineCached, isOnline } = options;
  if (sticky?.length) return sticky;
  if (!isOnline && offlineCached?.length) return offlineCached;
  return sticky ?? [];
}
