// Two-phase disposable probe. Run with TIMER_PHASE=before, upgrade the canister,
// then run with TIMER_PHASE=after. No production endpoint is accepted.
import { Actor, HttpAgent } from '../node_modules/@icp-sdk/core/lib/esm/agent/index.js';
import { idlFactory } from '../src/lab/bindings/timer_jobs/declarations/timer_jobs.did.js';
import { syntheticIdentity } from '../src/lab/syntheticIdentities.mjs';
const host = process.env.TIMER_HOST || 'http://127.0.0.1:4995';
const id = process.env.TIMER_ID; const phase = process.env.TIMER_PHASE;
if (!id || !['before', 'after'].includes(phase)) throw new Error('Set TIMER_ID and TIMER_PHASE=before|after');
const identity = syntheticIdentity('governor');
const agent = await HttpAgent.create({ host, identity, shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 });
const actor = Actor.createActor(idlFactory, { agent, canisterId: id });
const ok = r => { if ('Err' in r) throw new Error(r.Err); return r.Ok; };
if (phase === 'before') {
  const initialized = await actor.initialize(); if ('Err' in initialized && initialized.Err !== 'Already initialized') throw new Error(initialized.Err);
  ok(await actor.grant_worker(identity.getPrincipal()));
  ok(await actor.grant_callback_scope(identity.getPrincipal(), 'club-a'));
  const now = BigInt(Date.now()); ok(await actor.schedule_with_callback('upgrade-job', 'club-a', [identity.getPrincipal()], now, 'upgrade-key')); await actor.arm(now + 1000n); ok(await actor.claim(now, 1));
  console.log(JSON.stringify({ phase, state: await actor.get_state(), job: await actor.get_job('upgrade-job') }, (_, v) => typeof v === 'bigint' ? Number(v) : v));
} else {
  const state = await actor.get_state(); if (!state.armed || !state.next_run_at_ms.length) throw new Error('schedule was not re-armed after upgrade');
  const recoveredResult = await actor.recover_interrupted();
  if ('Err' in recoveredResult) throw new Error(recoveredResult.Err);
  const recovered = Number(recoveredResult.Ok); if (recovered !== 1) throw new Error(`expected one recovered job, got ${recovered}`);
  const claimed = ok(await actor.claim(Number(state.next_run_at_ms[0]), 1)); if (claimed.length !== 1 || claimed[0].attempts !== 2) throw new Error('recovered job was not re-claimed');
  console.log(JSON.stringify({ phase, state, recovered, attempts: claimed[0].attempts }, (_, v) => typeof v === 'bigint' ? Number(v) : v));
}
