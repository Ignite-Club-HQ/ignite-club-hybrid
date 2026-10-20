import assert from 'node:assert/strict';

// The owner approved this one interrupted target, not arbitrary mainnet upgrades.
export const RECOVERY_TARGET = '2knbe-saaaa-aaaal-qxpua-cai';
export const RECOVERY_RUN = 'media-mixed-001';
export const ORIGINAL_MODULE = '8ea0289f54fb5224c1eb1e17da9242e909d34dd333cfb5f7643bbfaaebf76c9b';
export const RECOVERY_MODULE = 'dfd4ab701b82e5e69ed4a4077d737d635ce33fc64faf766fecb4f9774da4a433';
export function recoveryBinding(saved, candidate) {
  if (saved.canisterId !== RECOVERY_TARGET || saved.binding?.runId !== RECOVERY_RUN || saved.binding.wasmSha256 !== ORIGINAL_MODULE) return null;
  if (candidate.wasmSha256 !== RECOVERY_MODULE) throw new Error('Unapproved recovery build; operator reconciliation required');
  const original = { ...candidate, wasmSha256: ORIGINAL_MODULE };
  if (JSON.stringify(saved.binding) !== JSON.stringify(original)) return null;
  if (saved.recoveryUpdate && saved.recoveryUpdate.to !== candidate.wasmSha256) throw new Error('Recovery build changed; operator reconciliation required');
  return original;
}

export async function drainTestUploads({ actor, prefix, sizes, max, saveIntent, saveReceipt }) {
  const unwrap = r => { if (!('Ok' in r)) throw new Error(`Pending recovery refused: ${r.Err}`); return r.Ok; };
  const pending = unwrap(await actor.read_pending_test_uploads(prefix));
  assert.ok(pending.length <= 64);
  const ids = new Set(), paths = new Set();
  // Validate the entire inventory before aborting even one reservation.
  for (const row of pending) {
    const suffix = row.path.startsWith(prefix) ? row.path.slice(prefix.length) : '';
    assert.match(suffix, /^(0|[1-9][0-9]*)$/, 'Only numeric fill paths may be recovered');
    const index = Number(suffix);
    assert.ok(index < max && row.id && !ids.has(row.id) && !paths.has(row.path));
    assert.equal(BigInt(row.size), BigInt(sizes[index % sizes.length]));
    ids.add(row.id); paths.add(row.path);
  }
  for (const row of pending) {
    await saveIntent(row);
    unwrap(await actor.abort_upload(row.id));
    await saveReceipt(row);
  }
  assert.equal(unwrap(await actor.read_pending_test_uploads(prefix)).length, 0, 'Pending reservations must drain before fill resumes');
  return pending.length;
}

export async function reconcileFill({ actor, prefix, sizes, max, digest }) {
  const objects = {};
  // Scan the entire bounded range; holes and partial batches must never skip files.
  for (let i = 0; i < max; i++) {
    const size = sizes[i % sizes.length], path = prefix + i;
    const found = await actor.get_content_hash(path);
    if (!found.length) continue;
    const want = digest(size);
    assert.equal(found[0], want, `Resume hash differs for ${path}`);
    objects[path] = { size, hash: want };
  }
  const bytes = Object.values(objects).reduce((sum, f) => sum + f.size, 0);
  assert.equal((await actor.get_usage()).total_bytes, BigInt(bytes), 'Resume inventory must match all stored bytes');
  assert.equal((await actor.health()).blob_count, BigInt(Object.keys(objects).length), 'Resume inventory must match all stored objects');
  return objects;
}

export async function settledBatch(work) {
  const results = await Promise.allSettled(work);
  const failed = results.find(r => r.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  return results.map(r => r.status === 'fulfilled' ? r.value : false);
}