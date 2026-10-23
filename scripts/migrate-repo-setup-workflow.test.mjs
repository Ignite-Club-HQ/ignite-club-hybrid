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

test('target protection: skip-if-exists is the default for secrets, variables and files', () => {
  // Default choice must be skip; overwrite must be an explicit opt-in.
  assert.match(wf, /default: skip/);
  assert.match(wf, /options: \[skip, overwrite\]/);
  // Every mutation path checks EXISTING_MODE before replacing.
  const overwriteChecks = wf.match(/EXISTING_MODE" != "overwrite"/g) ?? [];
  assert.ok(overwriteChecks.length >= 3, `expected >=3 skip guards, found ${overwriteChecks.length}`);
  assert.match(wf, /skip secret \$name: already exists on target/);
  assert.match(wf, /skip variable \$name: already exists on target/);
  assert.match(wf, /skip file \$rel: exists on target with different content/);
});

test('target protection: file staging is path-scoped, never git add -A', () => {
  assert.doesNotMatch(wf, /git add -A/);
  assert.match(wf, /git add -- \$paths_to_stage/);
  // No force-push or delete operations anywhere.
  assert.doesNotMatch(wf, /push --force/);
  assert.doesNotMatch(wf, /git push -f/);
  assert.doesNotMatch(wf, /gh secret delete/);
  assert.doesNotMatch(wf, /actions\/variables\/\$name" -X DELETE/);
});
