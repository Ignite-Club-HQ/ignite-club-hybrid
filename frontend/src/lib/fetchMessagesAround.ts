import { supabase } from "@/integrations/supabase/client";
import { fetchProfilesWithCache } from "@/lib/profileCache";

type ChatTable =
  | "team_messages"
  | "club_messages"
  | "group_messages"
  | "broadcast_messages"
  | "club_admin_messages"
  | "direct_messages";

const REACTION_FK: Record<ChatTable, string | null> = {
  team_messages: "team_message_id",
  club_messages: "club_message_id",
  group_messages: "group_message_id",
  broadcast_messages: "broadcast_message_id",
  club_admin_messages: "club_admin_message_id",
  direct_messages: "direct_message_id",
};

interface Args {
  table: ChatTable;
  scope: Record<string, string>;
  /** ISO timestamp of the target (matched) message */
  createdAt: string;
  /** Comma-separated columns matching the page's normal message shape. */
  selectColumns: string;
  hasAnnouncements?: boolean;
  /** How many messages to fetch immediately before the target */
  before?: number;
  /** How many messages to fetch immediately after the target */
  after?: number;
}

/**
 * Fetches a window of messages surrounding a target message's created_at so a
 * user tapping a search result lands in real conversational context (rows
 * immediately before AND after the match), not just the isolated matched row
 * merged into the loaded set.
 */
export async function fetchMessagesAround({
  table,
  scope,
  createdAt,
  selectColumns,
  hasAnnouncements = false,
  before = 25,
  after = 25,
}: Args): Promise<any[]> {
  let beforeQ: any = (supabase.from as any)(table)
    .select(selectColumns)
    .lte("created_at", createdAt)
    .order("created_at", { ascending: false })
    .limit(before + 1)
    .is("deleted_at", null);
  let afterQ: any = (supabase.from as any)(table)
    .select(selectColumns)
    .gt("created_at", createdAt)
    .order("created_at", { ascending: true })
    .limit(after)
    .is("deleted_at", null);
  for (const [col, val] of Object.entries(scope)) {
    beforeQ = beforeQ.eq(col, val);
    afterQ = afterQ.eq(col, val);
  }

  const [beforeRes, afterRes] = await Promise.all([beforeQ, afterQ]);
  if (beforeRes.error && afterRes.error) return [];
  const rows: any[] = [
    ...((beforeRes.data as any[]) || []),
    ...((afterRes.data as any[]) || []),
  ];
  if (rows.length === 0) return [];

  // De-dupe (target row appears via the before query)
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  const messageIds = unique.map((m) => m.id);
  const replyToIds = unique.filter((m) => m.reply_to_id).map((m) => m.reply_to_id as string);
  const authorIds = [...new Set(unique.map((m) => m.author_id).filter(Boolean))];
  const reactionFk = REACTION_FK[table];

  const reactionsPromise: Promise<{ data: any[] }> = reactionFk
    ? ((supabase.from as any)("message_reactions")
        .select(`id, user_id, reaction_type, ${reactionFk}`)
        .in(reactionFk, messageIds) as Promise<{ data: any[] }>)
    : Promise.resolve({ data: [] });
  const replyToPromise: Promise<{ data: any[] }> =
    replyToIds.length > 0
      ? ((supabase.from as any)(table)
          .select("id, text, author_id")
          .in("id", replyToIds) as Promise<{ data: any[] }>)
      : Promise.resolve({ data: [] });

  const [reactionsResult, replyToResult, profilesMap] = await Promise.all([
    reactionsPromise,
    replyToPromise,
    fetchProfilesWithCache(authorIds),
  ]);

  const reactionsData = (reactionsResult as any).data || [];
  const replyToData = (replyToResult as any).data || [];

  return unique.map((msg) => {
    const profile = profilesMap.get(msg.author_id);
    const replyTo = msg.reply_to_id
      ? replyToData.find((r: any) => r.id === msg.reply_to_id) || null
      : null;
    const reactions = reactionFk
      ? reactionsData.filter((r: any) => r[reactionFk] === msg.id)
      : [];
    return {
      ...msg,
      ...(hasAnnouncements
        ? {
            is_club_announcement: msg.is_club_announcement || false,
            club_announcement_name: msg.club_announcement_name || null,
            is_system_message: msg.is_system_message || false,
          }
        : {}),
      profiles: profile
        ? { display_name: profile.display_name, avatar_url: profile.avatar_url }
        : null,
      reactions,
      reply_to: replyTo,
    };
  });
}
