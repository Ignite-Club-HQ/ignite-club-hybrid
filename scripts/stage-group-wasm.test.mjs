import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { GROUP_BUILD_SERVICES, stageGroupWasm } from './stage-group-wasm.mjs';

const moduleBytes = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'group-wasm-'));
  const artifacts = join(root, '.icp', 'cache', 'artifacts');
  const destination = join(root, 'staged');
  mkdirSync(artifacts, { recursive: true });
  for (const name of GROUP_BUILD_SERVICES) writeFileSync(join(artifacts, name), moduleBytes);
  try { run({ root, artifacts, destination }); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('stages all 13 extensionless CLI final artifacts, including Rust timer_jobs', () => fixture(({ root, destination }) => {
  stageGroupWasm(root, destination);
  assert.equal(GROUP_BUILD_SERVICES.length, 13);
  for (const name of GROUP_BUILD_SERVICES) assert.deepEqual(readFileSync(join(destination, `${name}.wasm`)), moduleBytes);
}));
test('preserves compressed final output with the installer gzip extension', () => fixture(({ root, artifacts, destination }) => {
  const bytes = gzipSync(moduleBytes);
  writeFileSync(join(artifacts, 'timer_jobs'), bytes);
  stageGroupWasm(root, destination);
  assert.deepEqual(readFileSync(join(destination, 'timer_jobs.wasm.gz')), bytes);
}));
test('missing final artifact stops before staging any files', () => fixture(({ root, artifacts, destination }) => {
  rmSync(join(artifacts, 'media_blob_store'));
  assert.throws(() => stageGroupWasm(root, destination), /ENOENT/);
  assert.equal(existsSync(destination), false);
}));
test('empty final artifact stops before staging any files', () => fixture(({ root, artifacts, destination }) => {
  writeFileSync(join(artifacts, 'club_domain'), Buffer.alloc(0));
  assert.throws(() => stageGroupWasm(root, destination), /Invalid or empty build artifact for club_domain/);
  assert.equal(existsSync(destination), false);
}));