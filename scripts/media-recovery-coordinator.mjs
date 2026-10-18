/** Coordinated recovery core. Adapters must use authenticated controller calls.
 * Never discovers inventory by guessing names; no automatic deployment or restart.
 * Stop failure deliberately leaves already stopped participants stopped.
 */
function inventory(value) {
  if (!value || !value.deploymentId || !value.authority || !Array.isArray(value.stores) ||
      value.stores.length < 1 || value.stores.length > 64) throw new Error('Invalid recovery inventory');
  const ids = [value.authority, ...value.stores];
  if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) {
    throw new Error('Duplicate or invalid recovery participants');
  }
  return [...value.stores, value.authority];
}

function match(actual, expected) {
  const a = inventory(actual).sort();
  const b = inventory(expected).sort();
  if (actual.deploymentId !== expected.deploymentId || actual.authority !== expected.authority ||
      a.length !== b.length || a.some((id, index) => id !== b[index])) {
    throw new Error('Recovery inventory does not match authoritative registry');
  }
}

async function fence(expected, adapter) {
  match(expected, await adapter.readInventory());
  // Stop writers first and authority last. A successful stop is a protocol
  // fence for all mutations, including timers and callbacks, not just admission.
  for (const id of inventory(expected)) await adapter.stop(id);
  await verifyStopped(expected, adapter);
  // Re-read membership of the recovery set after stopping it. An authenticated
  // adapter must use registry metadata/certified state readable while stopped.
  match(expected, await adapter.readInventory());
}

async function verifyStopped(expected, adapter) {
  for (const id of inventory(expected)) {
    if (await adapter.status(id) !== 'stopped') throw new Error(`Participant not stopped: ${id}`);
  }
}

function validateCheckpoint(expected, checkpoint) {
  if (!checkpoint || checkpoint.version !== 1 || !Array.isArray(checkpoint.snapshots)) throw new Error('Invalid recovery checkpoint');
  match(expected, checkpoint.inventory);
  const required = new Set(inventory(expected));
  const seen = new Set();
  for (const entry of checkpoint.snapshots) {
    if (!required.has(entry.canisterId) || seen.has(entry.canisterId) ||
        typeof entry.snapshotId !== 'string' || !/^(?:[a-f0-9]{2})+$/.test(entry.snapshotId)) {
      throw new Error('Incomplete or invalid coordinated snapshots');
    }
    seen.add(entry.canisterId);
  }
  if (seen.size !== required.size) throw new Error('Incomplete or invalid coordinated snapshots');
}

export async function checkpointMedia(expected, adapter) {
  await fence(expected, adapter);
  const snapshots = [];
  for (const canisterId of inventory(expected)) {
    const snapshotId = await adapter.takeSnapshot(canisterId);
    snapshots.push({ canisterId, snapshotId });
  }
  const checkpoint = {
    version: 1,
    inventory: { deploymentId: expected.deploymentId, authority: expected.authority, stores: [...expected.stores] },
    snapshots,
  };
  validateCheckpoint(expected, checkpoint);
  await verifyStopped(expected, adapter);
  // Leave all participants stopped. Persist and inspect this manifest before
  // the separately authorized resume action; partial snapshots never resume.
  return checkpoint;
}

export async function restoreMedia(expected, checkpoint, adapter) {
  validateCheckpoint(expected, checkpoint); // Reject partial plans before any stop/load.
  await fence(expected, adapter);
  for (const entry of checkpoint.snapshots) await adapter.loadSnapshot(entry.canisterId, entry.snapshotId);
  await verifyStopped(expected, adapter);
  match(expected, await adapter.readInventory());
  // No resume in a finally block: a partial restore must remain fenced.
}

export async function resumeMedia(expected, checkpoint, adapter, approved) {
  if (approved !== true) throw new Error('Explicit resume approval required');
  validateCheckpoint(expected, checkpoint);
  match(expected, await adapter.readInventory());
  await verifyStopped(expected, adapter);
  if (await adapter.verifyConsistency(checkpoint) !== true) throw new Error('Recovery consistency verification failed');
  // Start quota authority first, then writers; refence everything if any start fails.
  try {
    for (const id of [expected.authority, ...expected.stores]) {
      await adapter.start(id);
      if (await adapter.status(id) !== 'running') throw new Error(`Participant failed to start: ${id}`);
    }
  } catch (error) {
    const failedFences = [];
    for (const id of inventory(expected)) {
      try { await adapter.stop(id); } catch { failedFences.push(id); }
    }
    if (failedFences.length) throw new AggregateError([error], `Resume failed; manual fencing required: ${failedFences.join(', ')}`);
    throw error;
  }
}