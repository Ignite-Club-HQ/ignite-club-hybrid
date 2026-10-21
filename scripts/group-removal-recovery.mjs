/** Offline coordinator core. No production transport, deploy, opening or
 * authority-grant path. Adapters must authenticate exclusive controller
 * fencing and an anti-rollback anchor outside the snapshot set. */
import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value, (_, x) => typeof x === 'bigint' ? { bigint: x.toString() } : x)).digest('hex');
export function recoveryBinding(inventory) {
  if (!inventory || !inventory.deploymentId || !inventory.network || !inventory.host ||
      typeof inventory.revision !== 'bigint' || inventory.revision < 1n ||
      !Array.isArray(inventory.participants) || inventory.participants.length < 2 || inventory.participants.length > 1088) throw Error('Invalid complete recovery inventory');
  const url = new URL(inventory.host);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('Invalid recovery host');
  const ids = inventory.participants.map(p => p.id);
  if (new Set(ids).size !== ids.length || inventory.participants.some(p => !p.id || !p.domain || !p.group || !p.subnet || !/^[a-f0-9]{64}$/.test(p.module))) throw Error('Invalid recovery participant');
  if (!ids.includes(inventory.authority)) throw Error('Missing identity authority');
  return digest(inventory);
}
function plan(inventory) { return [...inventory.participants.filter(p => p.id !== inventory.authority), inventory.participants.find(p => p.id === inventory.authority)]; }
async function bound(inventory, adapter) {
  const expected = recoveryBinding(inventory);
  if (recoveryBinding(await adapter.readAuthenticatedInventory()) !== expected) throw Error('Recovery inventory changed');
  if (await adapter.verifyExclusiveControllerFence(inventory) !== true) throw Error('Exclusive controller fence required');
  return expected;
}
async function stopped(inventory, adapter) {
  await bound(inventory, adapter);
  for (const p of inventory.participants) if (await adapter.status(p.id) !== 'stopped') throw Error('Complete stopped inventory required');
}
async function record(journal, state) {
  await journal.save(state);
  if (digest(await journal.read()) !== digest(state)) throw Error('Recovery journal readback failed; keep every participant fenced');
}
async function stopAll(inventory, adapter) {
  await bound(inventory, adapter);
  for (const p of plan(inventory)) await adapter.stop(p.id);
  await stopped(inventory, adapter);
}
function checkCheckpoint(inventory, checkpoint) {
  if (!checkpoint || checkpoint.version !== 1 || checkpoint.binding !== recoveryBinding(inventory) ||
      !Array.isArray(checkpoint.snapshots) || checkpoint.snapshots.length !== inventory.participants.length ||
      !checkpoint.anchor || !checkpoint.semanticHistory) throw Error('Incomplete recovery checkpoint');
  const ids = new Set();
  for (const row of checkpoint.snapshots) {
    if (ids.has(row.id) || !inventory.participants.some(p => p.id === row.id) || !/^(?:[a-f0-9]{2})+$/.test(row.snapshot)) throw Error('Invalid recovery snapshot');
    ids.add(row.id);
  }
}
export async function checkpointGroup(inventory, adapter, journal) {
  if (await journal.read()) throw Error('Existing recovery intent requires reconciliation');
  let state = { version: 1, binding: recoveryBinding(inventory), phase: 'stop-intent', snapshots: [] };
  await record(journal, state);
  await stopAll(inventory, adapter);
  const semanticHistory = await adapter.readDecodedHistory(inventory);
  // Adapter must cover generation, all denials, erased accounts, exact
  // barrier subjects/receipts, pending callbacks, leases and quota ledgers.
  if (await adapter.verifyCompleteDecodedHistory(inventory, semanticHistory) !== true) throw Error('Incomplete semantic history');
  const anchor = await adapter.readIndependentAnchor(state.binding);
  if (await adapter.verifyHistoryAgainstAnchor(semanticHistory, anchor) !== true) throw Error('Anti-rollback history verification failed');
  state = { ...state, phase: 'snapshot-intent', semanticHistory, anchor };
  await record(journal, state);
  for (const p of plan(inventory)) {
    await stopped(inventory, adapter);
    state = { ...state, pending: { kind: 'take', id: p.id } };
    await record(journal, state);
    const snapshot = await adapter.takeSnapshot(p.id);
    state = { ...state, pending: undefined, snapshots: [...state.snapshots, { id: p.id, snapshot }] };
    await record(journal, state);
  }
  checkCheckpoint(inventory, state);
  await stopped(inventory, adapter);
  state = { ...state, phase: 'checkpointed' }; await record(journal, state);
  return state;
}
export async function restoreGroup(inventory, checkpoint, adapter, journal) {
  checkCheckpoint(inventory, checkpoint);
  const saved = await journal.read();
  if (!saved || saved.binding !== checkpoint.binding || saved.pending || !['checkpointed', 'restored'].includes(saved.phase)) throw Error('Unknown recovery outcome requires reconciliation');
  if (digest(saved.snapshots) !== digest(checkpoint.snapshots) || digest(saved.anchor) !== digest(checkpoint.anchor) || digest(saved.semanticHistory) !== digest(checkpoint.semanticHistory)) throw Error('Checkpoint does not match durable recovery intent');
  await stopAll(inventory, adapter);
  const anchor = await adapter.readIndependentAnchor(checkpoint.binding);
  if (digest(anchor) !== digest(checkpoint.anchor) || await adapter.verifyHistoryAgainstAnchor(checkpoint.semanticHistory, anchor) !== true) throw Error('Rollback checkpoint rejected');
  let state = { ...checkpoint, phase: 'restore-intent' };
  await record(journal, state);
  for (const row of checkpoint.snapshots) {
    await stopped(inventory, adapter);
    state = { ...state, pending: { kind: 'load', id: row.id, snapshot: row.snapshot } }; await record(journal, state);
    await adapter.loadSnapshot(row.id, row.snapshot);
    state = { ...state, pending: undefined }; await record(journal, state);
  }
  await stopped(inventory, adapter);
  if (await adapter.verifyRestoredDecodedHistory(inventory, checkpoint.semanticHistory, anchor) !== true) throw Error('Restored permission history or ledgers mismatch');
  await record(journal, { ...state, phase: 'restored' });
}
export async function resumeGroup(inventory, checkpoint, adapter, journal, approval) {
  checkCheckpoint(inventory, checkpoint);
  if (!approval || approval.binding !== checkpoint.binding || approval.approved !== true) throw Error('Exact-inventory resume approval required');
  const saved = await journal.read();
  if (!saved || saved.phase !== 'restored' || saved.pending || saved.binding !== checkpoint.binding) throw Error('Verified full restore required');
  await stopped(inventory, adapter);
  const anchor = await adapter.readIndependentAnchor(checkpoint.binding);
  if (digest(anchor) !== digest(checkpoint.anchor) || await adapter.verifyRestoredDecodedHistory(inventory, checkpoint.semanticHistory, anchor) !== true) throw Error('History changed before resume');
  let state = { ...saved, phase: 'resume-intent' }; await record(journal, state);
  try {
    for (const p of [inventory.participants.find(p => p.id === inventory.authority), ...inventory.participants.filter(p => p.id !== inventory.authority)]) {
      await bound(inventory, adapter);
      state = { ...state, pending: { kind: 'start', id: p.id } }; await record(journal, state);
      await adapter.start(p.id);
      if (await adapter.status(p.id) !== 'running') throw Error('Participant failed to resume');
      state = { ...state, pending: undefined }; await record(journal, state);
    }
    await record(journal, { ...state, phase: 'resumed' });
  } catch (error) {
    const failures = [];
    for (const p of plan(inventory)) { try { await adapter.stop(p.id); } catch { failures.push(p.id); } }
    if (failures.length) throw new AggregateError([error], 'Resume failed; manual exclusive fencing required');
    throw error;
  }
}