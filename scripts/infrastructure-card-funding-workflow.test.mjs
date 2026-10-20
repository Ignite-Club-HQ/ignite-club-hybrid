import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const workflow = readFileSync(new URL('../.github/workflows/fund-canisters-by-card.yml', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('./infrastructure-card-funding.mjs', import.meta.url), 'utf8');
test('card workflow is manual, serialized, pinned, no deploy and only temporary secrets', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /group: ignite-mainnet-governor-deployment/);
  assert.match(workflow, /icp-cli@1\.7\.0/);
  assert.match(workflow, /trap 'rm -rf "\$ICP_HOME"' EXIT/);
  assert.doesNotMatch(workflow, /schedule:|icp deploy|install-group-closed\.ts/);
  assert.match(workflow, /cd "\$RUNNER_TEMP"/);
});
test('fund execution balances through top-up, never ledger transfer or raw status logging', () => {
  assert.match(adapter, /'canister', 'top-up', id, '--amount', amount, '-n', 'ic'/);
  assert.match(adapter, /icrc1_fee/);
  assert.doesNotMatch(adapter, /'cycles', 'transfer'|console\.log/);
});