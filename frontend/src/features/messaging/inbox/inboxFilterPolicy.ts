import { isHiddenConversationVisible } from "./inboxReadModel";

export interface InboxGroupFilterRow {
  id: string;
  name?: string | null;
  club_id?: string | null;
  team_id?: string | null;
  mini_league_id?: string | null;
  competition_id?: string | null;
  allowed_roles?: string[] | null;
  category?: string | null;
  clubs?: { name?: string | null; logo_url?: string | null } | null;
  teams?: { name?: string | null } | null;
}

export interface InboxTeamFilterRow {
  id: string;
  name: string;
  clubs?: { id?: string | null; name?: string | null } | null;
}

export interface InboxClubFilterRow {
  id: string;
  name: string;
}

export interface InboxDirectMessageFilterRow {
  id: string;
  last_message?: { created_at?: string | null } | null;
  other_user?: { id?: string | null; display_name?: string | null } | null;
}

export function normalizeInboxSearchQuery(value: string): string {
  return value.toLowerCase().trim();
}

export function partitionInboxGroups<TGroup extends InboxGroupFilterRow>(groups: readonly TGroup[]): {
  leagueChats: TGroup[];
  regularChatGroups: TGroup[];
} {
  const leagueChats: TGroup[] = [];
  const regularChatGroups: TGroup[] = [];
  groups.forEach((group) => {
    (group.mini_league_id ? leagueChats : regularChatGroups).push(group);
  });
  return { leagueChats, regularChatGroups };
}

export function collectPersonalGroupIds<TGroup extends InboxGroupFilterRow>(groups: readonly TGroup[]): string[] {
  return groups
    .filter((group) => !group.club_id && !group.team_id && !group.mini_league_id && !group.competition_id)
    .map((group) => group.id);
}

export function collectDirectMessagePeerIds<TConversation extends InboxDirectMessageFilterRow>(
  conversations: readonly TConversation[],
  currentUserId?: string | null,
): string[] {
  return conversations
    .map((conversation) => conversation.other_user?.id)
    .filter((id): id is string => !!id && id !== currentUserId);
}

export function filterInboxLeagueChats<TGroup extends InboxGroupFilterRow>(options: {
  groups: readonly TGroup[];
  query: string;
  clubId?: string | null;
}): TGroup[] {
  const { query, clubId } = options;
  let groups = clubId ? options.groups.filter((group) => group.club_id === clubId) : [...options.groups];
  if (!query) return groups;
  groups = groups.filter((group) =>
    (group.name?.toLowerCase() || "").includes(query) ||
    (group.clubs?.name?.toLowerCase() || "").includes(query));
  return groups;
}

export function filterInboxChatGroups<TGroup extends InboxGroupFilterRow>(options: {
  groups: readonly TGroup[];
  query: string;
  effectiveClubId?: string | null;
  activeClubId?: string | null;
  activeClubTeamIds: readonly string[];
  displayedTeams: readonly InboxTeamFilterRow[];
  competitionClubMap?: Record<string, ReadonlySet<string>> | null;
  groupMembersMap?: ReadonlyMap<string, readonly string[]> | null;
  usersInClub?: ReadonlySet<string> | null;
  currentUserId?: string | null;
  hiddenGroupMap?: ReadonlyMap<string, string> | null;
  latestGroupMessages?: Record<string, { created_at?: string | null } | null> | null;
}): TGroup[] {
  const {
    query, effectiveClubId, activeClubId, activeClubTeamIds, displayedTeams,
    competitionClubMap, groupMembersMap, usersInClub, currentUserId,
    hiddenGroupMap, latestGroupMessages,
  } = options;
  let groups = [...options.groups];

  if (effectiveClubId) {
    groups = groups.filter((group) => {
      if (group.competition_id) {
        return !!competitionClubMap?.[group.competition_id]?.has(effectiveClubId);
      }
      const isPersonalGroup = !group.club_id && !group.team_id && !group.mini_league_id;
      if (isPersonalGroup) {
        if (!groupMembersMap || !usersInClub) return true;
        const otherMembers = (groupMembersMap.get(group.id) || []).filter((id) => id !== currentUserId);
        if (otherMembers.length === 0) return true;
        return otherMembers.some((id) => usersInClub.has(id));
      }
      return group.club_id === effectiveClubId || !!(
        group.team_id && (
          activeClubId
            ? activeClubTeamIds.includes(group.team_id)
            : displayedTeams.some((team) => team.id === group.team_id && team.clubs?.id === effectiveClubId)
        )
      );
    });
  }

  groups = groups.filter((group) => {
    const isPersonalGroup = !group.club_id && !group.team_id && !group.mini_league_id && !group.competition_id;
    if (!isPersonalGroup) return true;
    return isHiddenConversationVisible({
      hiddenAt: hiddenGroupMap?.get(group.id),
      lastMessageAt: latestGroupMessages?.[group.id]?.created_at,
      hasSearchQuery: !!query,
    });
  });

  if (!query) return groups;
  return groups.filter((group) =>
    (group.name?.toLowerCase() || "").includes(query) ||
    (group.teams?.name?.toLowerCase() || "").includes(query) ||
    (group.clubs?.name?.toLowerCase() || "").includes(query));
}

export function filterInboxTeams<TTeam extends InboxTeamFilterRow>(options: {
  teams: readonly TTeam[];
  query: string;
  effectiveClubId?: string | null;
  activeClubId?: string | null;
  activeClubTeamIds: readonly string[];
}): TTeam[] {
  const { query, effectiveClubId, activeClubId, activeClubTeamIds } = options;
  let teams = [...options.teams];
  if (effectiveClubId) {
    teams = teams.filter((team) => activeClubId
      ? activeClubTeamIds.includes(team.id) || team.clubs?.id === activeClubId
      : team.clubs?.id === effectiveClubId);
  }
  if (!query) return teams;
  return teams.filter((team) =>
    team.name.toLowerCase().includes(query) || !!team.clubs?.name?.toLowerCase().includes(query));
}

export function filterInboxClubs<TClub extends InboxClubFilterRow>(options: {
  clubs: readonly TClub[];
  query: string;
  clubId?: string | null;
}): TClub[] {
  const { query, clubId } = options;
  let clubs = clubId ? options.clubs.filter((club) => club.id === clubId) : [...options.clubs];
  if (query) clubs = clubs.filter((club) => club.name.toLowerCase().includes(query));
  return clubs;
}

export function filterInboxDirectMessages<TConversation extends InboxDirectMessageFilterRow>(options: {
  conversations: readonly TConversation[];
  query: string;
  drafts: Record<string, { text?: string | null } | undefined>;
  hiddenMap?: ReadonlyMap<string, string> | null;
  effectiveClubId?: string | null;
  usersInClub?: ReadonlySet<string> | null;
  isSupportUser: (userId?: string | null) => boolean;
}): TConversation[] {
  const { query, drafts, hiddenMap, effectiveClubId, usersInClub, isSupportUser } = options;
  return options.conversations.filter((conversation) => {
    if (!isHiddenConversationVisible({
      hiddenAt: hiddenMap?.get(conversation.id),
      lastMessageAt: conversation.last_message?.created_at,
      hasSearchQuery: !!query,
    })) return false;

    if (effectiveClubId && usersInClub) {
      const peerId = conversation.other_user?.id;
      if (!isSupportUser(peerId) && peerId && !usersInClub.has(peerId)) return false;
    }
    if (query) return !!conversation.other_user?.display_name?.toLowerCase().includes(query);
    return !!conversation.last_message || !!drafts[conversation.id]?.text?.trim();
  });
}
