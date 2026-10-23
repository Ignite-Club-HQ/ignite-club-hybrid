// Protected release policy for the permanent membership lookup.
// Exact inventory-derived targets: pinned shared identity plus every existing
// registered club source/original G1. Nothing else is upgraded or opened.
// Historical completion never certifies readiness; enable is identity-owned.
import { digest, executeUpgrades } from './subscription-upgrade-policy.mjs';
import { requireHistoricalCheckpoint } from './membership-acceptance-checks.mjs';
import { upgradeArgs } from './group2-upgrade-rules.mjs';
export { digest, executeUpgrades };

export const CONFIRMATION = 'RELEASE MEMBERSHIP LOOKUP';
export const PINNED = {
  identity: 'mq2sj-fiaaa-aaaal-qxlqa-cai',
  g1: 'mzzzv-taaaa-aaaal-qxlrq-cai',
  g2: 'yfwyv-nyaaa-aaaal-qxpyq-cai',
};

/** Complete observed sources, not a fixed-count upgrade allowlist. The
 * original G1 is explicitly pinned; every registered group stays in the list.
 * This makes no placement, authority grant or readiness claim. */
export function directorySources(snapshot) {
  if (!snapshot || typeof snapshot.revision !== 'bigint' || snapshot.revision < 1n ||
      !Array.isArray(snapshot.groups) || !snapshot.groups.length || snapshot.groups.length > 4096 ||
      !Array.isArray(snapshot.placements) || snapshot.placements.length !== snapshot.groups.length) throw new Error('Complete registered source snapshot required');
  const text = p => typeof p === 'string' ? p : p?.toText?.();
  const groups = new Set(), authorities = new Set(), placements = new Set();
  for (const p of snapshot.placements) {
    if (placements.has(p.group_id)) throw new Error('Duplicate source placement');
    placements.add(p.group_id);
  }
  const sources = snapshot.groups.map(g => {
    if (typeof g.id !== 'string' || !g.id || g.id.length > 64 || g.id.includes('\u001f') || groups.has(g.id) || g.target_alias !== 'mainnet') throw new Error('Invalid registered source group');
    groups.add(g.id);
    const club = g.domains?.filter(d => d.domain === 'club_domain');
    const p = snapshot.placements.find(p => p.group_id === g.id);
    const placed = p?.domains?.filter(d => d.domain === 'club_domain');
    const authority = club?.length === 1 ? text(club[0].canister) : undefined;
    if (!p || p.deployment_id !== 'mainnet' || p.host !== 'https://icp-api.io' || p.network_kind !== 'public_mainnet' ||
        typeof p.deployment_revision !== 'bigint' || p.deployment_revision < 1n ||
        !authority || ['aaaaa-aa', '2vxsx-fae'].includes(authority) || authorities.has(authority) ||
        placed?.length !== 1 || text(placed[0].canister) !== authority) throw new Error('Exact registered club placement required');
    authorities.add(authority);
    return { groupId: g.id, canisterId: authority };
  });
  const original = sources.find(s => s.groupId === 'g1');
  if (original && original.canisterId !== PINNED.g1) throw new Error('Registered Group 1 differs from original authority');
  if (!original) {
    if (snapshot.groups.some(g => g.domains.some(d => text(d.canister) === PINNED.g1))) throw new Error('Original Group 1 collides with registered service');
    sources.push({ groupId: 'g1', canisterId: PINNED.g1 });
  }
  return sources.sort((a, b) => a.groupId.localeCompare(b.groupId));
}

/** Exact coverage against independently read registry evidence, never a subset. */
export function requireReleaseSourceCoverage(sources, snapshot) {
  const expected = snapshot ? directorySources(snapshot) : sources;
  if (!Array.isArray(sources) || !sources.length || sources.length > 100 ||
      new Set(sources.map(s => s.groupId)).size !== sources.length ||
      new Set(sources.map(s => s.canisterId)).size !== sources.length ||
      !sources.some(s => s.groupId === 'g1' && s.canisterId === PINNED.g1) ||
      sources.some(s => !s.groupId || s.groupId.length > 64 || s.groupId.includes('\u001f') || !s.canisterId || s.canisterId === PINNED.identity ||
        (s.groupId === 'g2' && s.canisterId !== PINNED.g2)) || digest(sources) !== digest(expected)) {
    throw new Error('Exact complete supported source inventory required; no changes permitted');
  }
}
export const PRIMARY_SUBNET = 'e66qm-3cydn-nkf4i-ml4rb-4ro6o-srm5s-x5hwq-hnprz-3meqp-s7vks-5qe';
export function lookupUpgradeArgs(target,path,governor){
  const args=upgradeArgs(target,path,governor);
  if(target.name==='identity_access'){
    // Rust identity uses stable memory, not Motoko EOP heap persistence.
    const persistence=args.indexOf('--wasm-memory-persistence');
    if(persistence>=0)args.splice(persistence,2);
    args[args.indexOf('--args')+1]=`(record { governor = principal "${governor}" })`;
  }
  return args;
}
/** Build the only permitted upgrade set from complete live placements. */
export function lookupReleaseTargets(snapshot, hashes) {
  const sources = directorySources(snapshot); requireReleaseSourceCoverage(sources, snapshot);
  const text = p => typeof p === 'string' ? p : p?.toText?.();
  const first = snapshot.placements[0];
  if (!first || snapshot.placements.some(p => p.deployment_id !== first.deployment_id || p.deployment_revision !== first.deployment_revision ||
      p.host !== first.host || p.network_kind !== first.network_kind)) throw new Error('Common exact directory deployment required');
  const targets = [{ groupId:'shared',name:'identity_access',canisterId:PINNED.identity,subnetId:PRIMARY_SUBNET,newHash:hashes.identity_access }];
  for (const source of sources) {
    const placement = snapshot.placements.find(p => p.group_id === source.groupId);
    const domain = placement?.domains.find(d => d.domain === 'club_domain');
    const subnetId = source.groupId === 'g1' && !placement ? PRIMARY_SUBNET : text(domain?.subnet);
    if (placement && (!subnetId || !placement.approved_subnets?.some(p => text(p) === subnetId) ||
        (!placement.additional_subnets_enabled && subnetId !== text(placement.primary_subnet)))) throw new Error('Unapproved membership source subnet');
    targets.push({ ...source,name:'club_domain',subnetId,newHash:hashes.club_domain });
  }
  validateTargets(targets, sources);
  return targets;
}

export function validateRequest(action, confirmation) {
  if (!['check', 'upgrade'].includes(action)) throw new Error('Choose check or upgrade');
  if (action === 'upgrade' && confirmation?.trim() !== CONFIRMATION) throw new Error(`Type ${CONFIRMATION}`);
}

/** Implementation contract marker; not a live readiness assertion. */
export function requireLookupReleaseAcceptance() {
  // Local implementation gate, not live readiness. The identity-owned enable
  // operation still verifies the complete snapshot before recording release.
  return 'snapshot-checked-private-pages-v1';
}

export function validateTargets(targets, sources = targets?.filter(t => t.name === 'club_domain').map(t => ({groupId:t.groupId,canisterId:t.canisterId}))) {
  requireReleaseSourceCoverage(sources);
  if (!Array.isArray(targets) || targets.length !== sources.length + 1 || new Set(targets.map(t => t.canisterId)).size !== targets.length ||
      targets.filter(t => t.name === 'identity_access' && t.groupId === 'shared' && t.canisterId === PINNED.identity).length !== 1 ||
      sources.some(source => targets.filter(t => t.name === 'club_domain' && t.groupId === source.groupId && t.canisterId === source.canisterId).length !== 1) ||
      targets.some(t => !t.subnetId || !/^[a-f0-9]{64}$/.test(t.newHash))) throw new Error('Exact existing identity and all membership source targets required');
}

export function validateJournal(journal, binding) {
  const sources = binding.sources ?? binding.targets.filter(t => t.name === 'club_domain').map(t => ({groupId:t.groupId,canisterId:t.canisterId}));
  validateTargets(binding.targets, sources);
  if (digest(journal.binding) !== digest(binding) || typeof journal.complete !== 'boolean' || journal.steps?.length !== binding.targets.length ||
      new Set(journal.steps.map(s => s.canisterId)).size !== binding.targets.length) throw new Error('Foreign or incomplete lookup release journal');
  for (const t of binding.targets) {
    const s = journal.steps.find(s => s.canisterId === t.canisterId);
    if (!s || s.groupId !== t.groupId || s.name !== t.name || s.subnetId !== t.subnetId || s.newHash !== t.newHash ||
        !/^[a-f0-9]{64}$/.test(s.oldHash) || !/^[a-f0-9]{64}$/.test(s.settingsHash) || !['ready', 'pending', 'complete'].includes(s.phase)) throw new Error('Invalid lookup release step');
  }
  if (journal.complete && journal.steps.some(s => s.phase !== 'complete')) throw new Error('Unsettled completed journal');
  if (journal.fill && (typeof journal.fill !== 'object' || Object.keys(journal.fill).length !== sources.length || sources.some(s => typeof journal.fill[s.groupId] !== 'boolean'))) throw new Error('Invalid fill record');
  // Even a fully acknowledged historical fill is not global currentness.
  if (journal.ready === true) throw new Error('Historical membership fill cannot certify lookup readiness');
  if (journal.activation && (journal.activation.release !== binding.release ||
      !/^[a-f0-9]{40}$/.test(journal.activation.release ?? '') || !['pending','complete'].includes(journal.activation.phase) ||
      !journal.complete || !journal.replicaAcceptance?.snapshotVerified || !journal.replicaAcceptance?.restorationGuardVerified)) throw new Error('Invalid lookup activation checkpoint');
  requireHistoricalCheckpoint(journal, sources);
}

/** Uses the real source-specific Progress contract. Completion records an
 * acknowledged historical revision only, never global freshness/readiness.
 * Source requests are durable and replay-checked, so unknown network replies
 * may retry this bounded driver; definite refusals stop the run. */
export async function runFill(groups, call, { maxCalls = 100000, retries = 5, persist = async () => {} } = {}) {
  if (!Array.isArray(groups) || new Set(groups).size !== groups.length || !groups.length || groups.length > 100 || groups.some(g => typeof g !== 'string' || !g || g.length > 64 || g.includes('\u001f')) ||
      !Number.isSafeInteger(maxCalls) || maxCalls < 1 || !Number.isSafeInteger(retries) || retries < 0) throw new Error('Exact bounded lookup source list required');
  const done = {};
  for (const groupId of groups) {
    let calls = 0, failures = 0;
    let acknowledged;
    for (;;) {
      if (++calls > maxCalls) throw new Error(`Membership fill did not finish for ${groupId}`);
      let reply;
      try { reply = await call(groupId); failures = 0; }
      catch (e) { if (++failures > retries) throw e; continue; }
      if (!reply || typeof reply !== 'object') throw new Error('Invalid membership progress reply');
      if ('Err' in reply) throw new Error(`Membership fill refused for ${groupId}: ${reply.Err}`);
      const progress = reply.Ok;
      if (!progress || progress.source !== groupId || !['pull', 'materialize', 'published', 'acknowledged'].includes(progress.phase) ||
          typeof progress.revision !== 'bigint' || progress.revision < 1n || progress.revision > 18446744073709551615n ||
          typeof progress.scanned !== 'bigint' || progress.scanned < 0n || progress.scanned > 100n) throw new Error(`Invalid membership progress for ${groupId}`);
      if (progress.phase === 'acknowledged') { acknowledged = progress.revision; break; }
    }
    await persist(groupId, acknowledged);
    done[groupId] = acknowledged;
  }
  return done;
}
