// Disposable local-only Candid gate for the timer_jobs canister.
import { Actor, HttpAgent } from '../node_modules/@icp-sdk/core/lib/esm/agent/index.js';
import { idlFactory } from '../src/lab/bindings/timer_jobs/declarations/timer_jobs.did.js';
import { syntheticIdentity } from '../src/lab/syntheticIdentities.mjs';

const host = process.env.TIMER_HOST || 'http://127.0.0.1:4993';
const canisterId = process.env.TIMER_ID;
if (!canisterId) throw new Error('TIMER_ID is required; point this gate at a disposable local canister');

const agent = await HttpAgent.create({ host, identity: syntheticIdentity('governor'), shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 });
const actor = Actor.createActor(idlFactory, { agent, canisterId });
const now = BigInt(Date.now());
const check = (condition, message) => { if (!condition) throw new Error(message); };
const ok = (result, label) => { check('Ok' in result, `${label}: ${'Err' in result ? result.Err : 'unknown error'}`); return result.Ok; };

const identity = syntheticIdentity('governor');
const initialized = await actor.initialize();
if ('Err' in initialized && initialized.Err !== 'Already initialized') throw new Error(initialized.Err);
ok(await actor.grant_worker(identity.getPrincipal()), 'grant timer worker');

const first = ok(await actor.schedule('timer-a', 'email', now, 'key-a'), 'schedule timer-a');
const second = ok(await actor.schedule('timer-b', 'email', now, 'key-b'), 'schedule timer-b');
const future = ok(await actor.schedule('timer-future', 'email', now + 60_000n, 'key-future'), 'schedule future');
check(first.status.Pending !== undefined && second.status.Pending !== undefined, 'scheduled jobs must be pending');
const armed = ok(await actor.arm(now + 1_000n), 'arm queue');
check(armed.armed && armed.next_run_at_ms[0] === now + 1_000n, 'arm state mismatch');

const claimed = ok(await actor.claim(now, 1), 'claim first');
check(claimed.length === 1 && claimed[0].attempts === 1, 'claim limit/attempt mismatch');
const completed = ok(await actor.complete(claimed[0].id, claimed[0].idempotency_key), 'complete first');
const repeated = ok(await actor.complete(claimed[0].id, claimed[0].idempotency_key), 'repeat complete');
check(completed.status.Completed !== undefined && repeated.status.Completed !== undefined, 'completion must be idempotent');

const retryClaim = ok(await actor.claim(now, 1), 'claim retry candidate');
check(retryClaim.length === 1, 'second due job was not claimed');
const retryAt = now + 10_000n;
ok(await actor.fail(retryClaim[0].id, 'transient', [retryAt]), 'fail for retry');
check((await actor.claim(now, 1)).Ok.length === 0, 'retry job claimed before retry time');
const retried = ok(await actor.claim(retryAt, 1), 'claim retry');
check(retried.length === 1 && retried[0].attempts === 2, 'retry attempt mismatch');
ok(await actor.complete(retried[0].id, retried[0].idempotency_key), 'complete retry');

const recoveredClaim = ok(await actor.claim(now + 60_000n, 1), 'claim future');
check(recoveredClaim.length === 1 && recoveredClaim[0].id === future.id, 'future job not claimed');
check(Number(ok(await actor.recover_interrupted(), 'recover interrupted')) === 1, 'processing recovery count mismatch');
const recovered = ok(await actor.claim(now + 60_000n, 1), 'reclaim interrupted');
check(recovered.length === 1 && recovered[0].attempts === 2, 'recovered attempt mismatch');

const page = ok(await actor.list_jobs([], 10), 'list jobs');
check(page.jobs.length === 3, 'expected three durable jobs');
const snapshot = ok(await actor.export_state(), 'export state');
const reconciliation = ok(await actor.reconcile(snapshot), 'reconcile state');
check(reconciliation.local_jobs === reconciliation.incoming_jobs && reconciliation.matching_jobs === reconciliation.local_jobs, 'snapshot reconciliation mismatch');
check('Err' in await actor.import_state(snapshot), 'non-empty import must fail closed');
console.log(JSON.stringify({ host, canisterId, jobs: page.jobs.map(({ id, status, attempts }) => ({ id, status: Object.keys(status)[0], attempts: Number(attempts) })), reconciliation, state: await actor.get_state() }, (_key, value) => typeof value === 'bigint' ? Number(value) : value));
