import test from 'node:test';
import assert from 'node:assert/strict';
import { requireCompleteFill, requireHistoricalCheckpoint, checkHistoricalAcceptance } from './membership-acceptance-checks.mjs';
const p = text => ({ toText: () => text });
const sources = ['g1', 'g2'].map(groupId => ({ groupId, authority: p(`${groupId}-club`) }));
const completed = { g1: 7n, g2: 9n }, inventoryDigest = new Uint8Array(32).fill(3);
const ownership = { complete: true, verified_current: false, inventory_digest: inventoryDigest, source_revisions: [['g1', 7n], ['g2', 9n]] };
const binding = { registry: p('router'), registry_revision: 5n }, generation = 1n;
const targets = [{ newHash: 'a'.repeat(64), settingsHash: 'b'.repeat(64) }];
const expected = { sources, completed, ownership, inventoryDigest, binding, generation, targets };
function transport() {
  const calls = [];
  return { calls, gate: async () => {},
    configuration: async () => ({ Ok: { binding, generation, sources: sources.map(s => [s.groupId, s.authority]), inventory_digest: inventoryDigest, enabled: true, app_enabled: false } }),
    status: async s => { calls.push(s.groupId); return { Ok: { revision: completed[s.groupId], acknowledged: completed[s.groupId], pending: false } }; },
    observe: async t => ({ moduleHash: t.newHash, settingsHash: t.settingsHash }),
  };
}
test('complete fill requires both exact positive bounded revisions, never partial or extra sources', () => {
  assert.deepEqual(requireCompleteFill(sources, completed), [['g1', 7n], ['g2', 9n]]);
  for (const bad of [{}, { g1: 7n }, { ...completed, g3: 1n }, { ...completed, g2: 0n }, { ...completed, g2: 18446744073709551616n }, { ...completed, g2: '9' }]) assert.throws(() => requireCompleteFill(sources, bad));
  assert.throws(() => requireCompleteFill([sources[0], sources[0]], completed));
});
test('unchanged complete readbacks check every source twice but cannot authorize release', async () => {
  const t = transport(); const result = await checkHistoricalAcceptance(expected, t);
  assert.deepEqual(t.calls, ['g1', 'g2', 'g1', 'g2']);
  assert.equal(result.sampledCurrent, true); assert.equal(result.verified_current, false);
  assert.equal(result.ready, false); assert.equal(result.appEnabled, false); assert.equal(result.blockers.length, 3);
});
test('pending mutations, restored-old source, lost acknowledgement and unavailable source reject', async () => {
  for (const status of [{ revision: 10n, acknowledged: 9n, pending: true }, { revision: 8n, acknowledged: 8n, pending: false }, { revision: 9n, acknowledged: 8n, pending: false }]) {
    const t = transport(), read = t.status; t.status = async s => s.groupId === 'g2' ? { Ok: status } : read(s);
    await assert.rejects(() => checkHistoricalAcceptance(expected, t), /pending, restored-old or changed/);
  }
  const t = transport(); t.status = async () => ({ Err: 'Source stopped' });
  await assert.rejects(() => checkHistoricalAcceptance(expected, t), /stopped/);
});
test('late source, identity configuration, registry and target drift refuse acceptance', async () => {
  const source = transport(), read = source.status; let n = 0;
  source.status = async s => ++n === 4 ? { Ok: { revision: 10n, acknowledged: 10n, pending: false } } : read(s);
  await assert.rejects(() => checkHistoricalAcceptance(expected, source), /changed/);
  for (const change of [c => ({ ...c, enabled: false }), c => ({ ...c, app_enabled: true }), c => ({ ...c, sources: c.sources.slice(1) }), c => ({ ...c, inventory_digest: new Uint8Array(32) })]) {
    const t = transport(), configuration = t.configuration; let at = 0;
    t.configuration = async () => { const c = await configuration(); return ++at === 4 ? { Ok: change(c.Ok) } : c; };
    await assert.rejects(() => checkHistoricalAcceptance(expected, t), /configuration changed/);
  }
  const t = transport(); t.observe = async () => ({ moduleHash: 'foreign', settingsHash: targets[0].settingsHash });
  await assert.rejects(() => checkHistoricalAcceptance(expected, t), /module\/settings/);
  const r = transport(); r.gate = async () => { throw Error('Registry drift'); };
  await assert.rejects(() => checkHistoricalAcceptance(expected, r), /Registry drift/);
});
test('first ownership revision must match completed fill, not merely later ownership calls', async () => {
  await assert.rejects(() => checkHistoricalAcceptance({ ...expected, ownership: { ...ownership, source_revisions: [['g1', 8n], ['g2', 9n]] } }, transport()), /Ownership/);
});
test('restart checkpoint preserves exact historical bindings and refuses corrupt or false readiness evidence', () => {
  const checkpoint = { ready: false, fill: { g1: true, g2: true }, acknowledgedRevisions: { g1: '7', g2: '9' }, directoryInventoryDigest: Array.from(inventoryDigest),
    ownership: { ...ownership, inventory_digest: Array.from(inventoryDigest), source_revisions: [['g1', '7'], ['g2', '9']] } };
  requireHistoricalCheckpoint(JSON.parse(JSON.stringify(checkpoint)), sources);
  requireHistoricalCheckpoint({ fill: { g1: true }, acknowledgedRevisions: { g1: '7' } }, sources);
  for (const bad of [{ ...checkpoint, ready: true }, { ...checkpoint, appEnabled: true }, { ...checkpoint, acknowledgedRevisions: { g1: '07', g2: '9' } }, { ...checkpoint, acknowledgedRevisions: { g1: '7' } }, { ...checkpoint, directoryInventoryDigest: Array(32).fill(0) }, { ...checkpoint, fill: { g1: false, g2: true } }]) assert.throws(() => requireHistoricalCheckpoint(bad, sources));
});