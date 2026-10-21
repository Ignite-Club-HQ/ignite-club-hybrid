import { createHash } from 'node:crypto';
export const IDENTITY = 'mq2sj-fiaaa-aaaal-qxlqa-cai';
export const ROUTER = 'jcdfe-vqaaa-aaaal-qxloq-cai';
export const GOVERNOR = 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae';
export function validateRequest(action, confirmation) {
  if (!['check', 'repair', 'disable'].includes(action)) throw new Error('Invalid account-access action');
  const phrase = action === 'repair' ? 'REPAIR GROUP 2 ACCOUNT ACCESS' : 'DISABLE GROUP 2 ACCOUNT ACCESS';
  if (action !== 'check' && confirmation?.trim() !== phrase) throw new Error(`Type ${phrase}`);
}
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function verifyIdentityStatus(status, expectedHash) {
  if (status.controllers.length !== 1 || status.controllers[0] !== GOVERNOR || !status.running ||
      !/^[a-f0-9]{64}$/.test(status.moduleHash ?? '') || status.cycles < 1_000_000_000_000n ||
      (expectedHash && status.moduleHash !== expectedHash)) throw new Error('Identity module/controller/running/fuel check failed');
  if (status.environment.some(e => e.name.endsWith('LOCAL_REHEARSAL') && e.value !== '' && e.value !== '0')) {
    throw new Error('Identity rehearsal flags are forbidden');
  }
}
export function reconcileIdentityUpgrade(step, actual) {
  if (actual.settingsHash !== step.settingsHash || actual.subnetId !== step.subnetId) throw new Error('Identity settings/subnet changed');
  if (step.phase === 'pending' && actual.moduleHash !== step.newHash) throw new Error('Unknown identity upgrade outcome; no automatic replay');
  if (step.phase === 'complete' && actual.moduleHash !== step.newHash) throw new Error('Completed identity module changed');
  if (step.phase === 'ready' && actual.moduleHash !== step.oldHash) throw new Error('Original identity module changed');
  if (!['ready','pending','complete'].includes(step.phase)) throw new Error('Invalid identity upgrade phase');
  return {...step, phase: step.phase === 'pending' || step.oldHash === step.newHash ? 'complete' : step.phase};
}