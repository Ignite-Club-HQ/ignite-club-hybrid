// Protected release policy for the permanent membership lookup.
// Exact three targets: the shared identity_access coordinator and the
// existing club_domain membership source in each group. Nothing else may be
// upgraded, created, rewired or opened by this release. Historical source
// completion cannot certify readiness; upgrades remain blocked until the
// source configuration and verified-current release contract are implemented.
import { digest, executeUpgrades } from './subscription-upgrade-policy.mjs';
export { digest, executeUpgrades };

export const CONFIRMATION = 'RELEASE MEMBERSHIP LOOKUP';
export const PINNED = {
  identity: 'mq2sj-fiaaa-aaaal-qxlqa-cai',
  g1: 'mzzzv-taaaa-aaaal-qxlrq-cai',
  g2: 'yfwyv-nyaaa-aaaal-qxpyq-cai',
};

/** Complete observed sources, not the three-service upgrade allowlist. The
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

/** Must run before any installation or journal mutation, independently of the
 * activation gate. Additional groups may be inspected, never silently omitted
 * or upgraded by this exact three-target release. */
export function requireReleaseSourceCoverage(sources) {
  if (!Array.isArray(sources) || sources.length !== 2 ||
      ['g1', 'g2'].some(group => sources.filter(s => s.groupId === group && s.canisterId === PINNED[group]).length !== 1)) {
    throw new Error('Complete source inventory exceeds or differs from the approved three lookup targets; no changes permitted');
  }
}

export function validateRequest(action, confirmation) {
  if (!['check', 'upgrade'].includes(action)) throw new Error('Choose check or upgrade');
  if (action === 'upgrade' && confirmation?.trim() !== CONFIRMATION) throw new Error(`Type ${CONFIRMATION}`);
}

/** Fail before any live upgrade, not after installing modules and discovering
 * that the source inventory/grants and readiness verifier are unavailable. */
export function requireLookupReleaseAcceptance() {
  throw new Error('Lookup upgrade is not ready: exact source configuration, legacy ownership and verified-current release acceptance are required. No canisters changed.');
}

export function validateTargets(targets) {
  if (targets.length !== 3 || new Set(targets.map(t => t.canisterId)).size !== 3 ||
      targets.filter(t => t.name === 'identity_access' && t.groupId === 'shared' && t.canisterId === PINNED.identity).length !== 1 ||
      ['g1', 'g2'].some(group => targets.filter(t => t.groupId === group && t.canisterId === PINNED[group] && t.name === 'club_domain').length !== 1) ||
      targets.some(t => !t.subnetId || !/^[a-f0-9]{64}$/.test(t.newHash))) throw new Error('Exact three existing lookup targets required');
}

export function validateJournal(journal, binding) {
  validateTargets(binding.targets);
  if (digest(journal.binding) !== digest(binding) || typeof journal.complete !== 'boolean' || journal.steps?.length !== 3 ||
      new Set(journal.steps.map(s => s.canisterId)).size !== 3) throw new Error('Foreign or incomplete lookup release journal');
  for (const t of binding.targets) {
    const s = journal.steps.find(s => s.canisterId === t.canisterId);
    if (!s || s.groupId !== t.groupId || s.name !== t.name || s.subnetId !== t.subnetId || s.newHash !== t.newHash ||
        !/^[a-f0-9]{64}$/.test(s.oldHash) || !/^[a-f0-9]{64}$/.test(s.settingsHash) || !['ready', 'pending', 'complete'].includes(s.phase)) throw new Error('Invalid lookup release step');
  }
  if (journal.complete && journal.steps.some(s => s.phase !== 'complete')) throw new Error('Unsettled completed journal');
  if (journal.fill && (typeof journal.fill !== 'object' || ['g1', 'g2'].some(g => typeof journal.fill[g] !== 'boolean'))) throw new Error('Invalid fill record');
  // Even a fully acknowledged historical fill is not global currentness.
  if (journal.ready === true) throw new Error('Historical membership fill cannot certify lookup readiness');
}

/** Uses the real source-specific Progress contract. Completion records an
 * acknowledged historical revision only, never global freshness/readiness.
 * Source requests are durable and replay-checked, so unknown network replies
 * may retry this bounded driver; definite refusals stop the run. */
export async function runFill(groups, call, { maxCalls = 100000, retries = 5, persist = async () => {} } = {}) {
  if (!Array.isArray(groups) || new Set(groups).size !== groups.length || groups.some(g => !['g1', 'g2'].includes(g)) ||
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
