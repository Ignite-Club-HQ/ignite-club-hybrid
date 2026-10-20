import test from 'node:test';
import assert from 'node:assert/strict';
import { createJournalApi } from './media-stage-two-github.mjs';

test('repository metadata GET has no trailing slash', () => {
  const api = createJournalApi('owner/repository', JSON.stringify, (command, args) => {
    assert.equal(command, 'gh');
    assert.deepEqual(args, ['api', 'repos/owner/repository', '--method', 'GET']);
    return { status: 0, stdout: '{"default_branch":"main"}' };
  });
  assert.equal(api('').default_branch, 'main');
});

test('journal subpaths and checkpoint bodies remain unchanged', () => {
  const api = createJournalApi('owner/repository', JSON.stringify, (_command, args, options) => {
    assert.deepEqual(args, ['api', 'repos/owner/repository/contents/deploy/media-tests/run.json', '--method', 'PUT', '--input', '-']);
    assert.equal(options.input, '{"branch":"ignite-media-test-receipts"}');
    return { status: 0, stdout: '{"content":{"sha":"saved"}}' };
  });
  assert.equal(api('contents/deploy/media-tests/run.json', 'PUT', { branch: 'ignite-media-test-receipts' }).content.sha, 'saved');
});

test('failed GitHub request stops without replay or exposing process output', () => {
  let calls = 0;
  const api = createJournalApi('owner/repository', JSON.stringify, () => {
    calls += 1;
    return { status: 1, stderr: 'sensitive diagnostic', stdout: '' };
  });
  assert.throws(() => api(''), (error) => {
    assert.match(error.message, /GET repos\/owner\/repository, exit 1/);
    assert.match(error.message, /no paid replay permitted/);
    assert.doesNotMatch(error.message, /sensitive diagnostic/);
    return true;
  });
  assert.equal(calls, 1);
});