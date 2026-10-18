/** Local operator workflow; no network/controller implementation or credentials.
 * The directory must be operator-owned. A lock left by a crashed process needs
 * manual investigation, never automatic expiry. Receipts are not authorization.
 */
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkpointMedia, restoreMedia, resumeMedia } from './media-recovery-coordinator.mjs';

async function persist(directory, value) {
  const temp = join(directory, `.receipt-${randomUUID()}.tmp`);
  const file = await open(temp, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally { await file.close(); }
  await rename(temp, join(directory, 'receipt.json'));
  const parent = await open(directory, 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}

function sameInventory(a, b) {
  return a && b && a.deploymentId === b.deploymentId && a.authority === b.authority &&
    Array.isArray(a.stores) && Array.isArray(b.stores) &&
    JSON.stringify([...a.stores].sort()) === JSON.stringify([...b.stores].sort());
}

/** One action per exclusive lock. Save intent BEFORE calls; acknowledge AFTER.
 * An interrupted restore can only be replayed in full while stopped. A failed
 * resume also requires a full restore before another approved restart.
 */
export async function runRecoveryAction(directory, expected, adapter, action, approved = false) {
  if (!['checkpoint', 'restore', 'resume'].includes(action)) throw new Error('Invalid recovery action');
  const lockPath = join(directory, 'operator.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(error => {
    if (error.code === 'EEXIST') throw new Error('Recovery locked; investigate the existing operator before manual unlock');
    throw error;
  });
  let receipt;
  let persistenceFailed = false;
  const save = async () => {
    try { await persist(directory, receipt); }
    catch (error) { persistenceFailed = true; throw error; }
  };
  try {
    try { receipt = JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (receipt && (receipt.version !== 1 || !sameInventory(receipt.inventory, expected) ||
        !Array.isArray(receipt.steps) || typeof receipt.id !== 'string')) {
      throw new Error('Invalid or mismatched recovery receipt');
    }
    if (action === 'checkpoint') {
      if (receipt) throw new Error('Existing recovery receipt; use a new operator directory for a new checkpoint');
      receipt = { version: 1, id: randomUUID(), inventory: structuredClone(expected), phase: 'checkpointing', steps: [], checkpoint: null };
    } else {
      if (!receipt?.checkpoint) throw new Error('Complete durable checkpoint required');
      if (action === 'resume' && (!['checkpointed', 'restored'].includes(receipt.phase) || approved !== true)) {
        throw new Error('Resume requires complete checkpoint/restore and explicit approval');
      }
      if (action === 'restore' && !['checkpointed', 'restoring', 'restore_failed', 'restored', 'resuming', 'resume_failed', 'resumed'].includes(receipt.phase)) {
        throw new Error('Receipt cannot be restored');
      }
      receipt.phase = action === 'restore' ? 'restoring' : 'resuming';
    }
    await save();
    const wrapped = { ...adapter };
    for (const method of ['stop', 'takeSnapshot', 'loadSnapshot', 'start']) {
      wrapped[method] = async (...args) => {
        const step = { action, method, canisterId: args[0], state: 'attempted' };
        if (method === 'loadSnapshot') step.snapshotId = args[1];
        receipt.steps.push(step);
        await save();
        const result = await adapter[method](...args);
        step.state = 'acknowledged';
        if (method === 'takeSnapshot') step.snapshotId = result;
        await save();
        return result;
      };
    }
    try {
      if (action === 'checkpoint') receipt.checkpoint = await checkpointMedia(expected, wrapped);
      if (action === 'restore') await restoreMedia(expected, receipt.checkpoint, wrapped);
      if (action === 'resume') await resumeMedia(expected, receipt.checkpoint, wrapped, approved);
      receipt.phase = { checkpoint: 'checkpointed', restore: 'restored', resume: 'resumed' }[action];
      await save();
      return structuredClone(receipt);
    } catch (error) {
      receipt.phase = `${action}_failed`;
      // Never rely on receipt storage to refence after any resume failure,
      // including failure to durably record the final successful restart.
      if (action === 'resume') {
        const failed = [];
        for (const id of [...expected.stores, expected.authority]) {
          try {
            await adapter.stop(id);
            if (await adapter.status(id) !== 'stopped') failed.push(id);
          } catch { failed.push(id); }
        }
        if (failed.length) {
          if (!persistenceFailed) await save();
          throw new AggregateError([error], `Manual fencing required: ${failed.join(', ')}`);
        }
      }
      if (!persistenceFailed) await save();
      throw error;
    }
  } finally {
    await lock.close();
    // Storage failure deliberately retains the lock: disk state may be stale.
    if (!persistenceFailed) await unlink(lockPath);
  }
}