import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { withFeatureBackend, type ClubScope, type FeatureBackendContext } from '@/live/featureRouter';
import { getLivePollResults, takeBundledPollResult } from '@/live/features/messaging';

export interface PollRow {
  id: string; question: string; allow_multiple: boolean;
  closes_at: string | null; closed_at: string | null;
  created_by: string; created_at: string;
}
export interface PollOptionRow { id: string; label: string; position: number }
export interface PollVoteRow { id: string; option_id: string; user_id: string }
export interface PollData { poll: PollRow; options: PollOptionRow[]; votes: PollVoteRow[]; closed: boolean; voterDetailsAvailable?: boolean }

/** The conversation id a chat scope addresses, for open_conversation bundle lookups. */
function conversationKeyOf(scope: ClubScope | undefined): string | null {
  if (!scope) return null;
  const s = scope as { conversationId?: string; teamId?: string; clubId?: string };
  return s.conversationId ?? s.teamId ?? s.clubId ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- candid PollResults shape
export function pollResultsToData(pollId: string, results: any): PollData {
  const createdAt = new Date(Number(results.poll.created_at_ms)).toISOString();
  const votes: PollVoteRow[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- candid counts
  results.counts.forEach((count: any, idx: number) => {
    for (let i = 0; i < count; i += 1) votes.push({ id: `${idx}-${i}`, option_id: String(idx), user_id: '' });
  });
  const individualVotes = results.votes?.[0];
  if (individualVotes) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- candid PollVote
    votes.splice(0, votes.length, ...individualVotes.map((v: any) => ({
      id: `${pollId}:${v.user.toText()}`, option_id: String(v.option_index), user_id: v.user.toText(),
    })));
  }
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- candid Poll
    poll: { id: results.poll.id, question: results.poll.question, allow_multiple: false,
      closes_at: null, closed_at: results.poll.closed ? createdAt : null,
      created_by: results.poll.creator.toText(), created_at: createdAt },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- candid options
    options: results.poll.options.map((label: any, position: number) => ({ id: String(position), label, position })),
    votes, closed: results.poll.closed, voterDetailsAvailable: individualVotes !== undefined,
  };
}

export async function readIcpPoll(ctx: FeatureBackendContext, pollId: string, scope?: ClubScope): Promise<PollData> {
  // Poll results bundled with the thread's open_conversation read render
  // instantly; only polls outside the first page need their own round trip.
  const convKey = conversationKeyOf(scope);
  const bundled = convKey ? takeBundledPollResult(convKey, pollId) : null;
  if (bundled) return pollResultsToData(pollId, bundled);
  const results = await getLivePollResults(ctx, pollId);
  return pollResultsToData(pollId, results);
}

export function pollQueryOptions(pollId: string, userId: string | undefined, scope: ClubScope | undefined, icpMode: boolean, ctx?: FeatureBackendContext) {
  return queryOptions({
    queryKey: ['poll', pollId, userId, JSON.stringify(scope ?? null)],
    queryFn: async (): Promise<PollData | null> => {
      if (icpMode) {
        if (ctx) return readIcpPoll(ctx, pollId, scope);
        return withFeatureBackend('messaging', {
          supabase: async () => { throw new Error('unreachable'); },
          icp: scoped => readIcpPoll(scoped, pollId, scope),
        }, scope);
      }
      const [pollRes, optsRes, votesRes] = await Promise.all([
        supabase.from('polls').select('*').eq('id', pollId).maybeSingle(),
        supabase.from('poll_options').select('*').eq('poll_id', pollId).order('position', { ascending: true }),
        supabase.from('poll_votes').select('id, option_id, user_id').eq('poll_id', pollId),
      ]);
      if (pollRes.error) throw pollRes.error;
      if (optsRes.error) throw optsRes.error;
      if (votesRes.error) throw votesRes.error;
      if (!pollRes.data) return null;
      return { poll: pollRes.data as PollRow, options: (optsRes.data || []) as PollOptionRow[],
        votes: (votesRes.data || []) as PollVoteRow[], closed: !!pollRes.data.closed_at, voterDetailsAvailable: true };
    },
    staleTime: 15_000,
    gcTime: 24 * 60 * 60_000,
    retry: 1,
  });
}

/** Start bounded poll reads as soon as message bodies arrive, before author/reaction enrichment. */
export function prefetchMessagePolls(client: QueryClient, rows: Array<{ text?: string | null; body?: string | null }>, userId: string, scope: ClubScope, icpMode: boolean, ctx?: FeatureBackendContext) {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const match of (row.text ?? row.body ?? '').matchAll(/\[poll:([^\]]+)\]/g)) {
      if (ids.size < 6) ids.add(match[1]);
    }
  }
  const convKey = conversationKeyOf(scope);
  for (const id of ids) {
    // Polls that rode along with open_conversation seed the cache directly —
    // no second round trip for something the thread open already fetched.
    const bundled = icpMode && convKey ? takeBundledPollResult(convKey, id) : null;
    if (bundled) {
      const options = pollQueryOptions(id, userId, scope, icpMode, ctx);
      client.setQueryData(options.queryKey, pollResultsToData(id, bundled));
      continue;
    }
    void client.prefetchQuery(pollQueryOptions(id, userId, scope, icpMode, ctx));
  }
}