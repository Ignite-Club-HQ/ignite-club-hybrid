import { Actor, HttpAgent } from '../node_modules/@icp-sdk/core/lib/esm/agent/index.js';
import { idlFactory } from '../src/lab/bindings/notification_queue/declarations/notification_queue.did.js';
import { syntheticIdentity } from '../src/lab/syntheticIdentities.mjs';
import { statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const host = process.env.NOTIFY_HOST ?? 'http://127.0.0.1:4943';
const count = Number(process.env.NOTIFY_COUNT ?? 25);
const cases = [
  ['rust', process.env.RUST_NOTIFY_ID, '../../target/wasm32-unknown-unknown/release/notification_queue.wasm'],
  ['motoko', process.env.MOTOKO_NOTIFY_ID, '../../.mops/.build/notification_queue.wasm'],
];
if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('NOTIFY_COUNT must be 1..100');
if (cases.some(([, id]) => !id)) throw new Error('RUST_NOTIFY_ID and MOTOKO_NOTIFY_ID are required');

const identity = syntheticIdentity('governor');
const agent = await HttpAgent.create({ host, identity, shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 });
const ok = (result) => { if ('Err' in result) throw new Error(result.Err); return result.Ok; };
const results = {};
for (const [name, id, wasmPath] of cases) {
  const actor = Actor.createActor(idlFactory, { agent, canisterId: id });
  const init = await actor.initialize();
  if ('Err' in init && init.Err !== 'Already initialized') throw new Error(`${name} initialize: ${init.Err}`);
  ok(await actor.grant_worker(identity.getPrincipal()));
  const prefix = `benchmark-${name}-${Date.now()}`;
  const enqueueStart = performance.now();
  for (let index = 0; index < count; index += 1) await actor.enqueue(`${prefix}-${index}`, 'benchmark-user', 'benchmark-club', 'benchmark', 'body', `${prefix}-key-${index}`);
  const enqueueMs = performance.now() - enqueueStart;
  const claimStart = performance.now();
  const claimed = ok(await actor.claim(BigInt(Date.now()), count));
  const claimMs = performance.now() - claimStart;
  const acknowledgeStart = performance.now();
  for (const notification of claimed) ok(await actor.acknowledge(notification.id, notification.idempotency_key));
  const acknowledgeMs = performance.now() - acknowledgeStart;
  results[name] = { canisterId: id, count, enqueueMs, claimMs, acknowledgeMs, wasmBytes: statSync(new URL(wasmPath, import.meta.url)).size };
}
console.log(JSON.stringify({ host, results }, null, 2));
