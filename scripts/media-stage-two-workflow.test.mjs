import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const workflow = readFileSync(new URL('../.github/workflows/test-media-large-store-mainnet.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../frontend/scripts/test-media-stage-two-mainnet.ts', import.meta.url), 'utf8');
test('runner temporary directory is resolved only in step context, not job environment', () => {
  const jobEnvironment = workflow.split('    env:\n')[1]?.split('    steps:\n')[0];
  assert.ok(jobEnvironment);
  assert.doesNotMatch(jobEnvironment, /\$\{\{\s*runner\./);
  const paidStep = workflow.split('- name: Run one separate paid test store')[1]?.split('- name: Remove signing key')[0];
  assert.ok(paidStep);
  assert.match(paidStep, /TEST_REPORT_DIR: \$\{\{ runner\.temp \}\}\/media-stage-two/);
});
test('workflow is manual, pinned and serialized with governor deployments', () => {
  assert.match(workflow, /workflow_dispatch:/); assert.doesNotMatch(workflow, /schedule:/);
  assert.match(workflow, /@icp-sdk\/icp-cli@1\.7\.0/);
  assert.match(workflow, /group: ignite-mainnet-governor-deployment/);
  assert.doesNotMatch(workflow, /icp deploy|install-group-closed|deploy-mainnet\.sh|npm ci/);
});
test('durable journal is persisted before work and unknown mutations cannot replay', () => {
  assert.match(runner, /state\.pending = .*await save\(\);\s*const result = await work\(\)/);
  assert.match(runner, /assertResume\(state, binding\)/);
  assert.match(runner, /Durable checkpoint read-back mismatch/);
  assert.doesNotMatch(runner, /set_club_domain_canister|registerGroup|enableGroup|enable_shared_media_quota|enable_retained_media_quota|LOCAL_REHEARSAL/);
});
test('upgrade explicitly preserves Wasm memory and never uses reinstall', () => {
  assert.match(runner, /wasm_memory_persistence: \[\{ keep: null \}\]/);
  assert.doesNotMatch(runner, /reinstall:|replace: null/);
});