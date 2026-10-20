// Removes finished isolated photo-store test canisters and returns their leftover fuel to the deploy key.
// Uses the pinned icp CLI (`canister delete` recovers liquid cycles via the cycles ledger).
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseRunIds, controllersFrom, assertRemovable, REMOVE_CONFIRM } from './remove-media-test-stores-policy.mjs';
import { DEPLOY_PRINCIPAL } from './media-card-funding-policy.mjs';
import { createJournalApi } from '../frontend/scripts/media-stage-two-github.mjs';

if (process.env.REMOVE_CONFIRM !== REMOVE_CONFIRM) throw new Error('Confirmation missing; nothing removed');
const runIds = parseRunIds(process.env.REMOVE_RUN_IDS);
const repo = process.env.GITHUB_REPOSITORY;
if (!repo || !process.env.GH_TOKEN) throw new Error('GitHub receipt access required');
const root = resolve(import.meta.dirname, '..');
const branch = 'ignite-media-test-receipts';
const api = createJournalApi(repo, x => JSON.stringify(x));

// Run outside the checkout: the repo-root icp.yaml makes the CLI load local-lab files and fail.
const icpCwd = mkdtempSync(join(tmpdir(), 'icp-no-project-'));
const icpEnv = { ...process.env, DO_NOT_TRACK: '1' };
function icp(args) {
  // Identity commands take no network flag; canister/cycles commands target mainnet.
  const r = spawnSync('icp', args[0] === 'identity' ? args : [...args, '-n', 'ic'], { encoding: 'utf8', cwd: icpCwd, env: icpEnv });
  if (r.status !== 0) throw new Error(`icp ${args[0]} ${args[1]} failed (exit ${r.status}): ${String(r.stderr).trim().split('\n').slice(-2).join(' ')}`);
  return r.stdout;
}
const who = icp(['identity', 'principal']).trim();
if (who !== DEPLOY_PRINCIPAL) throw new Error('Loaded key is not the deploy identity; nothing removed');

const protectedIds = new Set();
function collect(x) {
  if (typeof x === 'string' && /^[a-z0-9-]+-cai$/.test(x)) protectedIds.add(x);
  else if (x && typeof x === 'object') Object.values(x).forEach(collect);
}
function scan(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !e.name.startsWith('.')) scan(join(dir, e.name));
    else if (e.isFile() && e.name.endsWith('.json')) collect(JSON.parse(readFileSync(join(dir, e.name), 'utf8')));
  }
}
scan(join(root, 'deploy/groups')); scan(join(root, 'deploy/mainnet/.icp/data/mappings'));
collect(readFileSync(join(root, 'frontend/src/live/generated/deployedCanisterIds.ts'), 'utf8').match(/[a-z0-9]{5}(-[a-z0-9]{5}){3}-cai/g) ?? []);

const balance = () => icp(['cycles', 'balance']).trim();
console.log(`Deploy cycles balance before: ${balance()}`);
let failed = 0;
for (const runId of runIds) {
  try {
    const path = `deploy/media-tests/${runId}.json`;
    const entry = api(`contents/${path}?ref=${branch}`);
    const blob = api(`git/blobs/${entry.sha}`);
    const receipt = JSON.parse(Buffer.from(blob.content, 'base64').toString());
    if (receipt.removal?.phase === 'removed') { console.log(`${runId}: already removed`); continue; }
    const id = receipt.canisterId;
    if (receipt.removal?.phase === 'removing') {
      const gone = spawnSync('icp', ['canister', 'status', id, '--public', '-n', 'ic'], { encoding: 'utf8', cwd: icpCwd, env: icpEnv }).status !== 0;
      if (!gone) throw new Error(`${runId}: earlier removal interrupted and store still exists; check it manually`);
    } else {
      const controllers = controllersFrom(JSON.parse(icp(['canister', 'status', id, '--json'])));
      assertRemovable({ runId, receipt, controllers, deployPrincipal: DEPLOY_PRINCIPAL, protectedIds });
      receipt.removal = { phase: 'removing', at: new Date().toISOString() };
      let r = api(`contents/${path}`, 'PUT', { message: `Remove test store ${runId}: intent`, branch, sha: entry.sha,
        content: Buffer.from(JSON.stringify(receipt, null, 2) + '\n').toString('base64') });
      entry.sha = r.content.sha;
      icp(['canister', 'stop', id]);
      icp(['canister', 'delete', id]);
    }
    receipt.removal = { phase: 'removed', at: new Date().toISOString() };
    api(`contents/${path}`, 'PUT', { message: `Remove test store ${runId}: done`, branch, sha: entry.sha,
      content: Buffer.from(JSON.stringify(receipt, null, 2) + '\n').toString('base64') });
    console.log(`${runId}: removed ${id}; leftover fuel returned to deploy key`);
  } catch (e) { failed++; console.log(`${runId}: NOT removed — ${e.message}`); }
}
console.log(`Deploy cycles balance after: ${balance()}`);
if (failed) process.exit(1);
