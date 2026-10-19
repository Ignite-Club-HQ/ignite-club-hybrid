/** Local operator journal only. No credentials, network transport or automatic
 * unlock. A retained lock requires exact operator reconciliation. */
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const encode = value => JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? { $bigint: v.toString() } : v);
const decode = text => JSON.parse(text, (_key, v) => v && typeof v === 'object' && Object.keys(v).length === 1 && typeof v.$bigint === 'string' ? BigInt(v.$bigint) : v);
async function persist(directory, receipt) {
  const temp = join(directory, `.provision-${randomUUID()}.tmp`);
  const file = await open(temp, 'wx', 0o600);
  try { await file.writeFile(encode(receipt)); await file.sync(); } finally { await file.close(); }
  await rename(temp, join(directory, 'provision.json'));
  const parent = await open(directory, 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}

/** execute receives the existing durable provision and checkpoint callback.
 * It must use runProvision(..., {stopAfterRegistration:true}). Success means
 * registered CLOSED, never permission to enable routing or restore anything. */
export async function runClosedProvisionJournal(directory, binding, initial, execute) {
  if (!binding || !binding.governor || !binding.deploymentId || !binding.host || !binding.networkKind || !binding.subnetId || !binding.proposalId) throw new Error('Complete operator deployment binding required');
  const host = new URL(binding.host);
  if (host.protocol !== 'https:' || host.username || host.password || host.search || host.hash) throw new Error('Invalid operator HTTPS binding');
  if (initial.id !== binding.proposalId || initial.deploymentId !== binding.deploymentId || initial.subnetId !== binding.subnetId) throw new Error('Proposal binding mismatch');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'operator.lock');
  const lock = await open(path, 'wx', 0o600).catch(error => {
    if (error.code === 'EEXIST') throw new Error('Provision locked; reconcile the existing operator before manual unlock');
    throw error;
  });
  try {
    await lock.writeFile(encode({ pid: process.pid, binding })); await lock.sync();
    let receipt;
    try { receipt = decode(await readFile(join(directory, 'provision.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (receipt && (receipt.version !== 1 || encode(receipt.binding) !== encode(binding) || receipt.provision?.id !== initial.id || receipt.provision?.groupId !== initial.groupId)) throw new Error('Journal binding mismatch');
    if (receipt?.provision?.pending) throw new Error('Unresolved provision intent requires exact reconciliation');
    let current = receipt?.provision ?? initial;
    const checkpoint = async provision => {
      if (provision.id !== initial.id || provision.groupId !== initial.groupId || provision.deploymentId !== initial.deploymentId || provision.subnetId !== initial.subnetId) throw new Error('Checkpoint binding changed');
      await persist(directory, { version: 1, binding, provision });
      current = provision;
    };
    await checkpoint(current); // exclusive durable approval precedes execution
    const result = await execute(current, checkpoint);
    if (result.phase !== 'registered' || result.pending) throw new Error('Closed complete registration required; retain operator lock');
    await checkpoint(result);
    await lock.close();
    await unlink(path);
    return result;
  } catch (error) {
    await lock.close(); // Never remove a lock after ambiguous calls/disk failures.
    throw error;
  }
}