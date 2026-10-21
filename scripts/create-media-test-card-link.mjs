import { spawnSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createJournalApi } from '../frontend/scripts/media-stage-two-github.mjs';
import { fundingPlan, parseBalance, assertNoOpenPayment } from './media-card-funding-policy.mjs';
import { prepareInfrastructure } from './infrastructure-card-funding.mjs';

// Mobile keyboards add surrounding spaces; trim only those, the exact value is still validated.
for (const k of ['PAYMENT_ID', 'CARD_CONFIRM', 'FUNDING_GROUP_ID', 'TOPUP_TARGET_T']) if (process.env[k] !== undefined) process.env[k] = process.env[k].trim();
const identity = 'ignite-card-deployer';
function cli(args) {
  const r = spawnSync('icp', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ICP ${args.slice(0, 2).join(' ')} failed; no automatic retry: ${(r.stderr || '').trim().slice(-400)}`);
  return r.stdout.trim();
}
function balance() { return parseBalance(cli(['cycles', 'balance', '-n', 'ic', '--identity', identity, '--json'])); }
if (['reconcile-paid', 'abandon-order', 'finish-interrupted'].includes(process.env.FUNDING_PURPOSE)) {
  const { reconcilePaidOrder } = await import('./reconcile-card-payment.mjs');
  await reconcilePaidOrder({ cli, identity, balance, abandon: process.env.FUNDING_PURPOSE === 'abandon-order',
    finish: process.env.FUNDING_PURPOSE === 'finish-interrupted' });
  process.exit(0);
}
const infrastructure = process.env.FUNDING_PURPOSE ? prepareInfrastructure({ cli, identity, balance }) : undefined;
const plan = infrastructure?.plan ?? fundingPlan({ paymentId: process.env.PAYMENT_ID, testId: process.env.TEST_RUN_ID,
  scenario: process.env.TEST_SCENARIO, budgetT: process.env.TEST_BUDGET_T, confirm: process.env.CARD_CONFIRM,
  principal: cli(['identity', 'principal', '--identity', identity]), balance: balance() });
if (!process.env.GITHUB_REPOSITORY || !process.env.GH_TOKEN || !process.env.FUNDING_REPORT_DIR || !process.env.GITHUB_STEP_SUMMARY) {
  throw new Error('GitHub journal, report directory and summary required');
}
const api = createJournalApi(process.env.GITHUB_REPOSITORY, JSON.stringify);
const branch = 'ignite-media-test-receipts';
const file = `deploy/media-funding/${plan.paymentId}.json`;
const refs = api(`git/matching-refs/heads/${branch}`);
if (!refs.some((r) => r.ref === `refs/heads/${branch}`)) {
  const base = api(`git/ref/heads/${api('').default_branch}`);
  api('git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: base.object.sha });
}
const inventory = api(`git/trees/${branch}?recursive=1`);
if (inventory.truncated) throw new Error('Incomplete funding inventory');
function read(path) {
  const entry = api(`contents/${path}?ref=${branch}`);
  const blob = api(`git/blobs/${entry.sha}`);
  if (blob.encoding !== 'base64') throw new Error('Unexpected receipt encoding');
  return Buffer.from(blob.content, 'base64').toString();
}
if (inventory.tree.some((e) => e.path === file)) throw new Error('Payment ID already exists; consult its receipt, never repeat it');
assertNoOpenPayment(inventory.tree.filter((e) => /^deploy\/media-funding\/[^/]+\.json$/.test(e.path)).map((e) => JSON.parse(read(e.path))));
mkdirSync(process.env.FUNDING_REPORT_DIR, { recursive: true });
let sha;
const state = { plan, phase: 'approved', createdAt: new Date().toISOString() };
function save() {
  const text = JSON.stringify(state, null, 2) + '\n';
  writeFileSync(join(process.env.FUNDING_REPORT_DIR, 'payment.json'), text);
  const result = api(`contents/${file}`, 'PUT', { message: `Card funding ${plan.paymentId}: ${state.phase}`,
    branch, content: Buffer.from(text).toString('base64'), ...(sha ? { sha } : {}) });
  sha = result.content.sha;
  if (read(file) !== text) throw new Error('Funding checkpoint read-back mismatch; never repeat order creation');
}
function summary(text) { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`); }
summary(`## Card funding for ${plan.scenario}: ${plan.testId}`);
summary(`Deploy identity: \`${plan.principal}\`. Target: ${plan.targetCycles} cycles (includes applicable ledger/creation fees).`);
for (const r of plan.topups ?? []) summary(`Planned top-up: **${r.name}** (${r.id}), current ${r.cycles} cycles, deposit ${r.amount} cycles.`);
summary(`Existing balance: ${plan.balanceBefore}; requested shortfall: ${plan.shortfallCycles} cycles.`);
summary('Checkout quotes USD/card fees; rate changes and delivery fees can affect delivered cycles. Group funding is initial fuel, not a guaranteed installation cost. Top-ups run only for the saved target list; lost replies block repeats.');
if (plan.shortfallCycles === '0') {
  state.phase = 'already-funded'; save(); summary('Already funded: no payment order created.');
} else {
  // Commit and read back intent BEFORE making the order. Unknown replies remain locked.
  state.phase = 'creating-order'; save();
  const child = spawn('icp', ['cycles', 'buy', '--cycles', plan.shortfallCycles, '-n', 'ic', '--identity', identity,
    '--gateway', '2bwus-iiaaa-aaaac-bee3a-cai', '--no-open', '--yes', '--json'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const lines = createInterface({ input: child.stdout });
  let failure;
  const closed = new Promise((resolve) => {
    child.on('error', (error) => { failure = error; resolve(null); });
    child.on('close', resolve);
  });
  lines.on('line', (line) => {
    if (failure) return;
    try {
      const message = JSON.parse(line);
      if (message.checkout_url) {
        const url = new URL(message.checkout_url);
        if (url.protocol !== 'https:' || !['buy.stripe.com', 'checkout.stripe.com'].includes(url.hostname)) throw new Error('Unexpected checkout host; consult the saved order');
        state.order = message; state.phase = 'checkout-ready'; save();
        // Preserve the returned URL verbatim, including underscores and order reference.
        summary(`### [Pay by card](${message.checkout_url})`);
        summary(`Order: \`${message.order_id}\`. Price: ${message.amount?.value} ${message.amount?.currency}; card fee: ${message.fee?.value} ${message.fee?.currency}; estimated cycles: ${message.estimated_cycles}.`);
        summary(`Expires: ${message.expires_at}. Open this link from the running job log now, or refresh the run summary. Do not create another order while waiting.`);
        console.log(`PAY BY CARD: ${message.checkout_url}`);
        console.log(`Order ${message.order_id}; quoted ${message.amount?.value} ${message.amount?.currency}. Waiting for delivery.`);
      } else if (message.status) {
        state.result = message; state.phase = message.status; save();
        summary(`Payment status: **${message.status}**; delivered cycles: ${message.cycles_delivered ?? 'not confirmed'}.`);
      }
    } catch (error) { failure = error; child.kill('SIGTERM'); }
  });
  const code = await closed;
  if (failure) throw failure;
  if (code !== 0 || state.phase !== 'delivered') {
    summary('Delivery not verified. Keep the existing link/order. Do not rerun to create another payment; reconcile its status first.');
    throw new Error('Card delivery unresolved; no automatic order replay');
  }
  state.balanceAfter = balance().toString();
  state.testReady = BigInt(state.balanceAfter) >= BigInt(plan.targetCycles); save();
  summary(state.testReady ? `Balance verified: ${state.balanceAfter} cycles.${infrastructure ? ' Continue with the approved funding purpose below.' : ` Start the ${plan.scenario} test separately with ID ${plan.testId} and the same funding ceiling.`}`
    : `Balance verified: ${state.balanceAfter} cycles, still below the target. No further operation started; review delivered amount before authorizing another purchase.`);
}
if (infrastructure) {
  if (balance() < BigInt(plan.targetCycles)) throw new Error('Insufficient delivered cycles; no further operation started');
  await infrastructure.finish({ state, save, summary });
} else if (plan.shortfallCycles === '0') summary('Start the test separately.');