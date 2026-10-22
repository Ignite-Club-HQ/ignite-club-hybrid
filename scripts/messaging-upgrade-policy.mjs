import { digest, executeUpgrades } from './subscription-upgrade-policy.mjs';
export { digest, executeUpgrades };
export function validateRequest(action, confirmation) {
  if (!['check', 'upgrade'].includes(action)) throw new Error('Choose check or upgrade');
  if (action === 'upgrade' && confirmation?.trim() !== 'UPGRADE BOTH GROUPS CHATS') throw new Error('Type UPGRADE BOTH GROUPS CHATS');
}
export function validateTargets(targets) {
  const pinned = { g1: 'mx3u5-iqaaa-aaaal-qxlqq-cai', g2: 'yluv5-wiaaa-aaaal-qxpzq-cai' };
  if (targets.length !== 2 || new Set(targets.map(t => t.canisterId)).size !== 2 ||
      ['g1', 'g2'].some(group => targets.filter(t => t.groupId === group && t.canisterId === pinned[group] && t.name === 'messaging_domain').length !== 1) ||
      targets.some(t => !t.subnetId || !/^[a-f0-9]{64}$/.test(t.newHash))) throw new Error('Exact two existing messaging targets required');
}
export function validateJournal(journal, binding) {
  validateTargets(binding.targets);
  if (digest(journal.binding) !== digest(binding) || typeof journal.complete !== 'boolean' || journal.steps?.length !== 2 ||
      new Set(journal.steps.map(s => s.canisterId)).size !== 2 || journal.keys?.length !== 2) throw new Error('Foreign or incomplete chat upgrade journal');
  for (const t of binding.targets) {
    const s = journal.steps.find(s => s.canisterId === t.canisterId);
    if (!s || s.groupId !== t.groupId || s.name !== t.name || s.subnetId !== t.subnetId || s.newHash !== t.newHash ||
        !/^[a-f0-9]{64}$/.test(s.oldHash) || !/^[a-f0-9]{64}$/.test(s.settingsHash) || !['ready', 'pending', 'complete'].includes(s.phase)) throw new Error('Invalid chat upgrade step');
  }
  for (const g of ['g1', 'g2']) {
    const r = journal.keys.find(k => k.groupId === g)?.receipt;
    if (!r || r.governor !== binding.governor || r.canisterId !== binding.pii[g] || r.host !== 'https://icp-api.io' ||
        r.deploymentId !== 'mainnet' || r.environment !== 'ic' || r.keyName !== 'key_1' || !/^[a-f0-9]{192}$/.test(r.publicKeyHex ?? '') ||
        !/^[a-f0-9]{64}$/.test(r.moduleHash ?? '')) throw new Error('Invalid original photo-key evidence');
  }
  if (journal.complete && journal.steps.some(s => s.phase !== 'complete')) throw new Error('Unsettled completed journal');
}