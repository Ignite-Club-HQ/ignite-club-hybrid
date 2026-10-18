/** Offline verification contract, not a production snapshot reader.
 * A reviewed authenticated reader must extract complete state while ALL
 * participants are stopped. Caller-authored digests/load receipts are not proof.
 * Historical quotas cannot be reconstructed from current file counts.
 */
import { createHash } from 'node:crypto';
const sections = {
  store: ['ciphertext', 'fileIndex', 'allocator', 'uploadJournal', 'ownership'],
  authority: ['quotaLedger', 'quotaJournal', 'storeRegistry'],
};
const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const hex = x => typeof x === 'string' && /^(?:[a-f0-9]{2})+$/.test(x);
const text = x => typeof x === 'string' && x.length > 0 && x.length <= 512;
const fail = () => { throw new Error('Invalid or incomplete recovery evidence'); };

/** Hash all bytes in order without decrypting or staging content on disk. */
export async function hashRecoverySection(chunks, expectedBytes) {
  if (typeof expectedBytes !== 'bigint' || expectedBytes < 0n) fail();
  const hash = createHash('sha256');
  let bytes = 0n;
  for await (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0 || chunk.byteLength > 1_000_000) fail();
    bytes += BigInt(chunk.byteLength);
    if (bytes > expectedBytes) fail();
    hash.update(chunk);
  }
  if (bytes !== expectedBytes) fail();
  return { bytes: bytes.toString(), sha256: hash.digest('hex') };
}
function canonical(checkpoint, evidence) {
  const inv = checkpoint?.inventory;
  if (checkpoint?.version !== 1 || !inv || !text(inv.deploymentId) || !text(inv.authority) ||
      !Array.isArray(inv.stores) || inv.stores.length < 1 || inv.stores.length > 64 || inv.stores.some(id => !text(id))) fail();
  const ids = [inv.authority, ...inv.stores];
  if (new Set(ids).size !== ids.length || !Array.isArray(checkpoint.snapshots) || checkpoint.snapshots.length !== ids.length) fail();
  const snapshots = new Map();
  for (const s of checkpoint.snapshots) {
    if (!ids.includes(s?.canisterId) || snapshots.has(s.canisterId) || !hex(s.snapshotId)) fail();
    snapshots.set(s.canisterId, s.snapshotId);
  }
  if (evidence?.version !== 1 || evidence.deploymentId !== inv.deploymentId || !text(evidence.registryRevision) ||
      !text(evidence.network) || !text(evidence.host) || !Array.isArray(evidence.participants) || evidence.participants.length !== ids.length) fail();
  const url = new URL(evidence.host);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') fail();
  const seen = new Set();
  const participants = evidence.participants.map(e => {
    const role = e?.canisterId === inv.authority ? 'authority' : 'store';
    if (!ids.includes(e?.canisterId) || seen.has(e.canisterId) || e.role !== role ||
        e.snapshotId !== snapshots.get(e.canisterId) || e.status !== 'stopped' ||
        !digest(e.moduleHash) || !text(e.subnetId) || !e.sections || Object.keys(e.sections).length !== sections[role].length) fail();
    seen.add(e.canisterId);
    const state = sections[role].map(name => {
      const s = e.sections[name];
      if (!s || !digest(s.sha256) || typeof s.bytes !== 'string' || !/^(0|[1-9][0-9]*)$/.test(s.bytes) || s.bytes.length > 30) fail();
      return [name, s.bytes, s.sha256];
    });
    return [e.canisterId, role, e.snapshotId, e.moduleHash, e.subnetId, state];
  }).sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify([inv.deploymentId, evidence.registryRevision, evidence.network, url.origin, participants]);
}
/** Pure comparison cannot certify input provenance. Missing/invalid data denies. */
export function compareRecoveryEvidence(checkpoint, baseline, restored) {
  try { return canonical(checkpoint, baseline) === canonical(checkpoint, restored); }
  catch { return false; }
}
/** Opt-in coordinator gate for a FUTURE reviewed controller adapter. Reader must
 * extract actual restored state, independently verify origin and continuous
 * fencing of the whole set; never echo baseline digests or load acknowledgements.
 */
export function recoveryConsistencyGate(baseline, readVerifiedRestoredEvidence) {
  const saved = structuredClone(baseline);
  if (typeof readVerifiedRestoredEvidence !== 'function') throw new Error('Verified state reader required');
  return async checkpoint => {
    try { return compareRecoveryEvidence(checkpoint, saved, await readVerifiedRestoredEvidence(checkpoint)); }
    catch { return false; }
  };
}
