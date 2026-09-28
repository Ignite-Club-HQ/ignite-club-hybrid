import { Actor, HttpAgent } from '../node_modules/@icp-sdk/core/lib/esm/agent/index.js';
import { idlFactory } from '../src/lab/bindings/notification_queue/declarations/notification_queue.did.js';
import { syntheticIdentity } from '../src/lab/syntheticIdentities.mjs';

const host = process.env.NOTIFY_HOST || 'http://127.0.0.1:4996';
const id = process.env.NOTIFY_ID;
if (!id) throw new Error('NOTIFY_ID is required');
const identity = syntheticIdentity('governor');
const agent = await HttpAgent.create({ host, identity, shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 });
const actor = Actor.createActor(idlFactory, { agent, canisterId: id });
const workerAIdentity = syntheticIdentity('club_admin');
const workerBAgent = await HttpAgent.create({ host, identity: syntheticIdentity('member'), shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 });
const workerB = Actor.createActor(idlFactory, { agent: workerBAgent, canisterId: id });
const workerAAgent = await HttpAgent.create({ host, identity: workerAIdentity, shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 });
const workerA = Actor.createActor(idlFactory, { agent: workerAAgent, canisterId: id });
const outsiderAgent = await HttpAgent.create({ host, identity: syntheticIdentity('outsider'), shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 });
const outsider = Actor.createActor(idlFactory, { agent: outsiderAgent, canisterId: id });
const ok = result => { if ('Err' in result) throw Error(result.Err); return result.Ok; };
const rejected = async promise => {
  try {
    const result = await promise;
    if (!('Err' in result)) throw Error('expected worker rejection');
  } catch (error) {
    if (!String(error).includes('Worker capability required')) throw error;
  }
};
const leaseRejected = async promise => {
  const result = await promise;
  if (!('Err' in result) || result.Err !== 'Notification lease owner required') throw Error(`expected lease rejection, got ${JSON.stringify(result)}`);
};
const now = BigInt(Date.now());
const initialized = await actor.initialize();
if ('Err' in initialized && initialized.Err !== 'Already initialized') throw Error(initialized.Err);
ok(await actor.grant_worker(workerAIdentity.getPrincipal()));
ok(await actor.grant_worker(syntheticIdentity('member').getPrincipal()));
const prefix = `n-${Date.now()}`;
const firstId = `${prefix}-a`, secondId = `${prefix}-b`, firstKey = `${prefix}-key-a`, secondKey = `${prefix}-key-b`;
const a = ok(await actor.enqueue(firstId, 'user-a', 'club-a', 'event', 'hello', firstKey));
ok(await actor.enqueue(secondId, 'user-a', 'club-a', 'event', 'world', secondKey));
await rejected(outsider.claim(now, 1));
const claimed = ok(await workerA.claim(now, 1));
if (claimed.length !== 1 || claimed[0].attempts !== 1) throw Error('claim failed');
await leaseRejected(workerB.acknowledge(firstId, firstKey));
ok(await workerA.acknowledge(firstId, firstKey));
const retry = ok(await workerB.claim(now, 1));
if (retry.length !== 1) throw Error('second claim failed');
await leaseRejected(workerA.fail(retry[0].id, 'temporary', [now + 100n]));
ok(await workerB.fail(retry[0].id, 'temporary', [now + 100n]));
if ((await workerA.claim(now, 1)).Ok.length !== 0) throw Error('early retry');
const processing = ok(await workerA.claim(now + 100n, 1));
if (processing.length !== 1) throw Error('retry claim failed');
if (Number(ok(await actor.recover())) !== 1) throw Error('recovery failed');
console.log(JSON.stringify({ host, canisterId: id, first: a.id, recovered: (await actor.get_notification(processing[0].id))[0].status }, (_, value) => typeof value === 'bigint' ? Number(value) : value));
