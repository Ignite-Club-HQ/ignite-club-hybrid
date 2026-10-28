import type { QueryClient } from "@tanstack/react-query";
import { prefetchMessagePolls } from "@/lib/pollReadRepository";
import { withReadDeadline } from "@/live/readDeadline";
import { readIcpThreadPage } from "@/features/messaging/thread/icpThreadRead";
import { fetchProfilesWithCache, getProfilesFromCache } from "@/lib/profileCache";
import {
  ensureLiveClubConversations,
  isLiveConversationAbsent,
  listLiveLatestMessagesPage,
  listLiveReactions,
} from "@/live/features/messaging";
import { withFeatureBackend } from "@/live/featureRouter";
import { getCachedTeam } from "@/lib/clubTeamCache";
import { privateClubNameDisplaysEnabled } from "@/live/privateClubNameDisplayMode";

export const ICP_TEAM_MESSAGES_PER_PAGE = 30;

/** Maps canister rows into the shared team chat message shape (newest first). */
export async function mapLiveTeamRows(ctx: any, teamId: string, rows: any[], onReady?: (rows: any[]) => void): Promise<any[]> {
  const privateNames = privateClubNameDisplaysEnabled();
  const authorIds = [...new Set(rows.map((m: any) => m.sender.toText() as string))];
  if (onReady) {
    const profiles = privateNames ? new Map() : getProfilesFromCache(authorIds).cached;
    const byId = new Map(rows.map(row => [row.id, row]));
    onReady(rows.slice().sort((a, b) => Number(b.sequence - a.sequence)).map(row => {
      const attachment = row.attachment?.[0];
      const profile = profiles.get(row.sender.toText());
      const replyId = row.reply_to_id?.[0] ?? null;
      const reply = byId.get(replyId);
      return { id: row.id, text: row.body, team_id: teamId, author_id: row.sender.toText(),
        image_url: attachment?.kind === "image" ? (attachment.url?.[0] ?? attachment.ref_id ?? null) : null,
        created_at: new Date(Number(row.created_at_ms)).toISOString(),
        edited_at: row.edited_at_ms?.[0] ? new Date(Number(row.edited_at_ms[0])).toISOString() : null,
        reply_to_id: replyId, reply_to: reply ? { text: reply.body, profiles: null } : null,
        profiles: profile ? { display_name: profile.display_name, avatar_url: profile.avatar_url } : null,
        reactions: [], deleted_at: null, is_club_announcement: false, club_announcement_name: null,
        is_system_message: false, forwarded_from_user_id: null, forwarded_at: null, forwarded_source_label: null };
    }));
  }
  const profilesRead = privateNames ? Promise.resolve(new Map()) : withReadDeadline(fetchProfilesWithCache(authorIds), "Chat profiles", 1500)
    .catch(() => getProfilesFromCache(authorIds).cached);
  const reactionsRead = withReadDeadline(listLiveReactions(ctx, teamId), "Chat reactions", 1500).catch(() => []);
  const [profilesMap, liveReactions] = await Promise.all([profilesRead, reactionsRead]);
  const reactionsByMessage = new Map<string, any[]>();
  try {
    for (const r of liveReactions as any[]) {
      const uid = r.user.toText();
      const list = reactionsByMessage.get(r.message_id) ?? [];
      list.push({ id: `${r.message_id}:${uid}:${r.emoji}`, user_id: uid, reaction_type: r.emoji, team_message_id: r.message_id });
      reactionsByMessage.set(r.message_id, list);
    }
  } catch { /* canister without list_reactions */ }
  const rawById = new Map<string, any>(rows.map((m: any) => [m.id, m]));
  return rows
    .slice()
    .sort((a: any, b: any) => Number(b.sequence - a.sequence))
    .map((m: any) => {
      const profile = profilesMap.get(m.sender.toText());
      const attachment = m.attachment?.[0];
      const replyToId: string | null = m.reply_to_id?.[0] ?? null;
      const replyTarget = replyToId ? rawById.get(replyToId) : null;
      const replyProfile = replyTarget ? profilesMap.get(replyTarget.sender.toText()) : null;
      return {
        id: m.id,
        text: m.body,
        image_url: attachment?.kind === "image" ? (attachment.url?.[0] ?? attachment.ref_id ?? null) : null,
        created_at: new Date(Number(m.created_at_ms)).toISOString(),
        edited_at: m.edited_at_ms?.[0] ? new Date(Number(m.edited_at_ms[0])).toISOString() : null,
        author_id: m.sender.toText(),
        team_id: teamId,
        reply_to_id: replyToId,
        deleted_at: null,
        is_club_announcement: false,
        club_announcement_name: null,
        is_system_message: false,
        forwarded_from_user_id: null,
        forwarded_at: null,
        forwarded_source_label: null,
        profiles: profile ? { display_name: profile.display_name, avatar_url: profile.avatar_url } : null,
        reactions: reactionsByMessage.get(m.id) ?? [],
        reply_to: replyTarget
          ? { text: replyTarget.body, profiles: { display_name: replyProfile?.display_name ?? null } }
          : null,
      };
    });
}

/** Scope a team read by its club when known, so no group has to be probed. */
export function teamThreadScope(teamId: string, clubId?: string | null) {
  const club = clubId || getCachedTeam(teamId)?.club_id || null;
  return club ? { clubId: club } : { teamId };
}

/** Newest page of an ICP team chat, in the exact shape the team chat query stores. */
export async function fetchIcpTeamLatestPage(queryClient: QueryClient, userId: string, teamId: string, clubId?: string | null, signal?: AbortSignal) {
  return withFeatureBackend("messaging", {
    supabase: async () => { throw new Error("unreachable: messaging routed to ICP"); },
    icp: async (ctx) => {
      const club = clubId || getCachedTeam(teamId)?.club_id || null;
      const page = await readIcpThreadPage(
        () => withReadDeadline(listLiveLatestMessagesPage(ctx, teamId, null, ICP_TEAM_MESSAGES_PER_PAGE), "Chat messages"),
        club ? () => ensureLiveClubConversations(ctx, club) : undefined,
        () => isLiveConversationAbsent(ctx, teamId),
      );
      prefetchMessagePolls(queryClient, page.messages, userId, { teamId }, true, ctx);
      const icpOlderCursor = Array.isArray(page.next_sequence) && page.next_sequence.length > 0
        ? Number(page.next_sequence[0]) : null;
      if (signal?.aborted) throw new Error("Chat read cancelled");
      const messages = await mapLiveTeamRows(ctx, teamId, page.messages, readyMessages => {
        if (signal?.aborted) return;
        queryClient.setQueryData(["team-messages", teamId], (previous: any) => previous?.messages?.length ? previous : {
          messages: readyMessages, hasOlderMessages: icpOlderCursor !== null, fromCache: false, icpOlderCursor,
        });
      });
      if (signal?.aborted) throw new Error("Chat read cancelled");
      return { messages, hasOlderMessages: icpOlderCursor !== null, fromCache: false, icpOlderCursor };
    },
  }, teamThreadScope(teamId, clubId));
}

/**
 * Background-load the newest page of the inbox's top team chats so opening one
 * shows messages at once. Skips chats already cached; a few at a time so the
 * last of them is not left waiting behind the others.
 */
export async function prefetchIcpTeamThreads(queryClient: QueryClient, userId: string, teams: ReadonlyArray<{ id: string; clubId?: string | null }>, max = 5) {
  const queue = teams.slice(0, max).filter(t => !queryClient.getQueryData(["team-messages", t.id]));
  await runFewAtATime(queue, t => queryClient.prefetchQuery({
    queryKey: ["team-messages", t.id],
    queryFn: () => fetchIcpTeamLatestPage(queryClient, userId, t.id, t.clubId),
    staleTime: 30_000,
  }));
}

/** Bounded parallel background work; failures are ignored. */
export async function runFewAtATime<T>(items: readonly T[], work: (item: T) => Promise<unknown>, limit = 3): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++];
      await work(item).catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}
