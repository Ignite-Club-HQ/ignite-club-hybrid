import * as fixtureData from "@/lab/fixtureDataLayer";
import { cacheMessagesPageData, getCachedMessagesPageData } from "@/lib/messagesPageCache";
import {
  cacheProfiles,
  fetchProfilesWithCache,
  getProfileFromCache,
  selectCachedProfilesByIds,
} from "@/lib/profileCache";
import { resolveInboxAuthorNames, toInboxPreviewMessage } from "./inboxPreviewHydration";

export interface InboxClub {
  id: string;
  name: string;
  logo_url: string | null;
  sport: string | null;
}

export interface InboxTeam {
  id: string;
  name: string;
  logo_url: string | null;
  deleted_at?: string | null;
  clubs: {
    id: string;
    name: string;
    logo_url: string | null;
    sport: string | null;
    deleted_at?: string | null;
    purged_at?: string | null;
  };
}

type InboxPreview = {
  text: string;
  author: string;
  created_at: string;
  image_url?: string | null;
  is_announcement?: boolean;
};

interface InboxDataClient {
  from: (table: string) => any;
  rpc: (functionName: string, parameters: Record<string, unknown>) => Promise<any>;
}

export async function fetchMemberClubsWithMessages(
  client: InboxDataClient,
  userId: string,
  useIcpLab: boolean,
) {
  if (useIcpLab) {
    const snapshot = fixtureData.getLocalLabMessagesSnapshot(userId);
    return {
      clubs: snapshot.memberClubs,
      latestMessages: snapshot.latestClubMessages,
    };
  }

  const { data: roles, error: rolesError } = await client
    .from("user_roles")
    .select("club_id")
    .eq("user_id", userId)
    .not("club_id", "is", null);

  if (rolesError) throw rolesError;
  if (!roles || roles.length === 0) return { clubs: [] as InboxClub[], latestMessages: {} };

  const clubIds = [...new Set(roles.map((role) => role.club_id).filter(Boolean))];
  const { data } = await client
    .from("clubs")
    .select("id, name, logo_url, sport")
    .in("id", clubIds)
    .is("deleted_at", null)
    .neq("kind", "shell");
  const clubs = data as InboxClub[];
  const latestMessages: Record<string, InboxPreview> = {};

  try {
    const { data: rpcRows, error: rpcError } = await client.rpc(
      "get_inbox_latest_club_messages",
      { _club_ids: clubIds },
    );
    if (rpcError) throw rpcError;
    for (const row of (rpcRows ?? []) as any[]) {
      latestMessages[row.club_id] = {
        text: row.text,
        author: row.author_display_name ?? "",
        created_at: row.created_at,
        image_url: row.image_url,
      };
    }
    return { clubs, latestMessages };
  } catch {
    const messageRows = await Promise.all(
      clubs.map(async (club) => {
        const { data: message } = await client
          .from("club_messages")
          .select("text, created_at, image_url, author_id")
          .eq("club_id", club.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return { clubId: club.id, message };
      }),
    );
    const authorNameById = await resolveInboxAuthorNames(messageRows.map((row) => row.message));
    for (const { clubId, message } of messageRows) {
      if (message) latestMessages[clubId] = toInboxPreviewMessage(message, authorNameById);
    }
    return { clubs, latestMessages };
  }
}

export async function fetchTeamsWithMessages(
  client: InboxDataClient,
  userId: string,
  useIcpLab: boolean,
) {
  if (useIcpLab) {
    const snapshot = fixtureData.getLocalLabMessagesSnapshot(userId);
    return { teams: snapshot.teams, latestMessages: snapshot.latestTeamMessages };
  }

  const { data: roles, error: rolesError } = await client
    .from("user_roles")
    .select("team_id")
    .eq("user_id", userId)
    .not("team_id", "is", null);
  if (rolesError) throw rolesError;

  const teamIds = roles.map((role) => role.team_id).filter(Boolean);
  if (teamIds.length === 0) return { teams: [] as InboxTeam[], latestMessages: {} };

  const { data, error } = await client
    .from("teams")
    .select(`
      id,
      name,
      logo_url,
      deleted_at,
      clubs!club_id (id, name, logo_url, sport, deleted_at, purged_at)
    `)
    .in("id", teamIds)
    .is("deleted_at", null);
  if (error) throw error;

  const teams = ((data || []) as InboxTeam[]).filter((team) =>
    !team.deleted_at && !team.clubs?.deleted_at && !team.clubs?.purged_at,
  );
  const activeTeamIds = teams.map((team) => team.id);
  if (activeTeamIds.length === 0) return { teams: [] as InboxTeam[], latestMessages: {} };

  const latestMessages: Record<string, InboxPreview> = {};
  try {
    const { data: rpcRows, error: rpcError } = await client.rpc(
      "get_inbox_latest_team_messages",
      { _team_ids: activeTeamIds },
    );
    if (rpcError) throw rpcError;
    for (const row of (rpcRows ?? []) as any[]) {
      const isAnnouncement = !!(row.is_club_announcement && row.club_announcement_name);
      latestMessages[row.team_id] = {
        text: row.text,
        author: isAnnouncement ? row.club_announcement_name : (row.author_display_name ?? ""),
        created_at: row.created_at,
        image_url: row.image_url,
        is_announcement: isAnnouncement,
      };
    }
    return { teams, latestMessages };
  } catch {
    const messageRows = await Promise.all(
      teams.map(async (team) => {
        const { data: message } = await client
          .from("team_messages")
          .select("text, created_at, image_url, author_id, is_club_announcement, club_announcement_name")
          .eq("team_id", team.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return { teamId: team.id, message };
      }),
    );
    const authorNameById = await resolveInboxAuthorNames(
      messageRows.map((row) => row.message),
      (message) => !(message.is_club_announcement && message.club_announcement_name),
    );
    for (const { teamId, message } of messageRows) {
      if (message) latestMessages[teamId] = toInboxPreviewMessage(message, authorNameById);
    }
    return { teams, latestMessages };
  }
}

export async function fetchChatGroupsWithMessages(client: InboxDataClient, userId: string) {
  let accessibleIds: string[] | null = null;
  try {
    if (typeof window === "undefined" || window.localStorage.getItem("msg_accessible_ids_rpc") !== "0") {
      const { data: ids, error: idsError } = await client.rpc(
        "get_my_accessible_chat_group_ids",
        { _user_id: userId },
      );
      if (!idsError && Array.isArray(ids)) accessibleIds = ids as string[];
    }
  } catch {
    accessibleIds = null;
  }

  if (accessibleIds && accessibleIds.length === 0) return { groups: [], latestMessages: {} };

  let query = client
    .from("chat_groups")
    .select("*, teams(name, deleted_at), clubs!club_id(name, logo_url, deleted_at, purged_at), mini_leagues:mini_league_id(name)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (accessibleIds) query = query.in("id", accessibleIds);
  const { data, error } = await query;
  if (error) throw error;

  const groups = ((data || []) as any[]).filter((group) =>
    !group.deleted_at
    && !group.clubs?.deleted_at
    && !group.clubs?.purged_at
    && !group.teams?.deleted_at,
  );
  const latestMessages: Record<string, InboxPreview> = {};
  const groupIds = groups.map((group) => group.id);
  if (groupIds.length > 0) {
    try {
      const { data: rpcRows, error: rpcError } = await client.rpc(
        "get_inbox_latest_group_messages",
        { _group_ids: groupIds },
      );
      if (rpcError) throw rpcError;
      for (const row of (rpcRows ?? []) as any[]) {
        latestMessages[row.group_id] = {
          text: row.text,
          author: row.author_display_name ?? "",
          created_at: row.created_at,
          image_url: row.image_url,
        };
      }
      return { groups, latestMessages };
    } catch {
      // Use the per-group compatibility query below when the RPC is unavailable.
    }
  }

  const messageRows = await Promise.all(
    groups.map(async (group) => {
      const { data: message } = await client
        .from("group_messages")
        .select("text, created_at, image_url, author_id")
        .eq("group_id", group.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return { groupId: group.id, message };
    }),
  );
  const authorNameById = await resolveInboxAuthorNames(messageRows.map((row) => row.message));
  for (const { groupId, message } of messageRows) {
    if (message) latestMessages[groupId] = toInboxPreviewMessage(message, authorNameById);
  }
  return { groups, latestMessages };
}

export async function fetchDirectMessageConversations({
  client,
  userId,
  cachedData,
  getPreviousConversations,
}: {
  client: InboxDataClient;
  userId: string;
  cachedData: ReturnType<typeof getCachedMessagesPageData>;
  getPreviousConversations: () => any[] | undefined;
}) {
  const { data: conversations, error } = await client
    .from("direct_conversations")
    .select("*")
    .or(`participant_1.eq.${userId},participant_2.eq.${userId}`)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  if (!conversations?.length) return [];

  const otherUserIds = conversations.map((conversation: any) =>
    conversation.participant_1 === userId ? conversation.participant_2 : conversation.participant_1,
  );
  const conversationIds = conversations.map((conversation: any) => conversation.id);
  const fetchLatestMessages = async (): Promise<Map<string, any>> => {
    try {
      const { data, error: rpcError } = await client.rpc("get_inbox_latest_dm_messages", {
        _conversation_ids: conversationIds,
      });
      if (rpcError) throw rpcError;
      return new Map((data || []).map((row: any) => [
        row.conversation_id,
        {
          text: row.text,
          image_url: row.image_url,
          created_at: row.created_at,
          author_id: row.author_id,
        },
      ]));
    } catch {
      const messageRows = await Promise.all(
        conversations.map(async (conversation: any) => {
          const { data: message } = await client
            .from("direct_messages")
            .select("text, image_url, created_at, author_id")
            .eq("conversation_id", conversation.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          return { conversationId: conversation.id, message };
        }),
      );
      return new Map(messageRows.map((row) => [row.conversationId, row.message]));
    }
  };

  const [profilesMap, messageMap] = await Promise.all([
    (async () => {
      try {
        const { data } = await selectCachedProfilesByIds(otherUserIds);
        if (data?.length) cacheProfiles(data);
        const profiles = new Map<string, any>();
        const cachedAt = Date.now();
        (data ?? []).forEach((profile) => profiles.set(profile.id, { ...profile, cached_at: cachedAt }));
        return profiles;
      } catch {
        return fetchProfilesWithCache(otherUserIds, { allowStale: true, timeout: 15000 });
      }
    })(),
    fetchLatestMessages(),
  ]);

  const previousOtherUsers = new Map<string, any>();
  getPreviousConversations()?.forEach((conversation: any) => {
    if (conversation?.other_user?.id && conversation.other_user.display_name) {
      previousOtherUsers.set(conversation.other_user.id, conversation.other_user);
    }
  });
  cachedData?.dmConversations?.forEach((conversation: any) => {
    if (
      conversation?.other_user?.id
      && conversation.other_user.display_name
      && !previousOtherUsers.has(conversation.other_user.id)
    ) {
      previousOtherUsers.set(conversation.other_user.id, conversation.other_user);
    }
  });

  const result = conversations.map((conversation: any) => {
    const otherUserId = conversation.participant_1 === userId
      ? conversation.participant_2
      : conversation.participant_1;
    const fetchedProfile = profilesMap.get(otherUserId);
    const fallbackProfile = previousOtherUsers.get(otherUserId);
    const globalCached = getProfileFromCache(otherUserId);
    const otherUser = fetchedProfile?.display_name
      ? {
          id: otherUserId,
          display_name: fetchedProfile.display_name,
          avatar_url: fetchedProfile.avatar_url ?? fallbackProfile?.avatar_url ?? globalCached?.avatar_url ?? null,
        }
      : fallbackProfile?.display_name
        ? fallbackProfile
        : globalCached
          ? {
              id: otherUserId,
              display_name: globalCached.display_name,
              avatar_url: globalCached.avatar_url ?? null,
            }
          : fetchedProfile
            ? { id: otherUserId, display_name: null, avatar_url: fetchedProfile.avatar_url ?? null }
            : null;
    return {
      ...conversation,
      other_user: otherUser,
      last_message: messageMap.get(conversation.id) || null,
    };
  });

  const dmConversationsForCache = result.map((conversation: any) => ({
    id: conversation.id,
    participant_1: conversation.participant_1,
    participant_2: conversation.participant_2,
    updated_at: conversation.updated_at,
    created_at: conversation.created_at,
    created_by: conversation.created_by ?? null,
    other_user: conversation.other_user,
  }));
  const latestDMMessages: Record<string, InboxPreview> = {};
  result.forEach((conversation: any) => {
    if (conversation.last_message) {
      latestDMMessages[conversation.id] = {
        text: conversation.last_message.text,
        author: conversation.last_message.author_id === userId
          ? "You"
          : (conversation.other_user?.display_name || ""),
        created_at: conversation.last_message.created_at,
        image_url: conversation.last_message.image_url,
      };
    }
  });
  cacheMessagesPageData(userId, { dmConversations: dmConversationsForCache, latestDMMessages });
  return result;
}
