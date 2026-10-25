import { createHash } from 'node:crypto';
import { reconcileUpgradeStep } from './group2-upgrade-rules.mjs';

export const TEAM_INVITE_SERVICES = Object.freeze(['club_domain', 'mini_league_domain']);
export const digest = value => createHash('sha256').update(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v)).digest('hex');
export function validateRequest(action, confirmation) {
  if (!['check', 'upgrade'].includes(action)) throw new Error('Choose check or upgrade');
  if (action === 'upgrade' && confirmation?.trim() !== 'UPGRADE BOTH GROUPS TEAM INVITES') throw new Error('Type UPGRADE BOTH GROUPS TEAM INVITES');
}
export function validateTargets(targets) {
  if (targets.length !== 4 || new Set(targets.map(t => t.canisterId)).size !== 4 ||
      ['g1', 'g2'].some(groupId => TEAM_INVITE_SERVICES.some(name => targets.filter(t => t.groupId === groupId && t.name === name).length !== 1)) ||
      targets.some(t => !t.canisterId || !t.subnetId || !/^[a-f0-9]{64}$/.test(t.newHash))) throw new Error('Exact four existing club/mini-league targets required');
}
export function validateRegisteredPair(groupId, targets, groups, placements) {
  const group = groups.find(g => g.id === groupId);
  // Original Group 1 predates router registration; its pinned mapping is mandatory.
  if (!group && groupId === 'g1') return;
  const placement = placements.find(p => p.group_id === groupId);
  const club = targets.find(t => t.groupId === groupId && t.name === 'club_domain');
  const league = targets.find(t => t.groupId === groupId && t.name === 'mini_league_domain');
  if (!group || !placement || !club || !league || placement.deployment_id !== 'mainnet' || placement.host !== 'https://icp-api.io' || placement.network_kind !== 'public_mainnet' || group.target_alias !== 'mainnet') throw new Error(`Registered ${groupId} invite pair differs`);
  for (const target of [club, league]) {
    if (group.domains.find(d => d.domain === target.name)?.canister.toText() !== target.canisterId || placement.domains.find(d => d.domain === target.name)?.canister.toText() !== target.canisterId || placement.domains.find(d => d.domain === target.name)?.subnet.toText() !== target.subnetId) throw new Error(`Registered ${groupId} invite authority differs`);
  }
}
export function validateJournal(journal, binding) {
  validateTargets(binding.targets);
  if (digest(journal.binding) !== digest(binding) || typeof journal.complete !== 'boolean' || journal.steps?.length !== 4 ||
      new Set(journal.steps.map(s => s.canisterId)).size !== 4 || journal.keys?.length !== 2) throw new Error('Foreign or incomplete team-invite upgrade journal');
  for (const target of binding.targets) {
    const step = journal.steps.find(s => s.canisterId === target.canisterId);
    if (!step || step.name !== target.name || step.groupId !== target.groupId || step.subnetId !== target.subnetId || step.newHash !== target.newHash ||
        !/^[a-f0-9]{64}$/.test(step.oldHash) || !/^[a-f0-9]{64}$/.test(step.settingsHash) || !['ready','pending','complete'].includes(step.phase)) throw new Error('Invalid team-invite upgrade step');
  }
  for (const groupId of ['g1', 'g2']) {
    const key = journal.keys.find(k => k.groupId === groupId);
    if (!key || key.receipt?.governor !== binding.governor || key.receipt?.canisterId !== binding.pii[groupId] ||
        key.receipt?.host !== 'https://icp-api.io' || key.receipt?.deploymentId !== 'mainnet' || key.receipt?.environment !== 'ic' ||
        key.receipt?.keyName !== 'key_1' || !/^[a-f0-9]{192}$/.test(key.receipt?.publicKeyHex ?? '') || !/^[a-f0-9]{64}$/.test(key.receipt?.moduleHash ?? '')) throw new Error('Invalid original photo-key receipt');
  }
  if (journal.complete && journal.steps.some(s => s.phase !== 'complete')) throw new Error('Unsettled completed journal');
}
/** The real runner and tests share this loop. Pending outcomes never reinstall. */
export async function executeUpgrades(journal, transport) {
  for (const step of journal.steps) {
    await transport.gate();
    const before = await transport.observe(step);
    if (before.settingsHash !== step.settingsHash) throw new Error('Settings changed before upgrade');
    Object.assign(step, reconcileUpgradeStep(step, before.moduleHash));
    if (step.phase !== 'complete' && step.oldHash !== step.newHash) {
      step.phase = 'pending'; await transport.persist(journal);
      await transport.install(step);
    }
    const after = await transport.observe(step);
    if (after.moduleHash !== step.newHash || after.settingsHash !== step.settingsHash) throw new Error('Module/settings readback failed; pending intent retained');
    step.phase = 'complete'; await transport.persist(journal);
  }
  await transport.gate();
  await transport.verifyKeys();
  // Re-read all four after the final await, including already-completed steps.
  for (const step of journal.steps) {
    const actual = await transport.observe(step);
    if (actual.moduleHash !== step.newHash || actual.settingsHash !== step.settingsHash) throw new Error('Final module/settings drift');
  }
  await transport.gate();
  journal.complete = true; await transport.persist(journal);
}