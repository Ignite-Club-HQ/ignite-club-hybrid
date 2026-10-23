import { digest, executeUpgrades } from './subscription-upgrade-policy.mjs';
export { digest, executeUpgrades };
export const HISTORY_SERVICES = Object.freeze(['competition_domain', 'events_domain']);
export function validateRequest(action, confirmation) {
  if (!['check', 'upgrade'].includes(action)) throw new Error('Choose check or upgrade');
  if (action === 'upgrade' && confirmation?.trim() !== 'UPGRADE GROUP 2 COMPETITION EVENTS') throw new Error('Type UPGRADE GROUP 2 COMPETITION EVENTS');
}
export function validateTargets(targets) {
  if (targets.length !== 2 || new Set(targets.map(t => t.canisterId)).size !== 2 ||
      HISTORY_SERVICES.some(name => targets.filter(t => t.groupId === 'g2' && t.name === name).length !== 1) ||
      targets.some(t => !t.canisterId || !t.subnetId || !/^[a-f0-9]{64}$/.test(t.newHash))) throw new Error('Exactly two Group 2 competition/events targets required');
}
export function validateRegistration(targets, groups, placements) {
  validateTargets(targets);
  const group = groups.find(g => g.id === 'g2'), placement = placements.find(p => p.group_id === 'g2');
  if (!group || !placement || group.target_alias !== 'mainnet' || placement.deployment_id !== 'mainnet' ||
      placement.host !== 'https://icp-api.io' || placement.network_kind !== 'public_mainnet' ||
      targets.some(t => group.domains.filter(d => d.domain === t.name && d.canister.toText() === t.canisterId).length !== 1 ||
        placement.domains.filter(d => d.domain === t.name && d.canister.toText() === t.canisterId && d.subnet.toText() === t.subnetId).length !== 1)) throw new Error('Registered Group 2 competition/events targets differ');
}
export function validateJournal(journal, binding) {
  validateTargets(binding.targets);
  if (digest(journal.binding) !== digest(binding) || typeof journal.complete !== 'boolean' || journal.steps?.length !== 2 ||
      new Set(journal.steps.map(s => s.canisterId)).size !== 2 || journal.keys?.length !== 1) throw new Error('Foreign or incomplete history release journal');
  for (const t of binding.targets) {
    const s = journal.steps.find(s => s.canisterId === t.canisterId);
    if (!s || s.groupId !== t.groupId || s.name !== t.name || s.subnetId !== t.subnetId || s.newHash !== t.newHash ||
        !/^[a-f0-9]{64}$/.test(s.oldHash) || !/^[a-f0-9]{64}$/.test(s.settingsHash) || !['ready', 'pending', 'complete'].includes(s.phase)) throw new Error('Invalid history release step');
  }
  const key = journal.keys[0];
  if (key.groupId !== 'g2' || key.receipt?.governor !== binding.governor || key.receipt?.canisterId !== binding.pii.g2 ||
      key.receipt?.host !== 'https://icp-api.io' || key.receipt?.deploymentId !== 'mainnet' || key.receipt?.environment !== 'ic' ||
      key.receipt?.keyName !== 'key_1' || !/^[a-f0-9]{192}$/.test(key.receipt?.publicKeyHex ?? '') ||
      !/^[a-f0-9]{64}$/.test(key.receipt?.moduleHash ?? '')) throw new Error('Invalid original Group 2 photo key');
  if (journal.complete && journal.steps.some(s => s.phase !== 'complete')) throw new Error('Unsettled completed release');
}