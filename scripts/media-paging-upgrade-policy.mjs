import { digest, executeUpgrades } from './subscription-upgrade-policy.mjs';
export { digest, executeUpgrades };
export const CONFIRMATION = 'UPGRADE BOTH GROUPS PHOTOS';
export const PINNED = { g1: 'mc4fq-jyaaa-aaaal-qxlta-cai', g2: 'z26lc-oaaaa-aaaal-qxp4a-cai' };
export function validateRequest(action, confirmation) {
  if (!['check', 'upgrade'].includes(action)) throw new Error('Choose check or upgrade');
  if (action === 'upgrade' && confirmation?.trim() !== CONFIRMATION) throw new Error(`Type ${CONFIRMATION}`);
}
export function validateTargets(targets) {
  if (targets.length !== 2 || new Set(targets.map(t => t.canisterId)).size !== 2 ||
      ['g1', 'g2'].some(group => targets.filter(t => t.groupId === group && t.canisterId === PINNED[group] && t.name === 'media_metadata').length !== 1) ||
      targets.some(t => !t.subnetId || !/^[a-f0-9]{64}$/.test(t.newHash))) throw new Error('Exact two existing media_metadata targets required');
}
export function validateJournal(journal, binding) {
  validateTargets(binding.targets);
  if (digest(journal.binding) !== digest(binding) || typeof journal.complete !== 'boolean' || journal.steps?.length !== 2 ||
      new Set(journal.steps.map(s => s.canisterId)).size !== 2 || journal.keys?.length !== 2) throw new Error('Foreign or incomplete photo upgrade journal');
  for (const t of binding.targets) {
    const s = journal.steps.find(s => s.canisterId === t.canisterId);
    if (!s || s.groupId !== t.groupId || s.name !== t.name || s.subnetId !== t.subnetId || s.newHash !== t.newHash ||
        !/^[a-f0-9]{64}$/.test(s.oldHash) || !/^[a-f0-9]{64}$/.test(s.settingsHash) || !['ready', 'pending', 'complete'].includes(s.phase)) throw new Error('Invalid photo upgrade step');
  }
  for (const g of ['g1', 'g2']) {
    const r = journal.keys.find(k => k.groupId === g)?.receipt;
    if (!r || r.governor !== binding.governor || r.canisterId !== binding.pii[g] || r.host !== 'https://icp-api.io' ||
        r.deploymentId !== 'mainnet' || r.environment !== 'ic' || r.keyName !== 'key_1' || !/^[a-f0-9]{192}$/.test(r.publicKeyHex ?? '') ||
        !/^[a-f0-9]{64}$/.test(r.moduleHash ?? '')) throw new Error('Invalid original photo-key evidence');
  }
  if (journal.complete && journal.steps.some(s => s.phase !== 'complete')) throw new Error('Unsettled completed journal');
  if (journal.backfill && (typeof journal.backfill !== 'object' || ['g1', 'g2'].some(g => typeof journal.backfill[g] !== 'boolean'))) throw new Error('Invalid backfill record');
}
/** Bounded, idempotent backfill: each call resumes from the canister's durable position. */
export async function runBackfill(groups, call, { maxCalls = 100000, retries = 5, persist = async () => {} } = {}) {
  const done = {};
  for (const groupId of groups) {
    let calls = 0, failures = 0;
    for (;;) {
      if (++calls > maxCalls) throw new Error(`Backfill did not finish for ${groupId}`);
      let reply;
      try { reply = await call(groupId); failures = 0; }
      catch (e) { if (++failures > retries) throw e; continue; }
      if ('Err' in reply) throw new Error(`Backfill refused for ${groupId}: ${reply.Err}`);
      if (reply.Ok.complete) break;
    }
    done[groupId] = true; await persist(groupId);
  }
  return done;
}
