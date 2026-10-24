import { digest, executeUpgrades } from './subscription-upgrade-policy.mjs';
export { digest, executeUpgrades };
export const COMPETITION_SERVICES = Object.freeze(['notification_queue', 'club_domain', 'events_domain', 'competition_domain']);
export function validateRequest(action, confirmation) {
  if (!['check', 'upgrade'].includes(action)) throw Error('Choose check or upgrade');
  if (action === 'upgrade' && confirmation?.trim() !== 'UPGRADE BOTH GROUPS COMPETITION') throw Error('Type UPGRADE BOTH GROUPS COMPETITION');
}
export function validateTargets(targets) {
  if (targets.length !== 8 || new Set(targets.map(t => t.canisterId)).size !== 8 ||
    ['g1','g2'].some(g => COMPETITION_SERVICES.some(n => targets.filter(t => t.groupId === g && t.name === n).length !== 1)) ||
    targets.some(t => !t.canisterId || !t.subnetId || !/^[a-f0-9]{64}$/.test(t.newHash))) throw Error('Exactly eight existing competition services required');
}
export function validateRegistration(groupId, targets, groups, placements) {
  const group = groups.find(g => g.id === groupId);
  if (!group && groupId === 'g1') return; // Runner pins original G1 mapping and certified subnet.
  const placement = placements.find(p => p.group_id === groupId);
  if (!group || !placement || group.target_alias !== 'mainnet' || placement.deployment_id !== 'mainnet' || placement.host !== 'https://icp-api.io' || placement.network_kind !== 'public_mainnet' ||
    targets.filter(t => t.groupId === groupId).some(t =>
      group.domains.filter(d => d.domain === t.name && d.canister.toText() === t.canisterId).length !== 1 ||
      placement.domains.filter(d => d.domain === t.name && d.canister.toText() === t.canisterId && d.subnet.toText() === t.subnetId).length !== 1)) throw Error('Registered competition inventory differs');
}
export function validateJournal(journal, binding) {
  validateTargets(binding.targets);
  if (digest(journal.binding) !== digest(binding) || typeof journal.complete !== 'boolean' || journal.steps?.length !== 8 || new Set(journal.steps.map(s => s.canisterId)).size !== 8 || journal.keys?.length !== 2 || !binding.wiring) throw Error('Foreign or incomplete competition journal');
  for (const t of binding.targets) {
    const s = journal.steps.find(s => s.canisterId === t.canisterId);
    if (!s || s.name !== t.name || s.groupId !== t.groupId || s.subnetId !== t.subnetId || s.newHash !== t.newHash || !/^[a-f0-9]{64}$/.test(s.oldHash) || !/^[a-f0-9]{64}$/.test(s.settingsHash) || !['ready','pending','complete'].includes(s.phase) || !/^[a-f0-9]{64}$/.test(binding.wiring[t.canisterId] ?? '')) throw Error('Invalid competition step/wiring');
  }
  for (const g of ['g1','g2']) {
    const k = journal.keys.find(k => k.groupId === g)?.receipt;
    if (!k || k.governor !== binding.governor || k.canisterId !== binding.pii[g] || k.host !== 'https://icp-api.io' || k.deploymentId !== 'mainnet' || k.environment !== 'ic' || k.keyName !== 'key_1' || !/^[a-f0-9]{192}$/.test(k.publicKeyHex ?? '') || !/^[a-f0-9]{64}$/.test(k.moduleHash ?? '')) throw Error('Original photo-key evidence missing');
  }
  if (journal.complete && journal.steps.some(s => s.phase !== 'complete')) throw Error('Unsettled completed journal');
}