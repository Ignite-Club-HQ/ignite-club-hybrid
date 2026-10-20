import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const workflow = readFileSync(new URL('../.github/workflows/fund-media-test-by-card.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('./create-media-test-card-link.mjs', import.meta.url), 'utf8');
test('funding is manual, serialized, pinned and uses temporary existing deploy identity', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /schedule:|icp deploy|test-media-stage-two-mainnet/);
  assert.match(workflow, /group: ignite-mainnet-governor-deployment/);
  assert.match(workflow, /icp-cli@1\.7\.0/);
  assert.match(workflow, /secrets\.DEPLOYER_PEM/);
  assert.match(workflow, /trap 'rm -rf "\$ICP_HOME"' EXIT/);
  assert.match(workflow, /cd "\$RUNNER_TEMP"/);
});
test('order intent is saved before card order creation and received link is not rewritten', () => {
  assert.match(runner, /state\.phase = 'creating-order'; save\(\);\s*const child = spawn/);
  assert.match(runner, /assertNoOpenPayment/);
  assert.match(runner, /--cycles', plan\.shortfallCycles/);
  assert.match(runner, /PAY BY CARD: \$\{message\.checkout_url\}/);
  assert.match(runner, /state\.balanceAfter = balance\(\)\.toString\(\)/);
  assert.doesNotMatch(runner, /canister.*top-up|--amount|icp deploy/);
});