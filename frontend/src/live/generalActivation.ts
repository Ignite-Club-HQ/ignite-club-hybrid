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
import { withReadDeadline } from './readDeadline';
import { ROUTING_GATES_SNAPSHOT } from './generated/routingGates';
import type { RemovalWiringEvidence } from './groupRemovalWiring';
import { groupApprovalConfiguration, approvalConfigurationSha256 } from './groupApproval';

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
  /** Separate approval epoch; legacy snapshots need governor regeneration. */
  configurationRevision?: string;
  approvedConfiguration?: string;
  /** Exact inventory anchor: any registry change requires a fresh snapshot. */
  groups: { id: string; domains: { domain: string; canisterId: string }[]; photoStore: string | null;
    moduleHashes: Record<string, string> }[];
  removalWiring: { revision: string; groupIds: string[]; checkedAtMs: number };
  evidenceSha256: string;
};

export type RoutingStatus = { active: boolean; missing: string[] };
const TTL_MS = 60_000;
let cache: { key: string; value: RoutingStatus; atMs: number } | null = null;

let inflight: { key: string; p: Promise<RoutingStatus> } | null = null;
let generation = 0;
export function clearGeneralRoutingCache() { generation++; cache = null; inflight = null; }
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
  const startedGeneration = generation;
  if (cache && cache.key === key && Date.now() - cache.atMs < TTL_MS) return cache.value;
  // Concurrent callers on page load share one check (it reads the registry twice).
  if (inflight?.key !== key) {
    const p = withReadDeadline(compute(ctx), 'Routing approval').finally(() => { if (inflight?.p === p) inflight = null; });
    inflight = { key, p };
  }
  const entry = inflight;
  const value = await entry.p;
  // A cleared/replaced request must not restore an old account's cache.
  if (generation === startedGeneration && keyFor(ctx) === key && (!inflight || inflight === entry)) cache = { key, value, atMs: Date.now() };
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
  if (registry.configurationRevision === undefined) {
    throw new Error('Group routing needs the updated router and a fresh approved snapshot before creating clubs');
  }
  // The build-time snapshot only anchors the router and deployment alias. When
  // the configuration has moved on (for example a new group was opened), the
  // governor-recorded live approval on the router decides instead, with the
  // same fail-closed comparison against the live registry.
  if (snapshot.configurationRevision === undefined || !snapshot.approvedConfiguration ||
      registry.configurationRevision !== BigInt(snapshot.configurationRevision)) {
    return liveApprovalStatus(actor, snapshot, registry);
  }
  const live = new Map(registry.groups.map(g => [g.id, { domains: g.domains.map(d => ({ domain: d.domain, canisterId: d.canister.toText() })), photoStore: g.photo_store[0]?.toText() ?? null }]));
  const approved = new Map(snapshot.groups.map(g => [g.id, { domains: g.domains, photoStore: g.photoStore }]));
  for (const [id, want] of approved) {
    const got = live.get(id);
    if (!got || inventory(want) !== inventory(got)) throw new Error(`Group ${id} changed since the routing snapshot; re-verify before routing`);
  }
  if (live.size !== approved.size) throw new Error('Registry group set changed since the routing snapshot; re-verify before routing');
  if (groupApprovalConfiguration(registry.groups, registry.placements) !== snapshot.approvedConfiguration) {
    throw new Error('Group placement or policy changed since approval; run snapshot and publish before creating clubs');
  }
  const removalWiring: RemovalWiringEvidence = { revision: BigInt(snapshot.removalWiring.revision),
    groupIds: snapshot.removalWiring.groupIds, checkedAtMs: snapshot.removalWiring.checkedAtMs };
  const gates: ActivationGates = { operatorApproved: true, recoveryVerified: true, rehearsalPassed: true, mainnetVerified: true,
    routedDomains: [...GROUP_DOMAINS], registryRevision: registry.configurationRevision, approvedRevision: BigInt(snapshot.configurationRevision), removalWiring };
  return activationStatus(gates);
}

type LiveRegistry = { configurationRevision?: bigint; groups: Parameters<typeof groupApprovalConfiguration>[0];
  placements: Parameters<typeof groupApprovalConfiguration>[1] };
const STALE = 'Group configuration changed since approval; finish the group setup run before creating clubs';

async function liveApprovalStatus(actor: { read_routing_approval?: (alias: string) => Promise<unknown> },
  snapshot: RoutingGatesSnapshot, registry: LiveRegistry): Promise<RoutingStatus> {
  let reply: { Ok: [] | [{ target_alias: string; configuration_revision: bigint; approved_configuration_sha256: string;
    removal_wiring_group_ids: string[]; removal_checked_at_ms: bigint }] } | { Err: string };
  try {
    if (typeof actor.read_routing_approval !== 'function') throw new Error('unsupported');
    reply = await actor.read_routing_approval(snapshot.targetAlias) as typeof reply;
  } catch {
    // An older router without live approvals: fall back to the old message.
    throw new Error(STALE);
  }
  if ('Err' in reply) throw new Error(reply.Err);
  const approval = reply.Ok[0];
  if (!approval || approval.target_alias !== snapshot.targetAlias || approval.configuration_revision !== registry.configurationRevision) throw new Error(STALE);
  const liveIds = registry.groups.map(g => g.id).sort();
  const approvedIds = [...approval.removal_wiring_group_ids].sort();
  if (liveIds.length === 0 || JSON.stringify(liveIds) !== JSON.stringify(approvedIds)) throw new Error('Registry group set changed since approval; re-verify before routing');
  const digest = await approvalConfigurationSha256(groupApprovalConfiguration(registry.groups, registry.placements));
  if (digest !== approval.approved_configuration_sha256) throw new Error('Group placement or policy changed since approval; finish the group setup run before creating clubs');
  const removalWiring: RemovalWiringEvidence = { revision: approval.configuration_revision, groupIds: approvedIds,
    checkedAtMs: Number(approval.removal_checked_at_ms) };
  return activationStatus({ operatorApproved: true, recoveryVerified: true, rehearsalPassed: true, mainnetVerified: true,
    routedDomains: [...GROUP_DOMAINS], registryRevision: approval.configuration_revision, approvedRevision: registry.configurationRevision!, removalWiring });
}
