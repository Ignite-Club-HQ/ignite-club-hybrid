import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { persistGroup2Journal } from './group2-journal.mjs';

const path = 'contents/deploy/groups/g2/reload-progress.json';
const branch = 'group-2-upgrade-receipts';
const commit = 'b'.repeat(40);
const journal = { steps: [{ name: 'pii_access_control', phase: 'complete' }], complete: false };
const blob = value => {
  const bytes = Buffer.from(JSON.stringify(value));
  return { sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
    encoding: 'base64', content: bytes.toString('base64') };
};
test('checkpoint reads the acknowledged commit even when the branch still returns the preceding pending step', () => {
  const calls = [];
  const old = blob({ ...journal, steps: [{ name: 'pii_access_control', phase: 'pending' }] });
  const expected = blob(journal);
  const api = (endpoint, method = 'GET', body) => {
    calls.push({ endpoint, method });
    if (method === 'PUT') {
      assert.equal(body.sha, old.sha);
      assert.equal(body.content, expected.content);
      return { commit: { sha: commit }, content: { sha: expected.sha } };
    }
    return endpoint.endsWith(`ref=${commit}`) ? expected : old;
  };
  assert.deepEqual(persistGroup2Journal(api, path, branch, old, journal, 'reload'), expected);
  assert.deepEqual(calls, [{ endpoint: path, method: 'PUT' }, { endpoint: `${path}?ref=${commit}`, method: 'GET' }]);
});
test('a mismatched committed journal blocks the next external operation', () => {
  const expected = blob(journal);
  let installs = 0;
  const api = (_endpoint, method) => method === 'PUT'
    ? { commit: { sha: commit }, content: { sha: expected.sha } }
    : blob({ ...journal, complete: true });
  assert.throws(() => {
    persistGroup2Journal(api, path, branch, null, journal, 'reload');
    installs += 1;
  }, /readback failed/);
  assert.equal(installs, 0);
});
test('unknown checkpoint write stops once and never retries', () => {
  let writes = 0;
  assert.throws(() => persistGroup2Journal(() => {
    writes += 1; throw new Error('lost acknowledgement');
  }, path, branch, null, journal, 'upgrade'), /lost acknowledgement/);
  assert.equal(writes, 1);
});
test('missing or foreign commit acknowledgements are refused before readback', () => {
  for (const response of [{}, { commit: { sha: commit }, content: { sha: 'c'.repeat(40) } }]) {
    let reads = 0;
    assert.throws(() => persistGroup2Journal((_endpoint, method) => {
      if (method === 'GET') reads += 1;
      return response;
    }, path, branch, null, journal, 'reload'), /acknowledgement invalid/);
    assert.equal(reads, 0);
  }
});