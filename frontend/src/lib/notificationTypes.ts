/**
 * Centralized notification type constants.
 * Used for filtering, counting, and routing notifications across the app.
 */

// Message-related notifications (shown in Messages tab badge)
export const MESSAGE_NOTIFICATION_TYPES = [
  'team_message',
  'club_message',
  'group_message',
  'broadcast',
  'message_reply',
  'message_mention',
  'direct_message',
  'club_admin_message'
] as const;

// Event-related notifications
export const EVENT_NOTIFICATION_TYPES = [
  'event_invite',
  'event_cancelled',
  'event_reminder',
  'event_updated',
  'event_note',
  'rsvp_reminder',
  'duty_assigned'
] as const;

// Media/photo-related notifications
export const MEDIA_NOTIFICATION_TYPES = [
  'photo_uploaded',
  'photo_comment',
  'photo_reaction',
  'comment_reply',
  'comment_reaction'
] as const;

// Membership and role-related notifications
export const MEMBERSHIP_NOTIFICATION_TYPES = [
  'membership',
  'join_request',
  'join_request_approved',
  'join_request_denied',
  'join_request_processed',
  'role_assigned',
  'role_removed',
  'team_invite'
] as const;

// Admin/system notifications
export const ADMIN_NOTIFICATION_TYPES = [
  'subscription_expiring',
  'subscription_expired',
  'storage_limit',
  'system_announcement',
  'fee_payment_request'
] as const;

// All notification types combined
export const ALL_NOTIFICATION_TYPES = [
  ...MESSAGE_NOTIFICATION_TYPES,
  ...EVENT_NOTIFICATION_TYPES,
  ...MEDIA_NOTIFICATION_TYPES,
  ...MEMBERSHIP_NOTIFICATION_TYPES,
  ...ADMIN_NOTIFICATION_TYPES
] as const;

// Type exports for type safety
export type MessageNotificationType = typeof MESSAGE_NOTIFICATION_TYPES[number];
export type EventNotificationType = typeof EVENT_NOTIFICATION_TYPES[number];
export type MediaNotificationType = typeof MEDIA_NOTIFICATION_TYPES[number];
export type MembershipNotificationType = typeof MEMBERSHIP_NOTIFICATION_TYPES[number];
export type AdminNotificationType = typeof ADMIN_NOTIFICATION_TYPES[number];
export type NotificationType = typeof ALL_NOTIFICATION_TYPES[number];

// Icon and color configuration for each notification type
export type NotificationIconConfig = {
  iconName: string;
  colorClass: string;
  emoji: string;
};

export const NOTIFICATION_ICON_CONFIG: Record<string, NotificationIconConfig> = {
  // Message types
  team_message: { iconName: 'MessageSquare', colorClass: 'text-blue-500', emoji: '💬' },
  club_message: { iconName: 'MessageSquare', colorClass: 'text-blue-500', emoji: '💬' },
  group_message: { iconName: 'MessageSquare', colorClass: 'text-blue-500', emoji: '💬' },
  direct_message: { iconName: 'MessageSquare', colorClass: 'text-blue-500', emoji: '💬' },
  club_admin_message: { iconName: 'Shield', colorClass: 'text-blue-500', emoji: '🛡️' },
  broadcast: { iconName: 'Megaphone', colorClass: 'text-purple-500', emoji: '📢' },
  message_mention: { iconName: 'AtSign', colorClass: 'text-pink-500', emoji: '📣' },
  message_reaction: { iconName: 'Heart', colorClass: 'text-red-500', emoji: '❤️' },
  message_reply: { iconName: 'Reply', colorClass: 'text-cyan-500', emoji: '↩️' },
  
  // Event types
  event_invite: { iconName: 'Calendar', colorClass: 'text-orange-500', emoji: '📅' },
  event_cancelled: { iconName: 'Calendar', colorClass: 'text-orange-500', emoji: '❌' },
  event_reminder: { iconName: 'Calendar', colorClass: 'text-orange-500', emoji: '📅' },
  event_updated: { iconName: 'Calendar', colorClass: 'text-orange-500', emoji: '📅' },
  event_note: { iconName: 'StickyNote', colorClass: 'text-orange-500', emoji: '📝' },
  rsvp_reminder: { iconName: 'Calendar', colorClass: 'text-orange-500', emoji: '✅' },
  rsvp: { iconName: 'CheckCircle', colorClass: 'text-green-500', emoji: '✅' },
  early_rsvp_points: { iconName: 'Zap', colorClass: 'text-amber-500', emoji: '🎯' },
  duty_assigned: { iconName: 'ClipboardList', colorClass: 'text-amber-500', emoji: '📋' },
  
  // Media types
  photo_uploaded: { iconName: 'Image', colorClass: 'text-emerald-500', emoji: '📸' },
  photo_comment: { iconName: 'Image', colorClass: 'text-emerald-500', emoji: '💬' },
  photo_reaction: { iconName: 'Heart', colorClass: 'text-red-500', emoji: '❤️' },
  comment_reply: { iconName: 'Reply', colorClass: 'text-cyan-500', emoji: '↩️' },
  comment_reaction: { iconName: 'Heart', colorClass: 'text-red-500', emoji: '❤️' },
  
  // Membership types
  membership: { iconName: 'Users', colorClass: 'text-teal-500', emoji: '👥' },
  join_request: { iconName: 'UserPlus', colorClass: 'text-indigo-500', emoji: '👋' },
  join_request_approved: { iconName: 'CheckCircle', colorClass: 'text-green-500', emoji: '✅' },
  join_request_denied: { iconName: 'XCircle', colorClass: 'text-red-500', emoji: '❌' },
  join_request_processed: { iconName: 'Users', colorClass: 'text-teal-500', emoji: '👥' },
  role_assigned: { iconName: 'UserPlus', colorClass: 'text-indigo-500', emoji: '🎖️' },
  role_removed: { iconName: 'UserMinus', colorClass: 'text-gray-500', emoji: '👤' },
  team_invite: { iconName: 'UserPlus', colorClass: 'text-indigo-500', emoji: '👋' },
  
  // Admin types
  subscription_expiring: { iconName: 'AlertTriangle', colorClass: 'text-yellow-500', emoji: '⚠️' },
  subscription_expired: { iconName: 'AlertCircle', colorClass: 'text-red-500', emoji: '🚨' },
  storage_limit: { iconName: 'HardDrive', colorClass: 'text-orange-500', emoji: '💾' },
  system_announcement: { iconName: 'Info', colorClass: 'text-blue-500', emoji: 'ℹ️' },
  fee_payment_request: { iconName: 'CreditCard', colorClass: 'text-amber-500', emoji: '💳' },
  
  // Pitch board types
  pending_sub: { iconName: 'ArrowLeftRight', colorClass: 'text-orange-500', emoji: '🔄' },
  half_time: { iconName: 'Timer', colorClass: 'text-yellow-500', emoji: '⏸️' },
  game_finished: { iconName: 'Trophy', colorClass: 'text-amber-500', emoji: '🏆' },
  formation_change: { iconName: 'LayoutGrid', colorClass: 'text-blue-500', emoji: '⚽' },

  // Gamification types
  points_awarded: { iconName: 'Zap', colorClass: 'text-amber-500', emoji: '⭐' },
  leaderboard_update: { iconName: 'TrendingUp', colorClass: 'text-green-500', emoji: '📈' },
  streak_progress: { iconName: 'Flame', colorClass: 'text-orange-500', emoji: '🔥' },
  streak_bonus: { iconName: 'Flame', colorClass: 'text-orange-500', emoji: '🔥' },
  reward_proximity: { iconName: 'Gift', colorClass: 'text-purple-500', emoji: '🎁' },
  reward_unlocked: { iconName: 'Gift', colorClass: 'text-purple-500', emoji: '🎁' },
};

// Default icon config for unknown types
export const DEFAULT_NOTIFICATION_ICON: NotificationIconConfig = {
  iconName: 'Bell',
  colorClass: 'text-primary',
  emoji: '🔔'
};

/**
 * Get the icon configuration for a notification type
 */
export function getNotificationIconConfig(type: string): NotificationIconConfig {
  return NOTIFICATION_ICON_CONFIG[type] || DEFAULT_NOTIFICATION_ICON;
}

/**
 * Get the category of a notification type
 */
export function getNotificationCategory(type: string): 'message' | 'event' | 'media' | 'membership' | 'admin' | 'unknown' {
  if ((MESSAGE_NOTIFICATION_TYPES as readonly string[]).includes(type)) return 'message';
  if ((EVENT_NOTIFICATION_TYPES as readonly string[]).includes(type)) return 'event';
  if ((MEDIA_NOTIFICATION_TYPES as readonly string[]).includes(type)) return 'media';
  if ((MEMBERSHIP_NOTIFICATION_TYPES as readonly string[]).includes(type)) return 'membership';
  if ((ADMIN_NOTIFICATION_TYPES as readonly string[]).includes(type)) return 'admin';
  return 'unknown';
}

/**
 * Map of reaction_type identifiers → emoji, mirroring
 * REACTION_EMOJIS in src/components/chat/MessageReactions.tsx.
 * Used to render the actual reaction emoji in notifications
 * instead of a generic heart icon.
 */
export const REACTION_TYPE_EMOJI_MAP: Record<string, string> = {
  thumbsup: '👍',
  like: '❤️',
  laugh: '😂',
  celebrate: '🎉',
  wow: '😮',
  sad: '😢',
  fire: '🔥',
  clap: '👏',
};

// Matches a single emoji-like grapheme cluster (covers pictographs + skin/ZWJ sequences).
const EMOJI_REGEX = /\p{Extended_Pictographic}(\p{Emoji_Modifier}|\uFE0F|\u200D\p{Extended_Pictographic})*/u;

/**
 * Extract the reaction emoji from a reaction notification message such as
 * "Alice reacted 👍 to your message" or (legacy) "Alice reacted thumbsup to
 * your message". Returns null if it can't determine one.
 */
export function extractReactionEmoji(message: string | null | undefined): string | null {
  if (!message) return null;
  const m = message.match(/reacted\s+(\S+)/i);
  if (!m) return null;
  const token = m[1];
  const mapped = REACTION_TYPE_EMOJI_MAP[token.toLowerCase()];
  if (mapped) return mapped;
  const emojiMatch = token.match(EMOJI_REGEX);
  return emojiMatch ? emojiMatch[0] : null;
}

/** Notification types whose icon should be the actual reaction emoji. */
export const REACTION_NOTIFICATION_TYPES = new Set([
  'message_reaction',
  'photo_reaction',
  'comment_reaction',
]);
