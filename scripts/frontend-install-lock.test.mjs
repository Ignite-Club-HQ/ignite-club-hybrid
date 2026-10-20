import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isInstallLockAbandoned } from './frontend-install-lock.mjs';

function withLock(run) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'install-lock-test-'));
  try { run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('a killed installer releases its lock without a ten-minute wait', () => withLock(directory => {
  writeFileSync(path.join(directory, 'owner.pid'), '123');
  assert.equal(isInstallLockAbandoned(directory, Date.now(), pid => pid !== 123), true);
}));

test('a live installer cannot be displaced even after ten minutes', () => withLock(directory => {
  writeFileSync(path.join(directory, 'owner.pid'), String(process.pid));
  assert.equal(isInstallLockAbandoned(directory, Date.now() + 20 * 60_000), false);
}));

test('an ownerless legacy lock expires but a newly created lock is protected', () => withLock(directory => {
  assert.equal(isInstallLockAbandoned(directory), false);
  assert.equal(isInstallLockAbandoned(directory, Date.now() + 31_000), true);
}));