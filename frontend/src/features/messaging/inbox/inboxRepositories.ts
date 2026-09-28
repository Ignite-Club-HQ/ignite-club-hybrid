import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { resolveClubProAccess } from "@/lib/proEntitlement";
import { selectCachedProfileById, selectCachedProfilesByIds } from "@/lib/profileCache";
import { deriveActiveMutedChats, type ActiveMutedChats } from "./inboxReadModel";

type IgniteSupabaseClient = SupabaseClient<Database>;

export type InboxSystemMessage = Database["public"]["Tables"]["system_messages"]["Row"];

/**
 * Reads the current user's latest welcome message without owning React Query
 * policy. The legacy inbox treats an unavailable read as no welcome message;
 * that failure contract remains explicit here until product behaviour changes.
 */
export async function fetchInboxSystemMessage(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<InboxSystemMessage | null> {
  const { data, error } = await client
    .from("system_messages")
    .select("*")
    .eq("user_id", userId)
    .eq("message_type", "welcome")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data;
}

export interface InboxBroadcastPreview {
  text: string;
  created_at: string;
  image_url: string | null;
  author_id: string | null;
  profiles: { display_name: string };
}

export type InboxBroadcastPrefetchMessage = Pick<
  Database["public"]["Tables"]["broadcast_messages"]["Row"],
  "id" | "text" | "created_at" | "author_id" | "image_url" | "reply_to_id"
>;

export interface InboxBroadcastPrefetchPage {
  messages: InboxBroadcastPrefetchMessage[];
  hasOlderMessages: boolean;
}

export type InboxTeamPrefetchMessage = Pick<
  Database["public"]["Tables"]["team_messages"]["Row"],
  "id" | "text" | "created_at" | "author_id" | "image_url" | "reply_to_id" | "team_id"
>;

export interface InboxTeamPrefetchPage {
  messages: InboxTeamPrefetchMessage[];
  hasOlderMessages: boolean;
}

export type InboxClubPrefetchMessage = Pick<
  Database["public"]["Tables"]["club_messages"]["Row"],
  "id" | "text" | "created_at" | "author_id" | "image_url" | "reply_to_id" | "club_id"
>;

export interface InboxClubPrefetchPage {
  messages: InboxClubPrefetchMessage[];
  hasOlderMessages: boolean;
}

export type InboxGroupPrefetchMessage = Pick<
  Database["public"]["Tables"]["group_messages"]["Row"],
  "id" | "text" | "created_at" | "author_id" | "image_url" | "reply_to_id" | "group_id"
>;

export interface InboxGroupPrefetchPage {
  messages: InboxGroupPrefetchMessage[];
  hasOlderMessages: boolean;
}

/** Reads one immutable group scope for the inbox's idle thread prefetch. */
export async function fetchInboxGroupPrefetchPage(
  groupId: string,
  pageSize: number,
  client: IgniteSupabaseClient = supabase,
): Promise<InboxGroupPrefetchPage> {
  const { data } = await client
    .from("group_messages")
    .select("id, text, created_at, author_id, image_url, reply_to_id, group_id")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(pageSize + 1);

  if (!data?.length) return { messages: [], hasOlderMessages: false };
  const hasOlderMessages = data.length > pageSize;
  const page = hasOlderMessages ? data.slice(0, pageSize) : data;
  return { messages: [...page].reverse(), hasOlderMessages };
}

/** Reads one immutable club scope for the inbox's idle thread prefetch. */
export async function fetchInboxClubPrefetchPage(
  clubId: string,
  pageSize: number,
  client: IgniteSupabaseClient = supabase,
): Promise<InboxClubPrefetchPage> {
  const { data } = await client
    .from("club_messages")
    .select("id, text, created_at, author_id, image_url, reply_to_id, club_id")
    .eq("club_id", clubId)
    .order("created_at", { ascending: false })
    .limit(pageSize + 1);

  if (!data?.length) return { messages: [], hasOlderMessages: false };
  const hasOlderMessages = data.length > pageSize;
  const page = hasOlderMessages ? data.slice(0, pageSize) : data;
  return { messages: [...page].reverse(), hasOlderMessages };
}

/** Reads one immutable team scope for the inbox's idle thread prefetch. */
export async function fetchInboxTeamPrefetchPage(
  teamId: string,
  pageSize: number,
  client: IgniteSupabaseClient = supabase,
): Promise<InboxTeamPrefetchPage> {
  const { data } = await client
    .from("team_messages")
    .select("id, text, created_at, author_id, image_url, reply_to_id, team_id")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })
    .limit(pageSize + 1);

  if (!data?.length) return { messages: [], hasOlderMessages: false };
  const hasOlderMessages = data.length > pageSize;
  const page = hasOlderMessages ? data.slice(0, pageSize) : data;
  return { messages: [...page].reverse(), hasOlderMessages };
}

/**
 * Reads the initial broadcast thread page for the inbox's idle prefetch. The
 * caller continues to own whether/when prefetching runs and its React Query
 * cache policy.
 */
export async function fetchInboxBroadcastPrefetchPage(
  pageSize: number,
  client: IgniteSupabaseClient = supabase,
): Promise<InboxBroadcastPrefetchPage> {
  const { data } = await client
    .from("broadcast_messages")
    .select("id, text, created_at, author_id, image_url, reply_to_id")
    .order("created_at", { ascending: false })
    .limit(pageSize + 1);

  if (!data?.length) return { messages: [], hasOlderMessages: false };
  const hasOlderMessages = data.length > pageSize;
  const page = hasOlderMessages ? data.slice(0, pageSize) : data;
  return { messages: [...page].reverse(), hasOlderMessages };
}

export async function fetchInboxLatestBroadcast(
  options: {
    client?: IgniteSupabaseClient;
    selectProfile?: typeof selectCachedProfileById;
  } = {},
): Promise<InboxBroadcastPreview | null> {
  const client = options.client ?? supabase;
  const selectProfile = options.selectProfile ?? selectCachedProfileById;
  const { data } = await client
    .from("broadcast_messages")
    .select("text, created_at, image_url, author_id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  let authorName = "";
  if (data.author_id) {
    const { data: profile } = await selectProfile(data.author_id);
    if (profile?.display_name) authorName = profile.display_name;
  }

  return {
    text: data.text,
    created_at: data.created_at,
    image_url: data.image_url,
    author_id: data.author_id,
    profiles: { display_name: authorName },
  };
}

export interface InboxLatestDirectMessage {
  text: string;
  image_url: string | null;
  created_at: string;
  author_id: string;
}

interface InboxLatestDirectMessageRpcRow extends InboxLatestDirectMessage {
  conversation_id: string;
}

export async function fetchInboxLatestDirectMessages(
  conversationIds: readonly string[],
  client: IgniteSupabaseClient = supabase,
): Promise<Map<string, InboxLatestDirectMessage | null>> {
  if (conversationIds.length === 0) return new Map();

  try {
    const rpcClient = client as unknown as {
      rpc: (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: InboxLatestDirectMessageRpcRow[] | null; error: unknown }>;
    };
    const { data, error } = await rpcClient.rpc(
      "get_inbox_latest_dm_messages",
      { _conversation_ids: [...conversationIds] },
    );
    if (error) throw error;
    const messages = new Map<string, InboxLatestDirectMessage | null>();
    for (const row of data ?? []) {
      messages.set(row.conversation_id, {
        text: row.text,
        image_url: row.image_url,
        created_at: row.created_at,
        author_id: row.author_id,
      });
    }
    return messages;
  } catch {
    const messageRows = await Promise.all(
      conversationIds.map(async (conversationId) => {
        const { data } = await client
          .from("direct_messages")
          .select("text, image_url, created_at, author_id")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return { conversationId, message: data };
      }),
    );
    return new Map(messageRows.map(({ conversationId, message }) => [conversationId, message]));
  }
}

export type InboxDirectConversation = Database["public"]["Tables"]["direct_conversations"]["Row"];

export interface InboxDirectConversationMembership {
  conversations: InboxDirectConversation[];
  otherUserIds: string[];
}

export async function fetchInboxDirectConversationMembership(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<InboxDirectConversationMembership> {
  const { data, error } = await client
    .from("direct_conversations")
    .select("*")
    .or(`participant_1.eq.${userId},participant_2.eq.${userId}`)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  const conversations = data ?? [];
  const otherUserIds = conversations.map((conversation) => (
    conversation.participant_1 === userId
      ? conversation.participant_2
      : conversation.participant_1
  ));
  return { conversations, otherUserIds };
}

export interface InboxMemberClub {
  id: string;
  name: string;
  logo_url: string | null;
  sport: string | null;
}

export interface InboxLatestClubMessage {
  text: string;
  author: string;
  created_at: string;
  image_url?: string | null;
}

export interface InboxMemberClubsWithMessages {
  clubs: InboxMemberClub[];
  latestMessages: Record<string, InboxLatestClubMessage>;
}

interface InboxLatestClubMessageRpcRow {
  club_id: string;
  text: string;
  author_display_name: string | null;
  created_at: string;
  image_url: string | null;
}

/**
 * Reads the club section of the inbox without owning React Query policy.
 * The RPC remains the preferred path; its legacy per-club fallback is kept so
 * deployments can roll forward independently from the database function.
 */
export async function fetchInboxMemberClubsWithMessages(
  userId: string,
  options: {
    client?: IgniteSupabaseClient;
    selectProfiles?: typeof selectCachedProfilesByIds;
  } = {},
): Promise<InboxMemberClubsWithMessages> {
  const client = options.client ?? supabase;
  const selectProfiles = options.selectProfiles ?? selectCachedProfilesByIds;
  const { data: roles, error: rolesError } = await client
    .from("user_roles")
    .select("club_id")
    .eq("user_id", userId)
    .not("club_id", "is", null);

  if (rolesError) throw rolesError;
  if (!roles?.length) return { clubs: [], latestMessages: {} };

  const clubIds = [...new Set(
    roles.map((role) => role.club_id).filter((clubId): clubId is string => !!clubId),
  )];
  const { data } = await client
    .from("clubs")
    .select("id, name, logo_url, sport")
    .in("id", clubIds)
    .is("deleted_at", null)
    .neq("kind", "shell");

  const clubs = data as InboxMemberClub[];
  const latestMessages: Record<string, InboxLatestClubMessage> = {};

  try {
    const rpcClient = client as unknown as {
      rpc: (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: InboxLatestClubMessageRpcRow[] | null; error: unknown }>;
    };
    const { data: rpcRows, error: rpcError } = await rpcClient.rpc(
      "get_inbox_latest_club_messages",
      { _club_ids: clubIds },
    );
    if (rpcError) throw rpcError;
    for (const row of rpcRows ?? []) {
      latestMessages[row.club_id] = {
        text: row.text,
        author: row.author_display_name ?? "",
        created_at: row.created_at,
        image_url: row.image_url,
      };
    }
    return { clubs, latestMessages };
  } catch {
    // Preserve the deployed legacy fallback while the RPC remains optional.
  }

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

  const authorIds = [...new Set(
    messageRows
      .map(({ message }) => message?.author_id)
      .filter((authorId): authorId is string => !!authorId),
  )];
  const authorNameById: Record<string, string> = {};
  if (authorIds.length > 0) {
    const { data: profiles } = await selectProfiles(authorIds);
    for (const profile of profiles ?? []) {
      if (profile.display_name) authorNameById[profile.id] = profile.display_name;
    }
  }

  for (const { clubId, message } of messageRows) {
    if (!message) continue;
    latestMessages[clubId] = {
      text: message.text,
      author: message.author_id ? (authorNameById[message.author_id] ?? "") : "",
      created_at: message.created_at,
      image_url: message.image_url,
    };
  }

  return { clubs, latestMessages };
}

export interface InboxMemberTeam {
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

export interface InboxLatestTeamMessage extends InboxLatestClubMessage {
  is_announcement?: boolean;
}

export interface InboxMemberTeamsWithMessages {
  teams: InboxMemberTeam[];
  latestMessages: Record<string, InboxLatestTeamMessage>;
}

interface InboxLatestTeamMessageRpcRow {
  team_id: string;
  text: string;
  author_display_name: string | null;
  created_at: string;
  image_url: string | null;
  is_club_announcement: boolean | null;
  club_announcement_name: string | null;
}

export async function fetchInboxMemberTeamsWithMessages(
  userId: string,
  options: {
    client?: IgniteSupabaseClient;
    selectProfiles?: typeof selectCachedProfilesByIds;
  } = {},
): Promise<InboxMemberTeamsWithMessages> {
  const client = options.client ?? supabase;
  const selectProfiles = options.selectProfiles ?? selectCachedProfilesByIds;
  const { data: roles, error: rolesError } = await client
    .from("user_roles")
    .select("team_id")
    .eq("user_id", userId)
    .not("team_id", "is", null);

  if (rolesError) throw rolesError;
  const teamIds = (roles ?? [])
    .map((role) => role.team_id)
    .filter((teamId): teamId is string => !!teamId);
  if (teamIds.length === 0) return { teams: [], latestMessages: {} };

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
  const teams = ((data ?? []) as unknown as InboxMemberTeam[]).filter((team) => (
    !team.deleted_at && !team.clubs?.deleted_at && !team.clubs?.purged_at
  ));
  const activeTeamIds = teams.map((team) => team.id);
  if (activeTeamIds.length === 0) return { teams: [], latestMessages: {} };

  const latestMessages: Record<string, InboxLatestTeamMessage> = {};
  try {
    const rpcClient = client as unknown as {
      rpc: (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: InboxLatestTeamMessageRpcRow[] | null; error: unknown }>;
    };
    const { data: rpcRows, error: rpcError } = await rpcClient.rpc(
      "get_inbox_latest_team_messages",
      { _team_ids: activeTeamIds },
    );
    if (rpcError) throw rpcError;
    for (const row of rpcRows ?? []) {
      const isAnnouncement = !!(row.is_club_announcement && row.club_announcement_name);
      latestMessages[row.team_id] = {
        text: row.text,
        author: isAnnouncement ? row.club_announcement_name! : (row.author_display_name ?? ""),
        created_at: row.created_at,
        image_url: row.image_url,
        is_announcement: isAnnouncement,
      };
    }
    return { teams, latestMessages };
  } catch {
    // Preserve the deployed legacy fallback while the RPC remains optional.
  }

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

  const authorIds = [...new Set(
    messageRows
      .map(({ message }) => message)
      .filter((message) => (
        !!message &&
        !(message.is_club_announcement && message.club_announcement_name) &&
        !!message.author_id
      ))
      .map((message) => message!.author_id as string),
  )];
  const authorNameById: Record<string, string> = {};
  if (authorIds.length > 0) {
    const { data: profiles } = await selectProfiles(authorIds);
    for (const profile of profiles ?? []) {
      if (profile.display_name) authorNameById[profile.id] = profile.display_name;
    }
  }

  for (const { teamId, message } of messageRows) {
    if (!message) continue;
    const isAnnouncement = !!(message.is_club_announcement && message.club_announcement_name);
    latestMessages[teamId] = {
      text: message.text,
      author: isAnnouncement
        ? message.club_announcement_name!
        : (message.author_id ? (authorNameById[message.author_id] ?? "") : ""),
      created_at: message.created_at,
      image_url: message.image_url,
      is_announcement: isAnnouncement,
    };
  }

  return { teams, latestMessages };
}

export type InboxChatGroup = Database["public"]["Tables"]["chat_groups"]["Row"] & {
  teams: { name: string; deleted_at: string | null } | null;
  clubs: {
    name: string;
    logo_url: string | null;
    deleted_at: string | null;
    purged_at: string | null;
  } | null;
  mini_leagues: { name: string } | null;
};

export interface InboxChatGroupsWithMessages {
  groups: InboxChatGroup[];
  latestMessages: Record<string, InboxLatestClubMessage>;
}

interface InboxLatestGroupMessageRpcRow {
  group_id: string;
  text: string;
  author_display_name: string | null;
  created_at: string;
  image_url: string | null;
}

export async function fetchInboxChatGroupsWithMessages(
  userId: string,
  options: {
    client?: IgniteSupabaseClient;
    selectProfiles?: typeof selectCachedProfilesByIds;
    accessibleIdsRpcEnabled?: boolean;
  } = {},
): Promise<InboxChatGroupsWithMessages> {
  const client = options.client ?? supabase;
  const selectProfiles = options.selectProfiles ?? selectCachedProfilesByIds;
  let accessibleIds: string[] | null = null;

  if (options.accessibleIdsRpcEnabled !== false) {
    try {
      const rpcClient = client as unknown as {
        rpc: (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: string[] | null; error: unknown }>;
      };
      const { data: ids, error } = await rpcClient.rpc(
        "get_my_accessible_chat_group_ids",
        { _user_id: userId },
      );
      if (!error && Array.isArray(ids)) accessibleIds = ids;
    } catch {
      accessibleIds = null;
    }
  }

  if (accessibleIds?.length === 0) return { groups: [], latestMessages: {} };

  let query = client
    .from("chat_groups")
    .select("*, teams(name, deleted_at), clubs!club_id(name, logo_url, deleted_at, purged_at), mini_leagues:mini_league_id(name)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (accessibleIds) query = query.in("id", accessibleIds);
  const { data } = await query;

  const groups = ((data ?? []) as unknown as InboxChatGroup[]).filter((group) => (
    !group.deleted_at &&
    !group.clubs?.deleted_at &&
    !group.clubs?.purged_at &&
    !group.teams?.deleted_at
  ));
  const latestMessages: Record<string, InboxLatestClubMessage> = {};
  const groupIds = groups.map((group) => group.id);

  if (groupIds.length > 0) {
    try {
      const rpcClient = client as unknown as {
        rpc: (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: InboxLatestGroupMessageRpcRow[] | null; error: unknown }>;
      };
      const { data: rpcRows, error: rpcError } = await rpcClient.rpc(
        "get_inbox_latest_group_messages",
        { _group_ids: groupIds },
      );
      if (rpcError) throw rpcError;
      for (const row of rpcRows ?? []) {
        latestMessages[row.group_id] = {
          text: row.text,
          author: row.author_display_name ?? "",
          created_at: row.created_at,
          image_url: row.image_url,
        };
      }
      return { groups, latestMessages };
    } catch {
      // Preserve the deployed legacy fallback while the RPC remains optional.
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

  const authorIds = [...new Set(
    messageRows
      .map(({ message }) => message?.author_id)
      .filter((authorId): authorId is string => !!authorId),
  )];
  const authorNameById: Record<string, string> = {};
  if (authorIds.length > 0) {
    const { data: profiles } = await selectProfiles(authorIds);
    for (const profile of profiles ?? []) {
      if (profile.display_name) authorNameById[profile.id] = profile.display_name;
    }
  }

  for (const { groupId, message } of messageRows) {
    if (!message) continue;
    latestMessages[groupId] = {
      text: message.text,
      author: message.author_id ? (authorNameById[message.author_id] ?? "") : "",
      created_at: message.created_at,
      image_url: message.image_url,
    };
  }

  return { groups, latestMessages };
}

export async function fetchInboxHasAnyProAccess(
  userId: string,
  options: {
    client?: IgniteSupabaseClient;
    now?: Date;
  } = {},
): Promise<boolean> {
  const client = options.client ?? supabase;
  const now = options.now ?? new Date();
  const { data: roles, error: rolesError } = await client
    .from("user_roles")
    .select("team_id, club_id")
    .eq("user_id", userId);

  if (rolesError) throw rolesError;
  if (!roles?.length) return false;

  const teamIds = roles
    .map((role) => role.team_id)
    .filter((teamId): teamId is string => !!teamId);
  const clubIds = [...new Set(
    roles
      .map((role) => role.club_id)
      .filter((clubId): clubId is string => !!clubId),
  )];

  if (teamIds.length > 0) {
    const { data: teams, error: teamsError } = await client
      .from("teams")
      .select("club_id")
      .in("id", teamIds);

    if (teamsError) throw teamsError;
    for (const team of teams ?? []) {
      if (team.club_id && !clubIds.includes(team.club_id)) clubIds.push(team.club_id);
    }
  }

  if (clubIds.length > 0) {
    const { data: subscriptions, error: subscriptionsError } = await client
      .from("club_subscriptions")
      .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
      .in("club_id", clubIds);

    if (subscriptionsError) throw subscriptionsError;
    if ((subscriptions ?? []).some((subscription) => resolveClubProAccess(subscription, now).hasPro)) {
      return true;
    }
  }

  if (teamIds.length > 0) {
    const { data: subscriptions, error: subscriptionsError } = await client
      .from("team_subscriptions")
      .select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
      .in("team_id", teamIds);

    if (subscriptionsError) throw subscriptionsError;
    if ((subscriptions ?? []).some((subscription) => resolveClubProAccess(subscription, now).hasPro)) {
      return true;
    }
  }

  return false;
}

export interface InboxAdminClub {
  id: string;
  name: string;
  logo_url: string | null;
  sport: string | null;
}

export async function fetchInboxAdminClubs(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<InboxAdminClub[]> {
  const { data: roles, error: rolesError } = await client
    .from("user_roles")
    .select("club_id")
    .eq("user_id", userId)
    .eq("role", "club_admin");

  if (rolesError) throw rolesError;
  if (!roles?.length) return [];

  const clubIds = roles
    .map((role) => role.club_id)
    .filter((clubId): clubId is string => !!clubId);
  if (clubIds.length === 0) return [];

  const { data: clubs, error: clubsError } = await client
    .from("clubs")
    .select("id, name, logo_url, sport")
    .in("id", clubIds)
    .is("deleted_at", null)
    .neq("kind", "shell");

  if (clubsError) throw clubsError;
  return clubs ?? [];
}

export async function fetchInboxEventTitleMap(
  eventIds: readonly string[],
  client: IgniteSupabaseClient = supabase,
): Promise<Record<string, string>> {
  if (eventIds.length === 0) return {};

  const { data, error } = await client
    .from("events")
    .select("id, title")
    .in("id", [...eventIds]);

  if (error) throw error;
  const titles: Record<string, string> = {};
  for (const event of data ?? []) {
    if (event.id && event.title) titles[event.id.toLowerCase()] = event.title;
  }
  return titles;
}

export async function fetchInboxVaultFolderNameMap(
  folderIds: readonly string[],
  client: IgniteSupabaseClient = supabase,
): Promise<Record<string, string>> {
  if (folderIds.length === 0) return {};

  const { data, error } = await client
    .from("vault_folders")
    .select("id, name")
    .in("id", [...folderIds]);

  if (error) throw error;
  const names: Record<string, string> = {};
  for (const folder of data ?? []) {
    if (folder.id && folder.name) names[folder.id.toLowerCase()] = folder.name;
  }
  return names;
}

export async function fetchInboxVaultFileNameMap(
  fileIds: readonly string[],
  client: IgniteSupabaseClient = supabase,
): Promise<Record<string, string>> {
  if (fileIds.length === 0) return {};

  const { data, error } = await client
    .from("vault_files")
    .select("id, name")
    .in("id", [...fileIds]);

  if (error) throw error;
  const names: Record<string, string> = {};
  for (const file of data ?? []) {
    if (file.id && file.name) names[file.id.toLowerCase()] = file.name;
  }
  return names;
}

export interface InboxClubScopeFilterData {
  groupMembersMap: Map<string, string[]>;
  usersInClub: Set<string>;
}

export async function fetchInboxClubScopeFilter(options: {
  userId: string;
  clubId: string;
  personalGroupIds: readonly string[];
  dmOtherUserIds: readonly string[];
  client?: IgniteSupabaseClient;
}): Promise<InboxClubScopeFilterData> {
  const client = options.client ?? supabase;
  const groupMembersMap = new Map<string, string[]>();

  if (options.personalGroupIds.length > 0) {
    const { data: groupMembers, error: groupMembersError } = await client
      .from("group_members")
      .select("group_id, user_id")
      .in("group_id", [...options.personalGroupIds]);

    if (groupMembersError) throw groupMembersError;
    for (const row of groupMembers ?? []) {
      const members = groupMembersMap.get(row.group_id) ?? [];
      members.push(row.user_id);
      groupMembersMap.set(row.group_id, members);
    }
  }

  const userIdsToCheck = new Set(options.dmOtherUserIds);
  for (const members of groupMembersMap.values()) {
    for (const memberId of members) {
      if (memberId && memberId !== options.userId) userIdsToCheck.add(memberId);
    }
  }

  const usersInClub = new Set<string>();
  if (userIdsToCheck.size > 0) {
    const { data: roles, error: rolesError } = await client
      .from("user_roles")
      .select("user_id")
      .eq("club_id", options.clubId)
      .in("user_id", [...userIdsToCheck]);

    if (rolesError) throw rolesError;
    for (const role of roles ?? []) {
      if (role.user_id) usersInClub.add(role.user_id);
    }
  }

  return { groupMembersMap, usersInClub };
}

export async function fetchInboxAdminTeamIds(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<string[]> {
  const { data, error } = await client
    .from("user_roles")
    .select("team_id, club_id, role")
    .eq("user_id", userId)
    .in("role", ["team_admin", "coach", "committee_member"]);

  if (error) throw error;
  return (data ?? [])
    .map((role) => role.team_id)
    .filter((teamId): teamId is string => !!teamId);
}

export async function fetchInboxCommitteeMemberStatus(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<boolean> {
  const { data, error } = await client
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "committee_member")
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

export async function fetchInboxUserRoles(
  userId: string,
  client: IgniteSupabaseClient = supabase,
) {
  const { data, error } = await client
    .from("user_roles")
    .select("role, club_id, team_id")
    .eq("user_id", userId);

  if (error) throw error;
  return data ?? [];
}

export async function fetchInboxUserLeagueIds(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<Set<string>> {
  const { data: primaryChildren, error: primaryChildrenError } = await client
    .from("children")
    .select("id")
    .eq("parent_id", userId);

  if (primaryChildrenError) throw primaryChildrenError;

  const childIds = (primaryChildren ?? []).map((child) => child.id);
  const { data: guardianLinks, error: guardianLinksError } = await client
    .from("child_guardians")
    .select("child_id")
    .eq("guardian_id", userId);

  if (guardianLinksError) throw guardianLinksError;

  for (const link of guardianLinks ?? []) {
    if (!childIds.includes(link.child_id)) childIds.push(link.child_id);
  }

  if (childIds.length === 0) return new Set<string>();

  const { data: assignments, error: assignmentsError } = await client
    .from("child_mini_league_assignments")
    .select("mini_league_id")
    .in("child_id", childIds);

  if (assignmentsError) throw assignmentsError;
  return new Set((assignments ?? []).map((assignment) => assignment.mini_league_id));
}

export async function fetchInboxAppAdminStatus(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<boolean> {
  const { data, error } = await client
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "app_admin")
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

export async function fetchInboxClubProStatus(
  clubIds: readonly string[],
  options: {
    client?: IgniteSupabaseClient;
    now?: number;
  } = {},
): Promise<Record<string, boolean>> {
  if (clubIds.length === 0) return {};

  const client = options.client ?? supabase;
  const { data: subscriptions, error } = await client
    .from("club_subscriptions")
    .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
    .in("club_id", [...clubIds]);

  if (error) throw error;

  const statusByClub: Record<string, boolean> = {};
  for (const clubId of clubIds) {
    const subscription = subscriptions?.find((item) => item.club_id === clubId);
    const hasProFlag = !!subscription && (
      subscription.is_pro ||
      subscription.is_pro_football ||
      subscription.admin_pro_override ||
      subscription.admin_pro_football_override
    );
    const isCurrent =
      !!subscription &&
      (
        !subscription.expires_at ||
        new Date(subscription.expires_at).getTime() > (options.now ?? Date.now())
      );
    statusByClub[clubId] = hasProFlag && isCurrent;
  }

  return statusByClub;
}

export async function fetchInboxCompetitionClubMap(
  competitionIds: readonly string[],
  client: IgniteSupabaseClient = supabase,
): Promise<Record<string, Set<string>>> {
  if (competitionIds.length === 0) return {};

  const { data, error } = await client
    .from("competition_entries")
    .select("competition_id, status, teams!inner(club_id, deleted_at)")
    .in("competition_id", [...competitionIds])
    .eq("status", "accepted")
    .is("teams.deleted_at", null);

  if (error) throw error;

  const clubIdsByCompetition: Record<string, Set<string>> = {};
  for (const row of data ?? []) {
    if (row.status !== "accepted" || row.teams?.deleted_at) continue;
    const clubId = row.teams?.club_id;
    if (!clubId) continue;
    (clubIdsByCompetition[row.competition_id] ||= new Set()).add(clubId);
  }
  return clubIdsByCompetition;
}

export async function fetchInboxMutedChats(
  userId: string,
  options: {
    client?: IgniteSupabaseClient;
    now?: number;
  } = {},
): Promise<ActiveMutedChats> {
  const client = options.client ?? supabase;
  const { data, error } = await client
    .from("chat_mute_preferences")
    .select("chat_id, chat_type, muted_until")
    .eq("user_id", userId);

  if (error) throw error;
  return deriveActiveMutedChats(data ?? [], options.now ?? Date.now());
}

export async function fetchInboxHiddenDirectMessages(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<Map<string, string>> {
  const { data, error } = await client
    .from("hidden_dm_conversations")
    .select("conversation_id, hidden_at")
    .eq("user_id", userId);

  if (error) throw error;
  const hiddenByConversation = new Map<string, string>();
  for (const row of data ?? []) {
    hiddenByConversation.set(row.conversation_id, row.hidden_at);
  }
  return hiddenByConversation;
}

export async function fetchInboxHiddenGroups(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<Map<string, string>> {
  const { data, error } = await client
    .from("hidden_chat_groups")
    .select("group_id, hidden_at")
    .eq("user_id", userId);

  if (error) throw error;
  const hiddenByGroup = new Map<string, string>();
  for (const row of data ?? []) {
    hiddenByGroup.set(row.group_id, row.hidden_at);
  }
  return hiddenByGroup;
}
