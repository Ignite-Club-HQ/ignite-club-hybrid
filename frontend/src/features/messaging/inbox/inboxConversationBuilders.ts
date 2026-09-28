import {
  inboxConversationIdentity,
  type InboxConversation,
  type InboxPreviewMessage,
} from "./inboxReadModel";

interface NamedInboxSource {
  id: string;
  name: string;
  logo_url?: string | null;
}

interface BroadcastMessageSource {
  text: string;
  created_at: string;
  image_url?: string | null;
  profiles?: { display_name?: string | null } | null;
}

interface DirectMessageSource {
  id: string;
  updated_at?: string | null;
  other_user?: {
    id?: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
  } | null;
  last_message?: {
    text: string;
    created_at: string;
    author_id?: string | null;
    image_url?: string | null;
  } | null;
}

interface ClubAdminConversationSource {
  id: string;
  updated_at: string;
  member_name: string;
  member_avatar?: string | null;
  last_text?: string | null;
  last_image?: string | null;
  last_created_at?: string | null;
  last_author_id?: string | null;
}

interface SystemMessageSource {
  text: string;
  created_at: string;
}

export function buildBroadcastInboxConversation(options: {
  message?: BroadcastMessageSource | null;
  unreadCount: number;
}): InboxConversation {
  const message = options.message;
  return {
    type: "broadcast",
    ...inboxConversationIdentity("broadcast", "broadcast"),
    name: "Announcements",
    lastActivity: message?.created_at || "",
    lastMessage: message
      ? {
          text: message.text,
          author: message.profiles?.display_name || "",
          created_at: message.created_at,
          image_url: message.image_url,
        }
      : undefined,
    unreadCount: options.unreadCount,
    isMuted: false,
  };
}

export function buildClubInboxConversation(options: {
  club: NamedInboxSource;
  lastMessage?: InboxPreviewMessage;
  unreadCount: number;
  isMuted: boolean;
  proStatusKnown: boolean;
  hasProAccess: boolean;
}): InboxConversation {
  return {
    type: "club",
    ...inboxConversationIdentity("club", options.club.id),
    name: options.club.name,
    avatarUrl: options.club.logo_url,
    lastActivity: options.lastMessage?.created_at || "",
    lastMessage: options.lastMessage,
    unreadCount: options.unreadCount,
    isMuted: options.isMuted,
    isLocked: options.proStatusKnown && !options.hasProAccess,
  };
}

export function buildTeamInboxConversation(options: {
  team: NamedInboxSource & { clubs?: { logo_url?: string | null } | null };
  lastMessage?: InboxPreviewMessage;
  unreadCount: number;
  isMuted: boolean;
}): InboxConversation {
  return {
    type: "team",
    ...inboxConversationIdentity("team", options.team.id),
    name: options.team.name,
    avatarUrl: options.team.logo_url || options.team.clubs?.logo_url,
    lastActivity: options.lastMessage?.created_at || "",
    lastMessage: options.lastMessage,
    unreadCount: options.unreadCount,
    isMuted: options.isMuted,
  };
}

export function buildGroupInboxConversation(options: {
  type: "group" | "league";
  group: NamedInboxSource & { category?: string | null };
  avatarUrl?: string | null;
  lastMessage?: InboxPreviewMessage;
  unreadCount: number;
  isMuted: boolean;
  isLocked?: boolean;
  lockedLink?: string;
  canHide?: boolean;
}): InboxConversation {
  const identity = inboxConversationIdentity(options.type, options.group.id);
  return {
    type: options.type,
    ...identity,
    name: options.group.name,
    ...(options.avatarUrl !== undefined ? { avatarUrl: options.avatarUrl } : {}),
    link: options.isLocked && options.lockedLink ? options.lockedLink : identity.link,
    lastActivity: options.lastMessage?.created_at || "",
    lastMessage: options.lastMessage,
    unreadCount: options.unreadCount,
    isMuted: options.isMuted,
    ...(options.type === "group"
      ? {
          canHide: options.canHide,
          category: options.group.category ?? null,
          isLocked: options.isLocked ?? false,
        }
      : {}),
  };
}

export function buildDirectMessageInboxConversation<T extends DirectMessageSource>(options: {
  conversation: T;
  currentUserId?: string;
  unreadCount: number;
  isSupport: boolean;
}): InboxConversation {
  const conversation = options.conversation;
  const otherName = conversation.other_user?.display_name || "Unknown User";
  return {
    type: "dm",
    ...inboxConversationIdentity("dm", conversation.id),
    name: options.isSupport ? "Ignite Support" : otherName,
    avatarUrl: conversation.other_user?.avatar_url,
    lastActivity: conversation.last_message?.created_at || conversation.updated_at || "",
    lastMessage: conversation.last_message
      ? {
          text: conversation.last_message.text,
          author:
            conversation.last_message.author_id === options.currentUserId
              ? "You"
              : conversation.other_user?.display_name || "",
          created_at: conversation.last_message.created_at,
          image_url: conversation.last_message.image_url,
        }
      : undefined,
    unreadCount: options.unreadCount,
    isMuted: false,
    canHide: !options.isSupport,
    dmData: conversation,
  };
}

export function buildClubAdminInboxConversation(options: {
  conversation: ClubAdminConversationSource;
  currentUserId?: string;
}): InboxConversation {
  const conversation = options.conversation;
  return {
    type: "admin_group",
    ...inboxConversationIdentity("admin_group", conversation.id),
    name: conversation.member_name,
    avatarUrl: conversation.member_avatar,
    lastActivity: conversation.last_created_at || conversation.updated_at || "",
    lastMessage: conversation.last_created_at
      ? {
          text: conversation.last_text || "",
          author:
            conversation.last_author_id === options.currentUserId
              ? "You"
              : conversation.member_name,
          created_at: conversation.last_created_at,
          image_url: conversation.last_image,
        }
      : undefined,
    unreadCount: 0,
    isMuted: false,
    category: "Admin Groups",
  };
}

export function buildSupportInboxConversation(
  message: SystemMessageSource,
): InboxConversation {
  return {
    type: "support",
    ...inboxConversationIdentity("support", "ignite-support"),
    name: "Ignite Support",
    lastActivity: message.created_at || "",
    lastMessage: {
      text: `${message.text.substring(0, 60)}...`,
      author: "",
      created_at: message.created_at,
    },
    unreadCount: 0,
    isMuted: false,
  };
}
