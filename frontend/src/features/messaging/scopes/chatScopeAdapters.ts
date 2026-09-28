export type ChatScopeKind =
  | "team"
  | "club"
  | "group"
  | "direct"
  | "club_admin"
  | "broadcast";

export type ChatMessageTable =
  | "team_messages"
  | "club_messages"
  | "group_messages"
  | "direct_messages"
  | "club_admin_messages"
  | "broadcast_messages";

export type ChatScopeColumn =
  | "team_id"
  | "club_id"
  | "group_id"
  | "conversation_id";

export type ChatCapabilityMode = "supported" | "conditional" | "unsupported";

export interface ChatScopeCapabilities {
  /**
   * `conditional` means the page applies an additional runtime rule (for
   * example group settings, shared-club context, support-chat restrictions or
   * entitlement). `supported` does not bypass global entitlement checks.
   */
  attachments: ChatCapabilityMode;
  vaultPicker: ChatCapabilityMode;
  polls: ChatCapabilityMode;
  scheduling: ChatCapabilityMode;
  pinning: ChatCapabilityMode;
  forwarding: ChatCapabilityMode;
  galleryPublishing: ChatCapabilityMode;
  clubAnnouncements: ChatCapabilityMode;
}

export type ChatAuthorizationBoundary =
  | "team_membership"
  | "club_membership"
  | "group_membership"
  | "conversation_participant"
  | "authenticated"
  | "app_admin";

export interface ChatScopeAdapter {
  kind: ChatScopeKind;
  messageTable: ChatMessageTable;
  scopeColumn: ChatScopeColumn | null;
  reactionForeignKey:
    | "team_message_id"
    | "club_message_id"
    | "group_message_id"
    | "direct_message_id"
    | "club_admin_message_id"
    | "broadcast_message_id";
  cachePrefix: string;
  route: (scopeId?: string) => string;
  /** Describes the required policy boundary; database RLS remains authoritative. */
  readBoundary: ChatAuthorizationBoundary;
  /** Describes the required policy boundary; never use this value as an authorization check. */
  sendBoundary: ChatAuthorizationBoundary;
  capabilities: ChatScopeCapabilities;
}

const requireScopeId = (kind: ChatScopeKind, scopeId?: string): string => {
  if (!scopeId) throw new Error(`${kind} chat requires a scope id`);
  return scopeId;
};

export const TEAM_CHAT_SCOPE: ChatScopeAdapter = {
  kind: "team",
  messageTable: "team_messages",
  scopeColumn: "team_id",
  reactionForeignKey: "team_message_id",
  cachePrefix: "team-messages",
  route: (scopeId) => `/messages/${requireScopeId("team", scopeId)}`,
  readBoundary: "team_membership",
  sendBoundary: "team_membership",
  capabilities: {
    attachments: "supported",
    vaultPicker: "supported",
    polls: "supported",
    scheduling: "supported",
    pinning: "supported",
    forwarding: "supported",
    galleryPublishing: "conditional",
    clubAnnouncements: "supported",
  },
};

export const CLUB_CHAT_SCOPE: ChatScopeAdapter = {
  kind: "club",
  messageTable: "club_messages",
  scopeColumn: "club_id",
  reactionForeignKey: "club_message_id",
  cachePrefix: "club-messages",
  route: (scopeId) => `/messages/club/${requireScopeId("club", scopeId)}`,
  readBoundary: "club_membership",
  sendBoundary: "club_membership",
  capabilities: {
    attachments: "supported",
    vaultPicker: "supported",
    polls: "supported",
    scheduling: "supported",
    pinning: "supported",
    forwarding: "supported",
    galleryPublishing: "unsupported",
    clubAnnouncements: "unsupported",
  },
};

export const GROUP_CHAT_SCOPE: ChatScopeAdapter = {
  kind: "group",
  messageTable: "group_messages",
  scopeColumn: "group_id",
  reactionForeignKey: "group_message_id",
  cachePrefix: "group-messages",
  route: (scopeId) => `/groups/${requireScopeId("group", scopeId)}`,
  readBoundary: "group_membership",
  sendBoundary: "group_membership",
  capabilities: {
    attachments: "supported",
    vaultPicker: "conditional",
    polls: "supported",
    scheduling: "supported",
    pinning: "supported",
    forwarding: "conditional",
    galleryPublishing: "conditional",
    clubAnnouncements: "unsupported",
  },
};

export const DIRECT_CHAT_SCOPE: ChatScopeAdapter = {
  kind: "direct",
  messageTable: "direct_messages",
  scopeColumn: "conversation_id",
  reactionForeignKey: "direct_message_id",
  cachePrefix: "dm-messages",
  route: (scopeId) => `/messages/dm/${requireScopeId("direct", scopeId)}`,
  readBoundary: "conversation_participant",
  sendBoundary: "conversation_participant",
  capabilities: {
    attachments: "conditional",
    vaultPicker: "conditional",
    polls: "unsupported",
    scheduling: "conditional",
    pinning: "conditional",
    forwarding: "conditional",
    galleryPublishing: "unsupported",
    clubAnnouncements: "unsupported",
  },
};

export const CLUB_ADMIN_CHAT_SCOPE: ChatScopeAdapter = {
  kind: "club_admin",
  messageTable: "club_admin_messages",
  scopeColumn: "conversation_id",
  reactionForeignKey: "club_admin_message_id",
  cachePrefix: "club-admin-messages",
  route: (scopeId) => `/messages/club-admin/${requireScopeId("club_admin", scopeId)}`,
  readBoundary: "conversation_participant",
  sendBoundary: "conversation_participant",
  capabilities: {
    attachments: "supported",
    vaultPicker: "conditional",
    polls: "supported",
    scheduling: "supported",
    pinning: "unsupported",
    forwarding: "supported",
    galleryPublishing: "unsupported",
    clubAnnouncements: "unsupported",
  },
};

export const BROADCAST_CHAT_SCOPE: ChatScopeAdapter = {
  kind: "broadcast",
  messageTable: "broadcast_messages",
  scopeColumn: null,
  reactionForeignKey: "broadcast_message_id",
  cachePrefix: "broadcast-messages",
  route: () => "/messages/broadcast",
  readBoundary: "authenticated",
  sendBoundary: "app_admin",
  capabilities: {
    attachments: "supported",
    vaultPicker: "unsupported",
    polls: "supported",
    scheduling: "conditional",
    pinning: "unsupported",
    forwarding: "supported",
    galleryPublishing: "unsupported",
    clubAnnouncements: "unsupported",
  },
};

export const CHAT_SCOPE_ADAPTERS = {
  team: TEAM_CHAT_SCOPE,
  club: CLUB_CHAT_SCOPE,
  group: GROUP_CHAT_SCOPE,
  direct: DIRECT_CHAT_SCOPE,
  club_admin: CLUB_ADMIN_CHAT_SCOPE,
  broadcast: BROADCAST_CHAT_SCOPE,
} as const satisfies Record<ChatScopeKind, ChatScopeAdapter>;

const CHAT_SCOPE_BY_TABLE = Object.fromEntries(
  Object.values(CHAT_SCOPE_ADAPTERS).map((adapter) => [adapter.messageTable, adapter]),
) as Record<ChatMessageTable, ChatScopeAdapter>;

export function getChatScopeAdapterByTable(table: ChatMessageTable): ChatScopeAdapter {
  return CHAT_SCOPE_BY_TABLE[table];
}

export function buildChatScopeFilter(
  adapter: ChatScopeAdapter,
  scopeId?: string,
): Record<string, string> {
  if (!adapter.scopeColumn) return {};
  return { [adapter.scopeColumn]: requireScopeId(adapter.kind, scopeId) };
}
