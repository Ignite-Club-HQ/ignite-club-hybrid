// Offline, ciphertext-only protected plan artifacts. These helpers do not
// authenticate evidence, make network calls, or authorize a production release.
import { createHash } from 'node:crypto';
import { openSync, closeSync, readFileSync, writeFileSync, fsyncSync, mkdirSync, unlinkSync, fstatSync, readSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonical } from './migrate-club-plan.mjs';

const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const bytes = value => Array.isArray(value) && value.length > 0 && value.length <= 1048576 && value.every(b => Number.isInteger(b) && b >= 0 && b <= 255);
const exactText = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f/]/.test(value);

/** Strict allowlist: reject extra properties, including accidentally retained
 * plaintext names, secrets, unbound destinations and legacy plan formats. */
export function validatePrivateNameArtifact(body) {
  const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && canonical(Object.keys(value).sort()) === canonical([...keys].sort());
  if (!exactKeys(body, ['kind', 'identityId', 'operator', 'deploymentHash', 'inventoryHash', 'historyRevision', 'sinks', 'rows']) || body.kind !== 'club-name-ciphertext-plan-v1') throw Error('Invalid ciphertext-only plan schema');
  if (![body.identityId, body.operator].every(exactText) || ![body.deploymentHash, body.inventoryHash].every(h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h)) || !/^(0|[1-9][0-9]*)$/.test(body.historyRevision)) throw Error('Invalid exact deployment/inventory binding');
  if (!Array.isArray(body.sinks) || body.sinks.length === 0 || body.sinks.length > 100 || !Array.isArray(body.rows) || body.rows.length > 100000) throw Error('Plan inventory exceeds bounds');
  const sinks = new Set();
  for (const sink of body.sinks) {
    if (!exactKeys(sink, ['id', 'publicKey']) || !exactText(sink.id) || !bytes(sink.publicKey) || sinks.has(sink.id)) throw Error('Invalid distinct original PII inventory');
    sinks.add(sink.id);
  }
  const accounts = new Set(), subjects = new Set();
  for (const row of body.rows) {
    if (!exactKeys(row, ['accountId', 'subject', 'sink', 'ciphertext', 'clubs']) || ![row.accountId, row.subject].every(exactText) || !sinks.has(row.sink) || !bytes(row.ciphertext) || accounts.has(row.accountId) || subjects.has(row.subject)) throw Error('Invalid distinct account/original PII binding');
    accounts.add(row.accountId); subjects.add(row.subject);
    if (!Array.isArray(row.clubs) || row.clubs.length > 100) throw Error('Bounded exact club inventory required');
    const clubs = new Set();
    for (const club of row.clubs) {
      if (!exactKeys(club, ['id', 'ciphertext']) || !exactText(club.id) || club.id.length > 64 || !bytes(club.ciphertext) || clubs.has(club.id)) throw Error('Invalid distinct encrypted club copy');
      clubs.add(club.id);
    }
  }
  return body;
}

/** Encryption is injected: maintained SDK primitives are supplied by the
 * caller; ciphertext is generated once before approval, never on recovery. */
export async function preparePrivateNameArtifact({ rows, sinks, identityId, operator, deploymentHash, inventoryHash, historyRevision }, { encryptName, encryptClubName }) {
  if (!Array.isArray(rows) || rows.length > 100000 || !Array.isArray(sinks) || sinks.length > 100) throw Error('Plan inventory exceeds bounds');
  // Validate every input before any cryptographic or injected adapter work.
  for (const row of rows) if (!row || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 4096 || !Array.isArray(row.clubs) || row.clubs.length > 100) throw Error('Complete exact account/club/original PII inventory required');
  validatePrivateNameArtifact({ kind: 'club-name-ciphertext-plan-v1', identityId, operator, deploymentHash, inventoryHash, historyRevision: String(historyRevision), sinks, rows: rows.map(row => ({accountId: row.accountId, subject: row.subject, sink: row.sink, ciphertext: [0], clubs: row.clubs.map(id => ({id, ciphertext: [0]}))})) });
  const sinkMap = new Map(sinks.map(s => [s.id, s]));
  const encrypted = [];
  for (const row of [...rows].sort((a, b) => a.accountId.localeCompare(b.accountId))) {
    const sink = sinkMap.get(row.sink);
    if (!sink || typeof row.name !== 'string' || !row.name.trim() || !Array.isArray(row.clubs) || row.clubs.length > 100 || new Set(row.clubs).size !== row.clubs.length) throw Error('Complete exact account/club/original PII inventory required');
    const clubs = [];
    for (const club of [...row.clubs].sort()) clubs.push({ id: club, ciphertext: Array.from(await encryptClubName(sink.publicKey, club, row.subject, row.name)) });
    encrypted.push({ accountId: row.accountId, subject: row.subject, sink: row.sink, ciphertext: Array.from(await encryptName(sink.publicKey, row.subject, row.name)), clubs });
  }
  const body = validatePrivateNameArtifact({ kind: 'club-name-ciphertext-plan-v1', identityId, operator, deploymentHash, inventoryHash, historyRevision: String(historyRevision), sinks: [...sinks].sort((a, b) => a.id.localeCompare(b.id)).map(s => ({ id: s.id, publicKey: Array.from(s.publicKey) })), rows: encrypted });
  return { body, hash: digest(body) };
}

/** A pinned digest must come from the original protected approval, never from
 * the artifact being read. Hashes verify bytes, not evidence authenticity. */
export function verifyPrivateNameArtifact(artifact, expectedHash) {
  if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash) || !artifact || canonical(Object.keys(artifact).sort()) !== canonical(['body', 'hash'])) throw Error('Original protected artifact hash required');
  validatePrivateNameArtifact(artifact.body);
  if (Buffer.byteLength(canonical(artifact)) > MAX_ARTIFACT_BYTES) throw Error('Protected artifact exceeds byte budget');
  if (artifact.hash !== expectedHash || digest(artifact.body) !== expectedHash) throw Error('Protected artifact changed');
  return structuredClone(artifact.body);
}

export function readPrivateNameArtifact(path, expectedHash) {
  const fd = openSync(path, 'r');
  try {
    const status = fstatSync(fd);
    if (!status.isFile() || status.size > MAX_ARTIFACT_BYTES) throw Error('Protected artifact exceeds byte budget');
    // One bounded allocation; reject truncated/extended files rather than
    // reading an unbounded replacement through the path after stat.
    const buffer = Buffer.alloc(status.size + 1);
    let count = 0;
    while (count < buffer.length) {
      const n = readSync(fd, buffer, count, buffer.length - count, null);
      if (n === 0) break;
      count += n;
    }
    if (count !== status.size) throw Error('Protected artifact changed during read');
    return verifyPrivateNameArtifact(JSON.parse(buffer.subarray(0, count).toString('utf8')), expectedHash);
  } finally { closeSync(fd); }
}

/** Exclusive creation and fsync: interruptions retain the file and require
 * exact readback. Never overwrite an unknown, corrupt or different artifact. */
export function savePrivateNameArtifact(path, artifact, expectedHash) {
  verifyPrivateNameArtifact(artifact, expectedHash);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let fd;
  try { fd = openSync(path, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return readPrivateNameArtifact(path, expectedHash);
  }
  try { writeFileSync(fd, canonical(artifact)); fsyncSync(fd); }
  finally { closeSync(fd); }
  const directory = openSync(dirname(path), 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
  return readPrivateNameArtifact(path, expectedHash);
}

/** Entire inventory is reconciled BEFORE a resumed writer gets any work.
 * Plaintext comparison uses authorized decryption injected by the adapter;
 * no plaintext or guessable name hashes are written to disk. */
export async function reconcilePrivateNameRecovery(body, { profiles, binding, decryptName, readCiphertext }) {
  validatePrivateNameArtifact(body);
  for (const key of ['identityId', 'operator', 'deploymentHash', 'inventoryHash']) if (binding[key] !== body[key]) throw Error('Recovery deployment/inventory binding changed');
  if (canonical(binding.sinks) !== canonical(body.sinks)) throw Error('Original PII keys changed');
  if (!Array.isArray(profiles) || profiles.length !== body.rows.length) throw Error('Recovery profile inventory changed');
  const live = new Map(profiles.map(p => [p.account_id, p]));
  if (live.size !== profiles.length) throw Error('Duplicate recovery profile');
  const pending = [];
  for (const row of body.rows) {
    const profile = live.get(row.accountId);
    if (!profile || !Array.isArray(profile.principals) || !profile.principals.includes(row.subject)) throw Error('Recovery account/subject binding changed');
    const reference = `pii-display-name:v1:${row.sink}:${row.subject}`;
    if (profile.display_name === reference) {
      if (typeof readCiphertext !== 'function') throw Error('Converted ciphertext readback required');
      const stored = await readCiphertext(row, null);
      if (!bytes(stored) || canonical(stored) !== canonical(row.ciphertext)) throw Error('Converted original ciphertext mismatch');
      for (const club of row.clubs) {
        const copy = await readCiphertext(row, club.id);
        if (!bytes(copy) || canonical(copy) !== canonical(club.ciphertext)) throw Error('Converted club ciphertext mismatch');
      }
      continue;
    }
    if (typeof profile.display_name !== 'string' || profile.display_name.startsWith('pii-display-name:')) throw Error('Recovery profile reference changed');
    const originalName = await decryptName(row, body.sinks.find(s => s.id === row.sink));
    if (typeof originalName !== 'string' || originalName !== profile.display_name) throw Error('Recovery source name changed');
    pending.push(structuredClone(row));
  }
  return pending;
}

/** Local exclusive execution lock, never age-expired. Failed or unknown work
 * retains the lock; external durable lock/readback is still needed in CI. */
export function claimPrivateNameArtifactLock(path, expectedHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw Error('Original protected artifact hash required');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, expectedHash); fsyncSync(fd); } finally { closeSync(fd); }
  return {
    complete() {
      if (readFileSync(path, 'utf8') !== expectedHash) throw Error('Retained execution lock changed');
      unlinkSync(path);
    },
  };
}