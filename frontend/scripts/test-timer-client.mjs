// Disposable local-only probe for the typed timerJobsClient adapter.
import { Actor, HttpAgent } from '../node_modules/@icp-sdk/core/lib/esm/agent/index.js';
import { idlFactory } from '../src/lab/bindings/timer_jobs/declarations/timer_jobs.did.js';
import { syntheticIdentity } from '../src/lab/syntheticIdentities.mjs';
import { createTimerJobsClient } from '../src/lab/timerJobsClient.ts';

const host = process.env.TIMER_HOST || 'http://127.0.0.1:4993';
const canisterId = process.env.TIMER_ID;
if (!canisterId) throw new Error('TIMER_ID is required');
const agent = await HttpAgent.create({ host, identity: syntheticIdentity('anonymous'), shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 });
const actor = Actor.createActor(idlFactory, { agent, canisterId });
const client = createTimerJobsClient(actor);
const now = Date.now();
const scheduled = await client.schedule({ id: 'adapter-job', scope: 'club-a', runAtMs: now, idempotencyKey: 'adapter-key' });
if (scheduled.status !== 'pending' || scheduled.runAtMs !== now) throw new Error('Adapter schedule conversion failed');
const claimed = await client.claim(now, 1);
if (claimed.length !== 1 || claimed[0].status !== 'processing' || claimed[0].attempts !== 1) throw new Error('Adapter claim conversion failed');
const completed = await client.complete('adapter-job', 'adapter-key');
if (completed.status !== 'completed') throw new Error('Adapter completion conversion failed');
if ((await client.get('adapter-job'))?.status !== 'completed') throw new Error('Adapter query conversion failed');
console.log(JSON.stringify({ host, canisterId, id: completed.id, status: completed.status, attempts: completed.attempts }));
