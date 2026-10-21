import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function run(seed, principal, nodeExit = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'group-worker-'));
  const output = join(dir, 'environment');
  writeFileSync(join(dir, 'node'), `#!/bin/sh\n[ "$1" = scripts/push-worker-principal.mjs ] || exit 99\nprintf 'derived-worker-principal\\n'\nexit ${nodeExit}\n`, { mode: 0o755 });
  try {
    const result = spawnSync('bash', [resolve('scripts/resolve-group-push-worker.sh')], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ICP_PUSH_WORKER_SEED: seed, PUSH_WORKER_PRINCIPAL: principal, GITHUB_ENV: output },
    });
    return { ...result, environment: existsSync(output) ? readFileSync(output, 'utf8') : '' };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('existing delivery seed derives the worker and takes precedence over the variable', () => {
  const result = run('offline-test-seed', 'variable-worker');
  assert.equal(result.status, 0);
  assert.equal(result.environment, 'PUSH_WORKER_PRINCIPAL=derived-worker-principal\n');
  assert.equal(result.stdout.includes('offline-test-seed'), false);
});
test('explicit existing worker variable works without a seed', () => {
  const result = run('', 'variable-worker');
  assert.equal(result.status, 0);
  assert.equal(result.environment, 'PUSH_WORKER_PRINCIPAL=variable-worker\n');
});
test('missing worker settings fail without publishing an identity', () => {
  const result = run('', '');
  assert.equal(result.status, 1);
  assert.equal(result.environment, '');
  assert.match(result.stderr, /ICP_PUSH_WORKER_SEED repository secret/);
});
test('invalid seed derivation fails rather than falling back to another identity', () => {
  const result = run('invalid', 'variable-worker', 1);
  assert.equal(result.status, 1);
  assert.equal(result.environment, '');
});