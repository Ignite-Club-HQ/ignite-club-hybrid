import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { validateGroup2Inventory, validateUpgradeJournal, wasmHash, verifyUpgradeStatus, upgradeArgs, reconcileUpgradeStep, GROUP2_GOVERNOR } from './group2-upgrade-rules.mjs';
const provision = JSON.parse(readFileSync(new URL('../deploy/groups/g2/provision.json', import.meta.url)));
const inventory = () => validateGroup2Inventory(structuredClone(provision), {});
test('upgrade inventory contains exactly thirteen existing g2 services', () => {
  assert.equal(inventory().length, 13);
  assert.equal(inventory().find(s => s.name === 'media_blob_store').canisterId, provision.dedicatedBlobStore.canisterId);
});
test('Group 1 targets cannot be upgraded by this runner', () => {
  assert.throws(() => validateGroup2Inventory(provision, { club_domain: provision.canisters.club_domain }), /g2-only/);
});
test('incomplete installations and wrong subnets are refused', () => {
  const p = structuredClone(provision); p.observedSubnets.club_domain = 'other';
  assert.throws(() => validateGroup2Inventory(p, {}), /subnet/);
  p.phase = 'installed'; assert.throws(() => validateGroup2Inventory(p, {}), /checked/);
});
const service = inventory()[0];
const status = () => ({ controllers: [GROUP2_GOVERNOR], running: true, subnetId: service.subnetId,
  moduleHash: 'a'.repeat(64), cycles: 1_000_000_000_000n, environment: [] });
test('fuel floor is exactly 1T and low fuel stops upgrades', () => {
  verifyUpgradeStatus(service, status(), GROUP2_GOVERNOR);
  assert.throws(() => verifyUpgradeStatus(service, { ...status(), cycles: 999_999_999_999n }, GROUP2_GOVERNOR), /fuel/);
});
test('sole original deploy identity is required', () => {
  assert.throws(() => verifyUpgradeStatus(service, { ...status(), controllers: [GROUP2_GOVERNOR, 'other'] }, GROUP2_GOVERNOR), /controller/);
  assert.throws(() => verifyUpgradeStatus(service, status(), 'other'), /controller/);
});
test('local rehearsal flags cannot pass production preflight; the account admission release switch is allowed', () => {
  verifyUpgradeStatus(service, { ...status(), environment: [{ name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' }] }, GROUP2_GOVERNOR);
  assert.throws(() => verifyUpgradeStatus(service, { ...status(), environment: [{ name: 'IGNITE_MEDIA_LOCAL_REHEARSAL', value: '1' }] }, GROUP2_GOVERNOR), /Rehearsal/);
});
test('Motoko upgrade preserves memory and Rust upgrade omits EOP-only arguments', () => {
  const args = upgradeArgs(service, '/tmp/club.wasm', GROUP2_GOVERNOR);
  assert.equal(args[args.indexOf('--mode') + 1], 'upgrade');
  assert.equal(args[args.indexOf('--wasm-memory-persistence') + 1], 'keep');
  assert.ok(args.includes(service.canisterId));
  assert.equal(upgradeArgs({ ...service, name: 'timer_jobs' }, 'x', GROUP2_GOVERNOR).includes('--wasm-memory-persistence'), false);
  const store = upgradeArgs({ ...service, name: 'media_blob_store' }, 'x', GROUP2_GOVERNOR);
  assert.equal(store.includes('--args'), false);
  assert.equal(store[store.indexOf('--wasm-memory-persistence') + 1], 'keep');
});
test('compressed artifacts hash the actual installed module', () => {
  const bytes = Buffer.from([0,97,115,109,1,0,0,0]); assert.equal(wasmHash(bytes), wasmHash(gzipSync(bytes)));
  assert.throws(() => wasmHash(Buffer.from('invalid')), /Wasm/);
});
test('unknown callback cannot replay an upgrade with the old module', () => {
  const step = { phase: 'pending', oldHash: 'a', newHash: 'b' };
  assert.throws(() => reconcileUpgradeStep(step, 'a'), /no automatic replay/);
  assert.equal(reconcileUpgradeStep(step, 'b').phase, 'complete');
});
test('completed or ready steps refuse changed module readback', () => {
  assert.throws(() => reconcileUpgradeStep({ phase: 'complete', newHash: 'b' }, 'c'), /changed/);
  assert.throws(() => reconcileUpgradeStep({ phase: 'ready', oldHash: 'a' }, 'b'), /changed/);
});
test('resume requires exactly thirteen valid steps and the original bound photo key', () => {
  const binding = { governor: GROUP2_GOVERNOR, inventory: inventory().map(s => ({ ...s, newHash: 'b'.repeat(64) })) };
  const journal = { binding, routerRevision: '0', complete: false, steps: binding.inventory.map(s => ({ ...s, oldHash: 'a'.repeat(64), settingsHash: 'c'.repeat(64), phase: 'ready' })),
    keyReceipt: { governor: GROUP2_GOVERNOR, deploymentId: 'mainnet', environment: 'ic', host: 'https://icp-api.io', keyName: 'key_1',
      canisterId: provision.canisters.pii_access_control, publicKeyHex: 'd'.repeat(192), moduleHash: 'a'.repeat(64) } };
  validateUpgradeJournal(journal, binding);
  const invalid = structuredClone(journal); invalid.steps[0].phase = 'retry';
  assert.throws(() => validateUpgradeJournal(invalid, binding), /step/);
  invalid.steps = journal.steps.slice(1); assert.throws(() => validateUpgradeJournal(invalid, binding), /journal/);
  invalid.steps = journal.steps; invalid.keyReceipt.canisterId = 'other'; assert.throws(() => validateUpgradeJournal(invalid, binding), /photo-key/);
});