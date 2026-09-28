export type InboxConversationType =
  | "club"
  | "team"
  | "group"
  | "league"
  | "dm"
  | "broadcast"
  | "support"
  | "admin_group";

export type InboxTypeFilter = "all" | "teams" | "groups" | "dms";

export interface InboxPreviewMessage {
  text: string;
  author: string;
  created_at: string;
  image_url?: string | null;
  is_announcement?: boolean;
}

export interface InboxConversation {
  type: InboxConversationType;
  id: string;
  key: string;
  name: string;
  avatarUrl?: string | null;
  link: string;
  lastActivity: string;
  lastMessage?: InboxPreviewMessage;
  unreadCount: number;
  isMuted: boolean;
  isLocked?: boolean;
  canManage?: boolean;
  canHide?: boolean;
  dmData?: unknown;
  draftText?: string;
  category?: string | null;
}

export interface OperationalDisclosureOptions {
  now: number;
  showAll: boolean;
  typeFilter: InboxTypeFilter;
  hasSearchQuery: boolean;
  staleAfterDays?: number;
  collapseThreshold?: number;
  visibleWhenCollapsed?: number;
}

export interface ChatMutePreference {
  chat_id: string;
  chat_type: string;
  muted_until: string | null;
}

export interface ActiveMutedChats {
  teams: Set<string>;
  clubs: Set<string>;
  groups: Set<string>;
}

export interface InboxDraft {
  text: string;
  updatedAt: string;
}

export interface ClubProEntitlementState {
  known: boolean;
  hasAccess: boolean;
}

export function inboxConversationIdentity(
  type: InboxConversationType,
  id: string,
): Pick<InboxConversation, "id" | "key" | "link"> {
  switch (type) {
    case "broadcast":
      return { id: "broadcast", key: "broadcast", link: "/messages/broadcast" };
    case "support":
      return { id: "ignite-support", key: "ignite-support", link: "/messages/welcome" };
    case "club":
      return { id, key: `club-${id}`, link: `/messages/club/${id}` };
    case "team":
      return { id, key: `team-${id}`, link: `/messages/${id}` };
    case "group":
      return { id, key: `group-${id}`, link: `/groups/${id}` };
    case "league":
      return { id, key: `league-${id}`, link: `/groups/${id}` };
    case "dm":
      return { id, key: `dm-${id}`, link: `/messages/dm/${id}` };
    case "admin_group":
      return { id, key: `admin-group-${id}`, link: `/messages/club-admin/${id}` };
  }
}

export function resolveGroupUnreadCount(
  realtimeCount: number | undefined,
  fetchedCount: number | undefined,
): number {
  return realtimeCount ?? fetchedCount ?? 0;
}

export function resolveClubProEntitlement(options: {
  clubId: string;
  statuses: Record<string, boolean> | undefined;
  isLoading: boolean;
  isFetching: boolean;
}): ClubProEntitlementState {
  const known =
    !options.isLoading &&
    !options.isFetching &&
    options.statuses !== undefined;

  return {
    known,
    hasAccess: known ? options.statuses?.[options.clubId] === true : true,
  };
}

export function attachInboxDrafts(
  conversations: readonly InboxConversation[],
  drafts: Readonly<Record<string, InboxDraft>>,
): InboxConversation[] {
  return conversations.map((conversation) => {
    const draft = drafts[conversation.id];
    if (!draft) return conversation;

    const draftIsNewer =
      !conversation.lastActivity ||
      new Date(draft.updatedAt).getTime() >
        new Date(conversation.lastActivity).getTime();

    return {
      ...conversation,
      draftText: draft.text,
      lastActivity: draftIsNewer ? draft.updatedAt : conversation.lastActivity,
    };
  });
}

export function deriveActiveMutedChats(
  preferences: readonly ChatMutePreference[],
  now: number,
): ActiveMutedChats {
  const muted: ActiveMutedChats = {
    teams: new Set<string>(),
    clubs: new Set<string>(),
    groups: new Set<string>(),
  };

  for (const preference of preferences) {
    const isActive =
      preference.muted_until === null ||
      new Date(preference.muted_until).getTime() > now;
    if (!isActive) continue;

    if (preference.chat_type === "team") muted.teams.add(preference.chat_id);
    else if (preference.chat_type === "club") muted.clubs.add(preference.chat_id);
    else if (preference.chat_type === "group") muted.groups.add(preference.chat_id);
  }

  return muted;
}

export function isHiddenConversationVisible(options: {
  hiddenAt?: string;
  lastMessageAt?: string | null;
  hasSearchQuery: boolean;
}): boolean {
  if (!options.hiddenAt || options.hasSearchQuery) return true;
  if (!options.lastMessageAt) return false;

  const stillHidden =
    new Date(options.lastMessageAt).getTime() <=
    new Date(options.hiddenAt).getTime();
  return !stillHidden;
}

export function normalizeInboxTypeFilter(value: string): InboxTypeFilter {
  if (value === "club" || value === "league") return "groups";
  if (value === "teams" || value === "groups" || value === "dms") return value;
  return "all";
}

export function filterInboxConversations(
  conversations: readonly InboxConversation[],
  typeFilter: InboxTypeFilter,
): InboxConversation[] {
  if (typeFilter === "all") return [...conversations];

  return conversations.filter((conversation) => {
    if (conversation.type === "support") return true;

    switch (typeFilter) {
      case "teams":
        return conversation.type === "team" || conversation.type === "league";
      case "groups":
        return (
          conversation.type === "group" ||
          conversation.type === "club" ||
          conversation.type === "admin_group"
        );
      case "dms":
        return conversation.type === "dm";
    }
  });
}

export function sortInboxByActivityDesc(
  conversations: readonly InboxConversation[],
): InboxConversation[] {
  return [...conversations].sort((left, right) => {
    if (!left.lastActivity && !right.lastActivity) return 0;
    if (!left.lastActivity) return 1;
    if (!right.lastActivity) return -1;
    return new Date(right.lastActivity).getTime() - new Date(left.lastActivity).getTime();
  });
}

export function partitionInboxByReadState(
  conversations: readonly InboxConversation[],
): { unread: InboxConversation[]; recent: InboxConversation[] } {
  return {
    unread: sortInboxByActivityDesc(
      conversations.filter((conversation) => conversation.unreadCount > 0),
    ),
    recent: sortInboxByActivityDesc(
      conversations.filter((conversation) => conversation.unreadCount === 0),
    ),
  };
}

export function resolveOperationalConversationDisclosure(
  recent: readonly InboxConversation[],
  options: OperationalDisclosureOptions,
): { visibleRecent: InboxConversation[]; hiddenOps: InboxConversation[] } {
  const staleAfterDays = options.staleAfterDays ?? 30;
  const collapseThreshold = options.collapseThreshold ?? 6;
  const visibleWhenCollapsed = options.visibleWhenCollapsed ?? 2;
  const cutoff = options.now - staleAfterDays * 24 * 60 * 60 * 1000;
  const stale = recent.filter((conversation) =>
    (conversation.type === "group" || conversation.type === "league") &&
    conversation.unreadCount === 0 &&
    !conversation.draftText &&
    (!conversation.lastActivity || new Date(conversation.lastActivity).getTime() < cutoff),
  );

  if (
    stale.length <= collapseThreshold ||
    options.showAll ||
    options.typeFilter !== "all" ||
    options.hasSearchQuery
  ) {
    return { visibleRecent: [...recent], hiddenOps: [] };
  }

  const hiddenOps = stale.slice(visibleWhenCollapsed);
  const hiddenKeys = new Set(hiddenOps.map((conversation) => conversation.key));

  return {
    visibleRecent: recent.filter((conversation) => !hiddenKeys.has(conversation.key)),
    hiddenOps,
  };
}
