import { supabase } from "@/integrations/supabase/client";
import { getChatScopeAdapterByTable, type ChatMessageTable } from "@/features/messaging/scopes/chatScopeAdapters";
import { fetchProfilesWithCache } from "@/lib/profileCache";

interface Args {
  table: ChatMessageTable;
  scope: Record<string, string>;
  query: string;
  signal: AbortSignal;
  /** Comma-separated columns matching what the page already loads. Must include id, text, author_id, created_at, reply_to_id. */
  selectColumns: string;
  /** Whether to include club announcement / system flags in the mapped result (only for tables that have them). */
  hasAnnouncements?: boolean;
  limit?: number;
}

export async function searchChatHistory({
  table,
  scope,
  query,
  signal,
  selectColumns,
  hasAnnouncements = false,
  limit = 100,
}: Args): Promise<any[]> {
  const safe = query.replace(/[\\%_]/g, (m) => `\\${m}`);
  let q: any = (supabase.from as any)(table)
    .select(selectColumns)
    .ilike("text", `%${safe}%`)
    .order("created_at", { ascending: false })
    .limit(limit)
    .abortSignal(signal);
  // All message tables use deleted_at as a soft-delete marker.
  q = q.is("deleted_at", null);
  for (const [col, val] of Object.entries(scope)) {
    q = q.eq(col, val);
  }

  const { data, error } = await q;
  if (error || !data?.length) return [];

  const rows = data as any[];
  const messageIds = rows.map((m) => m.id);
  const replyToIds = rows.filter((m) => m.reply_to_id).map((m) => m.reply_to_id as string);
  const authorIds = [...new Set(rows.map((m) => m.author_id).filter(Boolean))];
  const reactionFk = getChatScopeAdapterByTable(table).reactionForeignKey;

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

  return rows.map((msg) => {
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
