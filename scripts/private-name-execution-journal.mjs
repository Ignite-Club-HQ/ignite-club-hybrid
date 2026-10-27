// Local durable receipts only. The caller must hold an independently verified
// exclusive lock; this file is neither production transport nor an anti-rollback anchor.
import { constants, openSync, closeSync, fstatSync, readSync, writeSync, fsyncSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { canonical } from './migrate-club-plan.mjs';
import { verifyPrivateNameArtifact } from './private-name-plan-artifact.mjs';
import { validatePreparedJournal } from './private-name-prepared-execution.mjs';

export const MAX_EXECUTION_JOURNAL_BYTES = 32 * 1024 * 1024;
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const same = (a, b) => canonical(a) === canonical(b);
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && same(Object.keys(value).sort(), expected.sort());

export function openPreparedExecutionJournal(path, { artifact, expectedHash, assertHeld }) {
  const body = verifyPrivateNameArtifact(artifact, expectedHash);
  if (typeof assertHeld !== 'function') throw Error('Independent exclusive journal lock required');
  const checkLock = () => { if (assertHeld() !== true) throw Error('Independent exclusive journal lock required'); };
  checkLock();
  // Require a provisioned directory; never create unsynced nested parents.
  const parent = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  closeSync(parent);
  const flags = constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW;
  let fd, created = false, closed = false, poisoned = false;
  try { fd = openSync(path, flags | constants.O_CREAT | constants.O_EXCL, 0o600); created = true; }
  catch (error) { if (error.code !== 'EEXIST') throw error; fd = openSync(path, flags); }
  const entries = new Map();
  let saved = '', previous = '0'.repeat(64), sequence = 0;
  const adapter = { ids: () => [...entries.keys()], get: id => structuredClone(entries.get(id)) };
  const read = () => {
    const status = fstatSync(fd);
    if (!status.isFile() || status.size > MAX_EXECUTION_JOURNAL_BYTES || (status.mode & 0o077) !== 0) throw Error('Private bounded regular journal required');
    const buffer = Buffer.alloc(status.size + 1);
    let count = 0;
    while (count < buffer.length) {
      const n = readSync(fd, buffer, count, buffer.length - count, count);
      if (!n) break;
      count += n;
    }
    if (count !== status.size) throw Error('Journal changed during read');
    return buffer.subarray(0, count).toString('utf8');
  };
  const append = record => {
    checkLock();
    if (read() !== saved) throw Error('Journal changed; retain unknown work');
    const line = canonical(record) + '\n';
    const data = Buffer.from(line);
    if (Buffer.byteLength(saved) + data.length > MAX_EXECUTION_JOURNAL_BYTES) throw Error('Journal exceeds byte budget');
    let offset = 0;
    while (offset < data.length) {
      const n = writeSync(fd, data, offset, data.length - offset);
      if (n <= 0) throw Error('Journal write incomplete');
      offset += n;
    }
    fsyncSync(fd);
    if (read() !== saved + line) throw Error('Journal durable readback mismatch');
    saved += line;
    checkLock();
  };
  try {
    saved = read();
    if (created) {
      append({ kind: 'private-name-execution-journal-v1', planHash: expectedHash });
    }
    if (!saved.endsWith('\n')) throw Error('Interrupted journal retained; refuse repair');
    const lines = saved.slice(0, -1).split('\n');
    const header = JSON.parse(lines.shift());
    if (!keys(header, ['kind', 'planHash']) || header.kind !== 'private-name-execution-journal-v1' || header.planHash !== expectedHash) throw Error('Journal original plan changed');
    for (const line of lines) {
      const record = JSON.parse(line);
      if (!keys(record, ['sequence', 'previous', 'id', 'entry', 'hash']) || record.sequence !== sequence + 1 || record.previous !== previous) throw Error('Journal chain changed');
      const { hash: digest, ...payload } = record;
      if (digest !== hash(payload)) throw Error('Journal receipt changed');
      validateTransition(record.id, record.entry);
      entries.set(record.id, structuredClone(record.entry));
      validatePreparedJournal(body, expectedHash, adapter);
      sequence = record.sequence; previous = digest;
    }
    // Every open (including restart after a interrupted creation) makes the
    // file and directory entries durable before returning any usable receipt.
    fsyncSync(fd);
    let directoryPath = resolve(dirname(path));
    while (true) {
      const directory = openSync(directoryPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { fsyncSync(directory); } finally { closeSync(directory); }
      const ancestor = dirname(directoryPath);
      if (ancestor === directoryPath) break;
      directoryPath = ancestor;
    }
    checkLock();
  } catch (error) { closeSync(fd); throw error; }

  function validateTransition(id, entry) {
    const prior = entries.get(id);
    if (!prior) { if (entry?.phase !== 'unknown') throw Error('Journal must begin with unknown intent'); }
    else {
      const { phase: before, ...binding } = prior;
      const { phase: after, ...next } = entry;
      if (!same(binding, next) || !({ unknown: ['unknown', 'acknowledged', 'verified'], acknowledged: ['acknowledged', 'verified'], verified: ['verified'] }[before] ?? []).includes(after)) throw Error('Journal binding or phase regressed');
    }
  }
  return {
    ...adapter,
    put(id, value) {
      if (closed || poisoned) throw Error('Journal unavailable; retain unknown work');
      try {
        checkLock();
        const entry = structuredClone(value);
        validateTransition(id, entry);
        const candidate = new Map(entries); candidate.set(id, entry);
        validatePreparedJournal(body, expectedHash, { ids: () => [...candidate.keys()], get: key => candidate.get(key) });
        if (same(entries.get(id), entry)) { if (read() !== saved) throw Error('Journal changed'); return; }
        const payload = { sequence: sequence + 1, previous, id, entry };
        const digest = hash(payload);
        append({ ...payload, hash: digest });
        entries.set(id, entry); sequence++; previous = digest;
      } catch (error) { poisoned = true; throw error; }
    },
    close() { if (!closed) { closeSync(fd); closed = true; } },
  };
}