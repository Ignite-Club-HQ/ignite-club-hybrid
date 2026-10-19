import type { FeatureBackendContext } from './featureRouter';

/** The batch read applies canViewLeague on the canister; hidden/missing
 * leagues yield no row, while a failed group read must abort discovery. */
export async function lookupMiniLeagueOwner(ctx: FeatureBackendContext, id: string): Promise<string | null> {
  const { connectLiveMiniLeagueDomain } = await import('./domains');
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  const reply = await actor.get_mini_leagues([id]);
  if ('Err' in reply) throw new Error(reply.Err);
  const row = reply.Ok.find(league => league.id === id);
  return row?.club_id ?? null;
}