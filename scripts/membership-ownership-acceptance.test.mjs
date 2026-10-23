import test from 'node:test';
import assert from 'node:assert/strict';
import { runOwnershipAcceptance } from './membership-ownership-acceptance.mjs';
const expected = { inventoryDigest: new Uint8Array(32).fill(1), sources: [{ groupId: 'g1' }, { groupId: 'g2' }], completed: { g1: 7n, g2: 9n } };
const progress = (complete = true) => ({ scanned: 100n, clubs: 206n, complete, inventory_digest: expected.inventoryDigest, source_revisions: [['g1', 7n], ['g2', 9n]], verified_current: false });
test('bounded durable ownership completes with exact source revisions, never release readiness', async () => {
  let calls = 0; const saved = [];
  const result = await runOwnershipAcceptance(async () => ({ Ok: progress(++calls === 3) }), expected, { persist: async p => saved.push(p) });
  assert.equal(calls, 3); assert.equal(saved.length, 1); assert.equal(result.clubs, 206n); assert.equal(result.ready, false); assert.equal(result.appEnabled, false);
});
test('first ownership reply cannot substitute different filled revisions or survive failed persistence', async () => {
  await assert.rejects(() => runOwnershipAcceptance(async () => ({ Ok: { ...progress(), source_revisions: [['g1', 8n], ['g2', 9n]] } }), expected), /filled revisions/);
  await assert.rejects(() => runOwnershipAcceptance(async () => ({ Ok: progress() }), expected, { persist: async () => { throw Error('Unknown journal readback'); } }), /Unknown/);
});
test('conflicts, changed revisions, fabricated currentness, partial source lists and excessive work fail closed', async () => {
  for (const p of [{ ...progress(), verified_current: true }, { ...progress(), scanned: 101n }, { ...progress(), source_revisions: [['g1', 7n]] }, { ...progress(), inventory_digest: new Uint8Array(32).fill(2) }]) {
    let saved = false;
    await assert.rejects(() => runOwnershipAcceptance(async () => ({ Ok: p }), expected, { persist: async () => { saved = true; } }));assert.equal(saved, false);
  }
  await assert.rejects(() => runOwnershipAcceptance(async () => ({ Err: 'Club ID claimed by multiple membership sources' }), expected), /multiple/);
  let calls = 0;
  await assert.rejects(() => runOwnershipAcceptance(async () => ({ Ok: ++calls === 1 ? progress(false) : { ...progress(), source_revisions: [['g1', 8n], ['g2', 9n]] } }), expected), /sources changed/);
  await assert.rejects(() => runOwnershipAcceptance(async () => ({ Ok: progress(false) }), expected, { maxCalls: 2 }), /budget/);
});