import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { GROUP_BUILD_SERVICES } from './stage-group-wasm.mjs';

export const GROUP2_GOVERNOR = 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae';
export const GROUP2_FUEL_FLOOR = 1_000_000_000_000n;
/** Historical name, production meaning: this env releases cross-group account
 * admission/removal checks on every group service, so it alone may stay set
 * through upgrades. Any other LOCAL_REHEARSAL flag remains forbidden. */
export const ADMISSION_RELEASE_FLAG = 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL';
export function validateGroup2Inventory(provision, shared) {
  if (provision.groupId !== 'g2' || provision.deploymentId !== 'mainnet' || provision.phase !== 'checked' || provision.pending ||
      !provision.dedicatedBlobStore?.installed || provision.dedicatedBlobStore.subnetId !== provision.subnetId ||
      !provision.configuration?.completed?.length) throw new Error('Complete checked g2 provision required');
  const domains = GROUP_BUILD_SERVICES.filter(n => n !== 'media_blob_store');
  if (Object.keys(provision.canisters).length !== 12 || provision.installedDomains.length !== 12 ||
      domains.some(n => !provision.installedDomains.includes(n))) throw new Error('Exact twelve installed domains required');
  const services = GROUP_BUILD_SERVICES.map(name => ({ name,
    canisterId: name === 'media_blob_store' ? provision.dedicatedBlobStore.canisterId : provision.canisters[name],
    subnetId: name === 'media_blob_store' ? provision.dedicatedBlobStore.subnetId : provision.observedSubnets[name] }));
  const sharedIds = Object.values(shared).flatMap(x => typeof x === 'string' ? [x] : Object.values(x ?? {}));
  if (new Set(services.map(s => s.canisterId)).size !== 13 || services.some(s =>
    typeof s.canisterId !== 'string' || !s.canisterId || s.subnetId !== provision.subnetId || sharedIds.includes(s.canisterId)))
    throw new Error('Unique g2-only canisters on the approved subnet required');
  return services;
}
export function wasmHash(bytes) {
  const decoded = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  if (!decoded.subarray(0, 8).equals(Buffer.from([0,97,115,109,1,0,0,0]))) throw new Error('Invalid Wasm');
  return createHash('sha256').update(decoded).digest('hex');
}
export function verifyUpgradeStatus(service, actual, governor, expectedHash) {
  const fail = reason => { throw new Error(`Module/controller/subnet/running/fuel check failed: ${service.name} — ${reason}`); };
  if (governor !== GROUP2_GOVERNOR || actual.controllers.length !== 1 || actual.controllers[0] !== governor)
    fail(`controller is not the sole governor (found: ${actual.controllers.join(', ') || 'none'})`);
  if (!actual.running) fail('canister is not running');
  if (actual.subnetId !== service.subnetId) fail(`subnet mismatch (expected ${service.subnetId}, found ${actual.subnetId})`);
  if (!/^[a-f0-9]{64}$/.test(actual.moduleHash ?? '')) fail('module hash missing or invalid');
  if (actual.cycles < GROUP2_FUEL_FLOOR)
    fail(`fuel under the 1T floor: ${(Number(actual.cycles) / 1e12).toFixed(3)}T — run the g2 card top-up, then retry`);
  if (expectedHash && actual.moduleHash !== expectedHash) fail('module hash differs from the staged artifact');
  if (actual.environment.some(e => e.name.endsWith('LOCAL_REHEARSAL') && e.name !== ADMISSION_RELEASE_FLAG && e.value !== '' && e.value !== '0'))
    throw new Error(`Rehearsal settings forbidden: ${service.name}`);
}
export function upgradeArgs(service, path, governor) {
  return ['canister', 'install', service.canisterId, '-n', 'ic', '--mode', 'upgrade', '--wasm', path,
    ...(service.name === 'timer_jobs' ? [] : ['--wasm-memory-persistence', 'keep']),
    ...(['timer_jobs', 'media_blob_store'].includes(service.name) ? [] : ['--args', `(principal "${governor}")`]), '-y'];
}
/** Lost replies can only settle from exact module readback; never repeat an uncertain upgrade. */
export function reconcileUpgradeStep(step, moduleHash) {
  if (!['ready', 'pending', 'complete'].includes(step.phase)) throw new Error('Invalid upgrade phase');
  if (step.phase === 'pending') {
    if (moduleHash !== step.newHash) throw new Error('Unknown upgrade outcome: reconcile manually; no automatic replay');
    return { ...step, phase: 'complete' };
  }
  if (step.phase === 'complete' && moduleHash !== step.newHash) throw new Error('Completed module changed');
  if (step.phase === 'ready' && moduleHash !== step.oldHash) throw new Error('Original module changed');
  return step;
}
export function validateUpgradeJournal(journal, binding) {
  if (!journal || JSON.stringify(journal.binding) !== JSON.stringify(binding) || !/^\d+$/.test(journal.routerRevision) ||
      !Array.isArray(journal.steps) || journal.steps.length !== 13 || new Set(journal.steps.map(s => s.name)).size !== 13 ||
      typeof journal.complete !== 'boolean') throw new Error('Invalid or foreign upgrade journal');
  for (const planned of binding.inventory) {
    const step = journal.steps.find(s => s.name === planned.name);
    if (!step || step.canisterId !== planned.canisterId || step.subnetId !== planned.subnetId || step.newHash !== planned.newHash ||
        !/^[a-f0-9]{64}$/.test(step.oldHash ?? '') || !/^[a-f0-9]{64}$/.test(step.settingsHash ?? '') ||
        !['ready', 'pending', 'complete'].includes(step.phase)) throw new Error('Invalid upgrade journal step');
  }
  const receipt = journal.keyReceipt;
  if (!receipt || receipt.governor !== binding.governor || receipt.deploymentId !== 'mainnet' || receipt.environment !== 'ic' ||
      receipt.host !== 'https://icp-api.io' || receipt.keyName !== 'key_1' ||
      receipt.canisterId !== binding.inventory.find(s => s.name === 'pii_access_control')?.canisterId ||
      !/^[a-f0-9]{192}$/.test(receipt.publicKeyHex ?? '') || !/^[a-f0-9]{64}$/.test(receipt.moduleHash ?? ''))
    throw new Error('Invalid original photo-key receipt');
}