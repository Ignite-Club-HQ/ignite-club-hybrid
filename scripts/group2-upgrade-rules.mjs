import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { GROUP_BUILD_SERVICES } from './stage-group-wasm.mjs';

export const GROUP2_GOVERNOR = 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae';
export const GROUP2_FUEL_FLOOR = 1_000_000_000_000n;
export function validateGroup2Inventory(provision, shared) {
  if (provision.groupId !== 'g2' || provision.deploymentId !== 'mainnet' || provision.phase !== 'checked' || provision.pending ||
      !provision.dedicatedBlobStore?.installed || provision.dedicatedBlobStore.subnetId !== provision.subnetId ||
      provision.configuration?.completed?.length < 1) throw new Error('Complete checked g2 provision required');
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
  if (governor !== GROUP2_GOVERNOR || actual.controllers.length !== 1 || actual.controllers[0] !== governor ||
      !actual.running || actual.subnetId !== service.subnetId || !/^[a-f0-9]{64}$/.test(actual.moduleHash ?? '') ||
      actual.cycles < GROUP2_FUEL_FLOOR || (expectedHash && actual.moduleHash !== expectedHash))
    throw new Error(`Module/controller/subnet/running/fuel check failed: ${service.name}`);
  if (actual.environment.some(e => e.name.endsWith('LOCAL_REHEARSAL') && e.value !== '' && e.value !== '0'))
    throw new Error(`Rehearsal settings forbidden: ${service.name}`);
}
export function upgradeArgs(service, path, governor) {
  return ['canister', 'install', service.canisterId, '-n', 'ic', '--mode', 'upgrade', '--wasm', path,
    ...(service.name === 'timer_jobs' ? [] : ['--wasm-memory-persistence', 'keep', '--args', `(principal "${governor}")`]), '-y'];
}
/** Lost replies can only settle from exact module readback; never repeat an uncertain upgrade. */
export function reconcileUpgradeStep(step, moduleHash) {
  if (step.phase === 'pending') {
    if (moduleHash !== step.newHash) throw new Error('Unknown upgrade outcome: reconcile manually; no automatic replay');
    return { ...step, phase: 'complete' };
  }
  if (step.phase === 'complete' && moduleHash !== step.newHash) throw new Error('Completed module changed');
  if (step.phase === 'ready' && moduleHash !== step.oldHash) throw new Error('Original module changed');
  return step;
}