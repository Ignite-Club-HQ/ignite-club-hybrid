import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pullJournal, pushJournal, remoteJournalPath } from './migrate-club-remote.mjs';

const ENV = { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'org/repo' };
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** In-memory GitHub contents API. */
function fakeGitHub(initial = {}) {
  const files = new Map(Object.entries(initial));
  return async (url, opts = {}) => {
    const path = decodeURIComponent(url.split('/contents/')[1].split('?')[0]);
    if (!opts.method || opts.method === 'GET') {
      if (!files.has(path)) return { status: 404, ok: false, json: async () => ({}) };
      const text = files.get(path).text;
      return { status: 200, ok: true, json: async () => ({ content: Buffer.from(text).toString('base64'), sha: files.get(path).sha }) };
    }
    const body = JSON.parse(opts.body);
    files.set(path, { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: `sha-${files.size}` });
    return { status: 201, ok: true, json: async () => ({}) };
  };
}

test('remoteJournalPath is per-club', () => {
  assert.equal(remoteJournalPath('abc'), 'journals/abc.json');
});

test('pullJournal returns null when unconfigured or absent', async () => {
  assert.equal(await pullJournal({}, 'c1'), null);
  assert.equal(await pullJournal(ENV, 'c1', fakeGitHub()), null);
});

test('pushJournal writes and verifies the readback', async () => {
  const gh = fakeGitHub();
  const journal = { planHash: 'abc123', steps: { club: { state: 'done' } } };
  assert.equal(await pushJournal(ENV, 'c1', journal, gh), true);
  const pulled = await pullJournal(ENV, 'c1', gh);
  assert.equal(pulled.journal.planHash, 'abc123');
  assert.equal(pulled.hash, sha256(JSON.stringify(journal, null, 2)));
});

test('pushJournal refuses to overwrite a different plan', async () => {
  const existing = JSON.stringify({ planHash: 'old', steps: {} });
  const gh = fakeGitHub({ 'journals/c1.json': { text: existing, sha: 's1' } });
  await assert.rejects(pushJournal(ENV, 'c1', { planHash: 'new', steps: {} }, gh), /different plan/);
});

test('pushJournal updates the same plan and stops on readback mismatch', async () => {
  const journal = { planHash: 'p', steps: { club: { state: 'done' } } };
  const gh0 = fakeGitHub();
  await pushJournal(ENV, 'c1', journal, gh0);
  const updated = { planHash: 'p', steps: { club: { state: 'done' }, events: { state: 'done' } } };
  assert.equal(await pushJournal(ENV, 'c1', updated, gh0), true);

  // Corrupt readback: GET returns different content than the PUT wrote.
  let gets = 0;
  const bad = async (url, opts = {}) => {
    if (!opts.method) {
      gets += 1;
      const text = gets > 1 ? '{"tampered":true}' : JSON.stringify(journal);
      return { status: 200, ok: true, json: async () => ({ content: Buffer.from(text).toString('base64'), sha: 's' }) };
    }
    return { status: 201, ok: true, json: async () => ({}) };
  };
  await assert.rejects(pushJournal(ENV, 'c2', journal, bad), /readback mismatch/);
});

test('pushJournal without config keeps local-only journaling', async () => {
  assert.equal(await pushJournal({}, 'c1', { planHash: 'p', steps: {} }), false);
});
