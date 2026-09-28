export type NotificationClubScope = string | null | undefined;

const allClubs = "all" as const;

/**
 * Canonical cache-key contract for notification and unread state.
 *
 * Root keys deliberately retain the prefixes used by the current application
 * so consumers can be migrated one at a time without changing prefix-based
 * invalidation behaviour. Exact keys always include user and normalized club
 * scope where that value changes the result.
 */
export const notificationKeys = {
  lists: ["notifications"] as const,
  list: (userId: string | undefined, clubId?: NotificationClubScope) =>
    ["notifications", userId, clubId ?? allClubs] as const,

  recent: ["recent-notifications"] as const,
  recentFor: (userId: string | undefined, clubId?: NotificationClubScope) =>
    ["recent-notifications", userId, clubId ?? null] as const,

  globalUnread: ["unread-count"] as const,
  globalUnreadFor: (userId: string) => ["unread-count", userId] as const,

  clubUnread: ["club-unread-count"] as const,
  clubUnreadFor: (userId: string | undefined, clubId: string | null | undefined) =>
    ["club-unread-count", userId, clubId] as const,

  messageUnread: ["unread-message-counts"] as const,
  messageUnreadFor: (userId: string) =>
    ["unread-message-counts", userId] as const,

  clubMessageUnread: ["club-messages-unread"] as const,
  clubMessageUnreadFor: (userId: string, clubId: string) =>
    ["club-messages-unread", userId, clubId] as const,

  chatGroupUnread: ["chat-group-unread-cache"] as const,
  chatGroupUnreadFor: (userId: string | null | undefined) =>
    ["chat-group-unread-cache", userId] as const,
} as const;

export const notificationCacheRoots = [
  notificationKeys.lists,
  notificationKeys.recent,
  notificationKeys.globalUnread,
  notificationKeys.clubUnread,
  notificationKeys.messageUnread,
  notificationKeys.clubMessageUnread,
  notificationKeys.chatGroupUnread,
] as const;
