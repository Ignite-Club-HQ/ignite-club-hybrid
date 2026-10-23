// Protected release policy for the permanent membership lookup.
// Exact three targets: the shared identity_access coordinator and the
// existing club_domain membership source in each group. Nothing else may be
// upgraded, created, rewired or opened by this release. Verification records
// readiness only; the app-side lookup stays disabled until a separate
// explicit enable step.
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
  // Readiness is never recorded while upgrades or the membership fill are unfinished.
  if (journal.ready === true && (!journal.complete || !journal.fill?.g1 || !journal.fill?.g2)) throw new Error('Readiness requires completed upgrades and fill');
}

/** Bounded, idempotent membership fill: each call resumes from the source's
 * durable position; refusals stop the run, transient failures retry. */
export async function runFill(groups, call, { maxCalls = 100000, retries = 5, persist = async () => {} } = {}) {
  const done = {};
  for (const groupId of groups) {
    let calls = 0, failures = 0;
    for (;;) {
      if (++calls > maxCalls) throw new Error(`Membership fill did not finish for ${groupId}`);
      let reply;
      try { reply = await call(groupId); failures = 0; }
      catch (e) { if (++failures > retries) throw e; continue; }
      if ('Err' in reply) throw new Error(`Membership fill refused for ${groupId}: ${reply.Err}`);
      if (reply.Ok.complete) break;
    }
    done[groupId] = true; await persist(groupId);
  }
  return done;
}
