import { getCachedMessages } from "@/lib/messageCache";

export const REACTION_EMOJIS = ["👍", "❤️", "🔥", "👏", "😂", "😢"];

// Stable empty array reference so rows with no reactions don't bust
// GroupChatMessageRow's memo on every parent render.
export const EMPTY_REACTIONS: never[] = [];

const GROUP_REACTION_EMOJI_MAP: Record<string, string> = {
  "❤️": "❤️",
  "🔥": "🔥",
  "👏": "👏",
  "😂": "😂",
  "👍": "👍",
  "😢": "😢",
  "🎉": "🎉",
  "😮": "😮",
  like: "❤️",
  fire: "🔥",
  clap: "👏",
  laugh: "😂",
  thumbsup: "👍",
  sad: "😢",
  celebrate: "🎉",
  wow: "😮",
};

export const normalizeGroupReactionType = (reactionType?: string | null) => {
  if (!reactionType) return "";
  return GROUP_REACTION_EMOJI_MAP[reactionType] || reactionType;
};

export interface GroupMessage {
  id: string;
  text: string;
  image_url: string | null;
  created_at: string;
  author_id: string;
  group_id: string;
  reply_to_id: string | null;
  is_system_message?: boolean;
  forwarded_from_user_id?: string | null;
  forwarded_at?: string | null;
  forwarded_source_label?: string | null;
  author?: {
    display_name: string | null;
    avatar_url: string | null;
  };
  reply_to?: {
    text: string;
    author?: {
      display_name: string | null;
    };
  } | null;
}

export interface ChatGroup {
  id: string;
  name: string;
  club_id: string | null;
  team_id: string | null;
  mini_league_id: string | null;
  allowed_roles: string[];
  created_by: string;
  membership_mode: string | null;
  category: string | null;
  join_policy: string | null;
  allow_forwarding?: boolean;
}

export interface MessageReaction {
  id: string;
  user_id: string;
  reaction_type: string;
  group_message_id: string | null;
}

export interface GroupChatSupabaseClient {
  from: (table: string) => any;
  channel: (name: string) => any;
}

export const attachReactionsToMessages = (
  messages: GroupMessage[],
  reactions: MessageReaction[],
): GroupMessage[] => {
  if (!messages.length) return messages;
  if (!reactions.length) return messages;
  const byMessage = new Map<string, MessageReaction[]>();
  for (const reaction of reactions) {
    const key = reaction.group_message_id;
    if (!key) continue;
    const list = byMessage.get(key);
    if (list) list.push(reaction);
    else byMessage.set(key, [reaction]);
  }
  return messages.map((message) => {
    const own = byMessage.get(message.id);
    if (!own || own.length === 0) return message;
    return { ...(message as any), reactions: own } as GroupMessage;
  });
};

export const getCachedGroupMessages = (groupId: string) => {
  const cachedMessages = getCachedMessages("group", groupId);

  const messages = cachedMessages.map((cachedMessage) => ({
    id: cachedMessage.id,
    text: cachedMessage.text,
    image_url: cachedMessage.image_url,
    created_at: cachedMessage.created_at,
    author_id: cachedMessage.author_id,
    group_id: groupId,
    reply_to_id: cachedMessage.reply_to_id,
    author: cachedMessage.profiles
      ? {
          display_name: cachedMessage.profiles.display_name,
          avatar_url: cachedMessage.profiles.avatar_url,
        }
      : null,
    reply_to: cachedMessage.reply_to
      ? {
          text: cachedMessage.reply_to.text,
          author: cachedMessage.reply_to.author ?? cachedMessage.reply_to.profiles ?? null,
        }
      : null,
  })) as GroupMessage[];

  const reactions = cachedMessages.flatMap((cachedMessage) =>
    (cachedMessage.reactions || []).map((reaction) => ({
      id: reaction.id || `cached-${cachedMessage.id}-${reaction.user_id}-${reaction.reaction_type}`,
      user_id: reaction.user_id,
      reaction_type: reaction.reaction_type,
      group_message_id: cachedMessage.id,
    })),
  ) as MessageReaction[];

  // Embed reactions on the message rows too, so the very first paint (which is
  // seeded straight from this cache) already shows existing reactions instead
  // of waiting for the post-mount merge effect / refetch.
  return { messages: attachReactionsToMessages(messages, reactions), reactions };
};
