/** General multi-group routing switch (the "open to everyone" step).
 *
 * Operator approval lives in the committed, governor-verified snapshot
 * (frontend/src/live/generated/routingGates.ts, produced by
 * frontend/scripts/produce-routing-gates.ts from live certified reads).
 * Activation additionally requires the LIVE router registry to still be at
 * the approved revision with identical group inventory, so any group added,
 * changed or removed after the snapshot invalidates the switch until it is
 * re-verified and a new snapshot is shipped.
 *
 * Failing live reads fail closed by throwing: grouped clubs never fall back
 * to the shared canisters. Not signed in, or a deployment without a group
 * router (Supabase mode), is inactive rather than an error. */
import { activationStatus, type ActivationGates } from './groupActivation';
import type { FeatureBackendContext } from './featureRouter';
import { GROUP_DOMAINS } from './groupRouting';
import { ROUTING_GATES_SNAPSHOT } from './generated/routingGates';
import type { RemovalWiringEvidence } from './groupRemovalWiring';

export type RoutingGatesSnapshot = {
  approved: true;
  generatedAt: string;
  /** On-chain deployment name the registry groups carry; router calls must use
   * this, never the frontend's own target alias (they differ by design). */
  targetAlias: string;
  host: string;
  /** Router canister this snapshot was verified against; absence fails closed. */
  routerCanisterId?: string;
  /** Decimal text of the registry revision this switch was verified against. */
  registryRevision: string;
  /** Exact inventory anchor: any registry change requires a fresh snapshot. */
  groups: { id: string; domains: { domain: string; canisterId: string }[]; photoStore: string | null;
    moduleHashes: Record<string, string> }[];
  removalWiring: { revision: string; groupIds: string[]; checkedAtMs: number };
  evidenceSha256: string;
};

export type RoutingStatus = { active: boolean; missing: string[] };
const TTL_MS = 60_000;
let cache: { key: string; value: RoutingStatus; atMs: number } | null = null;

export function clearGeneralRoutingCache() { cache = null; }
/** Sync view for call sites that cannot await (media URL parsing). Cold or
 * stale simply means not-yet-active; the async check always decides writes. */
export function cachedGeneralRoutingActive(): boolean { return cache?.value.active ?? false; }

const keyFor = (ctx: FeatureBackendContext) => JSON.stringify([safePrincipal(ctx), ctx?.target?.alias ?? null,
  ctx?.target?.host ?? null, ctx?.target?.networkKind ?? null, ctx?.target?.canisterIds?.shard_router ?? null]);
const safePrincipal = (ctx?: FeatureBackendContext) => {
  try { return ctx?.identity?.getPrincipal?.().toText?.() ?? null; } catch { return null; }
};

export async function generalRoutingStatus(ctx: FeatureBackendContext): Promise<RoutingStatus> {
  const key = keyFor(ctx);
  if (cache && cache.key === key && Date.now() - cache.atMs < TTL_MS) return cache.value;
  const value = await compute(ctx);
  cache = { key, value, atMs: Date.now() };
  return value;
}

export async function routingActive(ctx: FeatureBackendContext): Promise<boolean> {
  return (await generalRoutingStatus(ctx)).active;
}

/** On-chain deployment name from the approved snapshot. Every shard_router
 * call must send this, not the frontend's own target alias. */
export function generalRoutingDeploymentAlias(): string | null {
  const s = ROUTING_GATES_SNAPSHOT;
  return s && s.approved === true ? s.targetAlias : null;
}

const inventory = (g: { domains: readonly { domain: string; canisterId: string }[]; photoStore?: string | null }): string =>
  [...g.domains.map(d => `${d.domain}=${d.canisterId}`)].sort().join(',') + '|' + (g.photoStore ?? '');

async function compute(ctx: FeatureBackendContext): Promise<RoutingStatus> {
  if (!ctx?.target?.canisterIds?.shard_router || !safePrincipal(ctx)) return { active: false, missing: ['no group router on this deployment'] };
  if (safePrincipal(ctx) === '2vxsx-fae') return { active: false, missing: ['not signed in'] };
  const snapshot = ROUTING_GATES_SNAPSHOT;
  if (!snapshot || snapshot.approved !== true) return { active: false, missing: ['no operator-approved routing snapshot in this build'] };
  // Bind to the verified router canister and gateway, not the frontend's own
  // target alias: the runtime alias is a local name for the same deployment.
  if (snapshot.host !== ctx.target.host || !snapshot.routerCanisterId ||
      snapshot.routerCanisterId !== ctx.target.canisterIds.shard_router) {
    return { active: false, missing: ['snapshot targets another deployment'] };
  }
  const { connectLiveShardRouter } = await import('./domains');
  const { actor } = await connectLiveShardRouter(ctx.target, ctx.identity);
  const { readPinnedGroupRegistry } = await import('./groupRegistryPager');
  // Two complete consensus reads; a registry that changes mid-read throws.
  const registry = await readPinnedGroupRegistry((rev, cursor, limit) => actor.read_group_registry_page(snapshot.targetAlias, rev, cursor, limit));
  if (registry.revision !== BigInt(snapshot.registryRevision)) throw new Error('Routing switch is bound to an older registry revision; re-run the routing-snapshot verification and ship it');
  const live = new Map(registry.groups.map(g => [g.id, { domains: g.domains.map(d => [d.domain, d.canister.toText()] as const), photoStore: g.photo_store[0]?.toText() ?? null }]));
  const approved = new Map(snapshot.groups.map(g => [g.id, { domains: g.domains.map(d => [d.domain, d.canisterId] as const), photoStore: g.photoStore }]));
  for (const [id, want] of approved) {
    const got = live.get(id);
    if (!got || inventory(want) !== inventory(got)) throw new Error(`Group ${id} changed since the routing snapshot; re-verify before routing`);
  }
  if (live.size !== approved.size) throw new Error('Registry group set changed since the routing snapshot; re-verify before routing');
  const removalWiring: RemovalWiringEvidence = { revision: BigInt(snapshot.removalWiring.revision),
    groupIds: snapshot.removalWiring.groupIds, checkedAtMs: snapshot.removalWiring.checkedAtMs };
  const gates: ActivationGates = { operatorApproved: true, recoveryVerified: true, rehearsalPassed: true, mainnetVerified: true,
    routedDomains: [...GROUP_DOMAINS], registryRevision: registry.revision, approvedRevision: BigInt(snapshot.registryRevision), removalWiring };
  return activationStatus(gates);
}
