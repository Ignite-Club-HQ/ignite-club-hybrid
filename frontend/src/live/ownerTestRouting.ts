/** Caller-scoped consensus owner discovery. No browser setting grants admission.
 * Stopping new placements retains discovery for already-created test clubs. */
import type { FeatureBackendContext } from './featureRouter';
export type OwnerRoute = { groupId: 'g2'; acceptingNew: boolean; clubIds: string[]; evidence: string };
let confirmed: { key: string; value: OwnerRoute | null } | null = null;
const keyFor = (ctx: FeatureBackendContext) => JSON.stringify([ctx.identity.getPrincipal().toText(), ctx.target.alias,
  ctx.target.host, ctx.target.networkKind, ctx.target.canisterIds?.shard_router]);
export function hasOwnerTestRouting(ctx?: FeatureBackendContext): boolean {
  return Boolean(confirmed?.value && (!ctx || confirmed.key === keyFor(ctx)));
}
export function clearOwnerTestRouting() { confirmed = null; cachedRoute = null; }
export async function readOwnerTestRoute(ctx: FeatureBackendContext): Promise<OwnerRoute | null> {
  if (!ctx.target.canisterIds?.shard_router || ctx.identity.getPrincipal().toText() === '2vxsx-fae') return null;
  const key = keyFor(ctx);
  const { connectLiveShardRouter } = await import('./domains');
  const { actor } = await connectLiveShardRouter(ctx.target, ctx.identity);
  let reply;
  try { reply = await actor.read_my_owner_test_opening(ctx.target.alias); }
  catch (error) {
    // Compatibility with a not-yet-upgraded router only. Network failures must
    // not send known assigned clubs back to the shared authority.
    if (!/has no (query |update )?method|method.*(not found|does not exist)/i.test(String(error))) throw error;
    if (confirmed?.key === key && confirmed.value) throw error;
    confirmed = { key, value: null }; return null;
  }
  if ('Err' in reply) throw new Error(reply.Err);
  const receipt = reply.Ok[0];
  if (!receipt) {
    if (confirmed?.key === key && confirmed.value) throw new Error('Owner opening disappeared');
    confirmed = { key, value: null }; return null;
  }
  const a = receipt.approval;
  if (key !== keyFor(ctx) || a.owner.toText() !== ctx.identity.getPrincipal().toText() || a.group.id !== 'g2' ||
      a.group.target_alias !== ctx.target.alias || a.group.accepting || a.placement.network_kind !== ctx.target.networkKind ||
      new URL(a.placement.host).origin !== new URL(ctx.target.host).origin || a.club_ids.length < 1 || a.club_ids.length > 10 ||
      new Set(a.club_ids).size !== a.club_ids.length || a.club_ids.some(id => !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) ||
      !/^[a-f0-9]{64}$/i.test(a.evidence_sha256)) throw new Error('Owner opening does not match this identity and deployment');
  const value: OwnerRoute = { groupId: 'g2', acceptingNew: receipt.accepting_new, clubIds: a.club_ids, evidence: a.evidence_sha256 };
  confirmed = { key, value }; return value;
}

/** Routing-decision variant: one shared answer per identity/deployment for
 * 30s (and one in-flight read), so ordinary page reads don't each pay a
 * consensus call. Creation still uses the fresh readOwnerTestRoute. */
const ROUTE_TTL_MS = 30_000;
let cachedRoute: { key: string; at: number; value: Promise<OwnerRoute | null> } | null = null;
export function readOwnerTestRouteCached(ctx: FeatureBackendContext): Promise<OwnerRoute | null> {
  if (!ctx.target.canisterIds?.shard_router) return Promise.resolve(null);
  const key = keyFor(ctx);
  if (cachedRoute && cachedRoute.key === key && Date.now() - cachedRoute.at < ROUTE_TTL_MS) return cachedRoute.value;
  const value = readOwnerTestRoute(ctx);
  const entry = { key, at: Date.now(), value };
  cachedRoute = entry;
  value.catch(() => { if (cachedRoute === entry) cachedRoute = null; });
  return value;
}

/** All ordinary creation screens use the next explicitly approved UUID.
 * An unknown create outcome keeps its reservation; readback, never replay. */
export async function nextOwnerTestClubId(ctx: FeatureBackendContext, requested: string): Promise<string> {
  const route = await readOwnerTestRoute(ctx);
  if (!route) return requested;
  if (!route.acceptingNew) throw new Error('Group 2 test creation is stopped');
  const { connectLiveShardRouter } = await import('./domains');
  const { actor } = await connectLiveShardRouter(ctx.target, ctx.identity);
  const revision = await actor.version();
  for (const id of route.clubIds) {
    const reply = await actor.read_hosted_club_assignment(id, ctx.target.alias, revision);
    if ('Err' in reply && reply.Err === 'Missing club assignment') return id;
    if ('Err' in reply) throw new Error(reply.Err);
    if (reply.Ok.group_id !== 'g2') throw new Error('Approved test club is assigned to a foreign group');
  }
  throw new Error('All approved test club IDs are reserved; check the existing clubs before requesting another opening');
}