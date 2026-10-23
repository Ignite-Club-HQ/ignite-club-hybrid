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
