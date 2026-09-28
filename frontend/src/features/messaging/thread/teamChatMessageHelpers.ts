import { format, parseISO, isToday, isYesterday } from "date-fns";
import { getCachedMessages } from "@/lib/messageCache";

export interface TeamChatMessage {
  id: string;
  team_id: string;
  author_id: string;
  text: string;
  image_url: string | null;
  reply_to_id: string | null;
  created_at: string;
  is_club_announcement?: boolean;
  club_announcement_name?: string | null;
  is_system_message?: boolean;
  forwarded_from_user_id?: string | null;
  forwarded_at?: string | null;
  forwarded_source_label?: string | null;
  profiles: {
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  reactions: {
    id: string;
    user_id: string;
    reaction_type: string;
  }[];
  reply_to?: {
    text: string;
    profiles: { display_name: string | null } | null;
  } | null;
}

export const formatTeamChatMessageDate = (dateStr: string) => {
  const date = parseISO(dateStr);
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return `Yesterday ${format(date, "h:mm a")}`;
  return format(date, "MMM d, h:mm a");
};

/**
 * SECURITY (cross-team bleed): a row is only ever rendered, seeded, merged or
 * persisted in the thread it was posted to. Rows without a `team_id` (optimistic
 * temp/queued rows, offline-cache rows) are created in-thread and allowed.
 */
export const belongsToTeamChatThread = (message: any, teamId: string | undefined) =>
  !!teamId && (!message?.team_id || message.team_id === teamId);

/**
 * SECURITY (cross-team cache bleed): a cached row may already carry an
 * immutable `team_id` from another team (older cache writes, shared helpers).
 * Never overwrite it with the open thread's id — that would launder the foreign
 * row into this thread and defeat every later `belongsToTeamChatThread` check.
 * Rows with no `team_id` are legacy cache rows, already scoped by the cache key.
 */
export const getCachedTeamChatMessages = (teamId: string): TeamChatMessage[] =>
  getCachedMessages("team", teamId)
    .filter((cachedMessage) => {
      const cachedTeamId = (cachedMessage as { team_id?: unknown }).team_id;
      return typeof cachedTeamId !== "string" || cachedTeamId === teamId;
    })
    .map((cachedMessage) => ({
      id: cachedMessage.id,
      team_id: ((cachedMessage as { team_id?: unknown }).team_id as string | undefined) ?? teamId,
      author_id: cachedMessage.author_id,
      text: cachedMessage.text,
      image_url: cachedMessage.image_url,
      reply_to_id: cachedMessage.reply_to_id,
      created_at: cachedMessage.created_at,
      is_club_announcement: Boolean(cachedMessage.is_club_announcement),
      club_announcement_name:
        typeof cachedMessage.club_announcement_name === "string"
          ? cachedMessage.club_announcement_name
          : null,
      is_system_message: Boolean(cachedMessage.is_system_message),
      profiles: cachedMessage.profiles,
      reactions: (cachedMessage.reactions || []).map((reaction) => ({
        id: reaction.id || `cached-${cachedMessage.id}-${reaction.user_id}-${reaction.reaction_type}`,
        user_id: reaction.user_id,
        reaction_type: reaction.reaction_type,
      })),
      reply_to: cachedMessage.reply_to
        ? {
            text: cachedMessage.reply_to.text,
            profiles:
              cachedMessage.reply_to.profiles ??
              (cachedMessage.reply_to.author
                ? { display_name: cachedMessage.reply_to.author.display_name }
                : null),
          }
        : null,
    }));
