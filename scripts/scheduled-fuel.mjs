// Workflow-only adapter. Never run as part of tests or imports.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { loadOperatorIdentity } from '../frontend/src/live/operatorTransport.ts';
import { idlFactory } from '../frontend/src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { createJournalApi } from '../frontend/scripts/media-stage-two-github.mjs';
import { planFuel, executeFuel } from './scheduled-fuel-policy.mjs';
import { parseBalance, DEPLOY_PRINCIPAL, assertNoOpenPayment } from './media-card-funding-policy.mjs';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { Actor, HttpAgent } = require('@icp-sdk/core/agent');
const { IDL } = require('@icp-sdk/core/candid');
const identity = loadOperatorIdentity(process.env.FUEL_PEM);
if (identity.getPrincipal().toText() !== DEPLOY_PRINCIPAL) throw Error('Wrong deploy identity');
const agent = await HttpAgent.create({ host: 'https://ic0.app', identity });
const mappings = require('../deploy/mainnet/.icp/data/mappings/ic.ids.json');
const router = Actor.createActor(idlFactory, { agent, canisterId: mappings.shard_router });
// Governor query includes ALL registered targets; never a saved subset of groups.
const result = await router.list_groups();
if (!('Ok' in result) || !result.Ok.length) throw Error('Incomplete group registry');
const targets = new Map();
for (const group of result.Ok) {
  if (group.domains.length !== 13 || !group.photo_store.length) throw Error('Incomplete registered service inventory');
  for (const d of group.domains) targets.set(d.canister.toText(), `${group.id}/${d.domain}`);
  targets.set(group.photo_store[0].toText(), `${group.id}/media_blob_store`);
}
const readings = [];
for (const [id, name] of targets) {
  const service = Actor.createActor(({ IDL }) => IDL.Service({ cycles_balance: IDL.Func([], [IDL.Nat], ['query']) }), { agent, canisterId: id });
  readings.push({ id, name, cycles: String(await service.cycles_balance()) });
}
function cli(args) {
  const r = spawnSync('icp', args, { encoding: 'utf8' });
  if (r.status !== 0) throw Error('CLI failed; no replay');
  return r.stdout.trim();
}
const api = createJournalApi(process.env.GITHUB_REPOSITORY, JSON.stringify);
const branch = 'ignite-media-test-receipts';
// Require existing receipt branch; never silently initialize missing accounting.
const tree = api(`git/trees/${branch}?recursive=1`);
if (tree.truncated) throw Error('Truncated receipt inventory');
function read(path) {
  const entry = api(`contents/${path}?ref=${branch}`);
  return JSON.parse(Buffer.from(entry.content, 'base64').toString());
}
assertNoOpenPayment(tree.tree.filter(e => /^deploy\/media-funding\/[^/]+\.json$/.test(e.path)).map(e => read(e.path)));
const records = tree.tree.filter(e => /^deploy\/scheduled-fuel\/[^/]+\.json$/.test(e.path)).map(e => read(e.path));
if (records.some(r => !['complete', 'planned'].includes(r.phase))) throw Error('Unresolved deposit: manual reconciliation required');
const month = new Date().toISOString().slice(0, 7);
const spent = records.filter(r => r.month === month).reduce((n, r) => n + BigInt(r.reserved ?? '0'), 0n);
const feeReply = cli(['canister', 'call', 'um5iw-rqaaa-aaaaq-qaaba-cai', 'icrc1_fee', '()', '-n', 'ic', '--identity', 'ignite-card-deployer', '--query']);
const fee = feeReply.match(/^\(\s*([\d_]+)\s*:\s*nat\s*\)\s*$/);
if (!fee) throw Error('Invalid ledger fee');
const plan = planFuel({ readings, spent: String(spent), ceiling: process.env.FUEL_MONTHLY_CEILING_CYCLES || '0', balance: String(parseBalance(cli(['cycles', 'balance', '-n', 'ic', '--identity', 'ignite-card-deployer', '--json']))), fee: fee[1].replaceAll('_', '') });
const text = `## Scheduled fuel plan\n${JSON.stringify(plan, null, 2)}\n`;
appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
if (plan.topups.length) api('issues', 'POST', { title: `Low group fuel: ${month} / run ${process.env.GITHUB_RUN_ID}`, body: '```json\n' + JSON.stringify(plan, null, 2) + '\n```' });
const file = `deploy/scheduled-fuel/${process.env.GITHUB_RUN_ID}.json`;
if (tree.tree.some(e => e.path === file)) throw Error('Run already journaled; no replay');
let sha;
const state = { phase: 'planned', month, principal: DEPLOY_PRINCIPAL, plan };
async function save() {
  const content = JSON.stringify(state);
  const r = api(`contents/${file}`, 'PUT', { branch, message: `Fuel ${process.env.GITHUB_RUN_ID}: ${state.phase}`, content: Buffer.from(content).toString('base64'), ...(sha ? { sha } : {}) });
  sha = r.content.sha;
  if (JSON.stringify(read(file)) !== content) throw Error('Receipt read-back failed');
}
await save();
await executeFuel({ plan, state, save, transfer: async (id, amount) => cli(['canister', 'top-up', id, '--amount', amount, '-n', 'ic', '--identity', 'ignite-card-deployer']) });
