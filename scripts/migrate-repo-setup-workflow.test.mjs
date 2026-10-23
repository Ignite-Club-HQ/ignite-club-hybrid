import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wf = readFileSync(new URL('../.github/workflows/migrate-repo-setup.yml', import.meta.url), 'utf8');

test('workflow is manual-only with exact confirmation gate', () => {
  assert.match(wf, /workflow_dispatch:/);
  assert.doesNotMatch(wf, /^\s+push:/m);
  assert.doesNotMatch(wf, /^\s+schedule:/m);
  assert.match(wf, /MIGRATE REPO SETUP/);
  assert.match(wf, /test "\$trimmed" = "MIGRATE REPO SETUP"/);
});

test('workflow requires a target PAT and never prints secret values', () => {
  assert.match(wf, /secrets\.TARGET_REPO_PAT/);
  assert.match(wf, /gh secret set "\$name" --repo "\$TARGET_REPO" --body -/);
  // Values must be piped via stdin, never echoed or passed as arguments.
  assert.doesNotMatch(wf, /echo "\$value"/);
  assert.doesNotMatch(wf, /--body "\$/);
});

test('workflow copies the three known secrets and supports extras', () => {
  for (const name of ['DEPLOYER_PEM', 'ICP_PUSH_WORKER_SEED', 'FCM_SERVICE_ACCOUNT_JSON']) {
    assert.match(wf, new RegExp(`secrets\\.${name}`));
  }
  assert.match(wf, /EXTRA_SECRET_NAMES/);
});

test('workflow refuses to target itself and rejects unsafe paths', () => {
  assert.match(wf, /target_repo must differ from this repo/);
  assert.match(wf, /Refusing unsafe path/);
});

test('workflow runs the compare report at the end', () => {
  assert.match(wf, /migrate-github-repo\.mjs compare/);
});
