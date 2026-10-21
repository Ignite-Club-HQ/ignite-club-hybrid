/** Signed stop-only control: no owner approval, opening, funding or rewiring. */
import { readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { idlFactory } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import type { _SERVICE } from '../src/lab/bindings/shard_router/declarations/shard_router.did';
import { readPinnedGroupRegistry } from '../src/live/groupRegistryPager';

const [action, revisionText, pem, report] = process.argv.slice(2);
if (!['check', 'stop'].includes(action) || !pem || !report) throw new Error('Expected check|stop, revision, existing operator PEM and report');
if (action === 'stop' && (!/^\d+$/.test(revisionText) || process.env.CONFIRMATION?.trim() !== 'STOP GROUP 2 NEW CLUBS')) {
  throw new Error('Stop requires the checked revision and STOP GROUP 2 NEW CLUBS');
}
const ids = JSON.parse(readFileSync(new URL('../../deploy/mainnet/.icp/data/mappings/ic.ids.json', import.meta.url), 'utf8'));
const routerId = Principal.fromText(ids.shard_router).toText();
const identity = loadOperatorIdentity(pem);
if (identity.getPrincipal().toText() !== 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae') throw new Error('Existing deployment administrator required');
const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
const router = Actor.createActor<_SERVICE>(idlFactory, { agent, canisterId: routerId });
const ok = <T>(reply: { Ok: T } | { Err: string }): T => { if ('Err' in reply) throw new Error(reply.Err); return reply.Ok; };
const save = (data: unknown) => {
  mkdirSync(dirname(report), { recursive: true });
  const temp = `${report}.tmp`, fd = openSync(temp, 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify(data, (_, v) => typeof v === 'bigint' ? String(v) : v, 2)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, report);
  const dir = openSync(dirname(report), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
};
const read = () => readPinnedGroupRegistry((rev, cursor, limit) => router.read_group_registry_page('mainnet', rev, cursor, limit));
const registry = await read();
const group = registry.groups.find(g => g.id === 'g2');
if (!group) throw new Error('Group 2 is not registered; it cannot receive routed placements');
const trial = ok(await router.read_my_owner_test_opening('mainnet'))[0];
const trialAccepting = Boolean(trial?.approval.group.id === 'g2' && trial.accepting_new);
const before = { routerId, groupId: 'g2', revision: registry.revision, acceptingNewClubs: group.accepting || trialAccepting, assignedClubs: group.assigned_clubs };
save({ action, before });
if (action === 'check') {
  console.log(`Group 2 new clubs: ${before.acceptingNewClubs ? 'accepting' : 'stopped'}; checked revision: ${registry.revision}`);
} else {
  if (BigInt(revisionText) !== registry.revision) throw new Error('Revision changed; run check again and review before stopping');
  save({ action, before, pending: 'stop', expectedRevision: revisionText });
  const revision = ok(await router.stop_group_new_placements('g2', 'mainnet', registry.revision));
  const after = await read();
  const stopped = after.groups.find(g => g.id === 'g2');
  const trialAfter = ok(await router.read_my_owner_test_opening('mainnet'))[0];
  if (after.revision !== revision || !stopped || stopped.accepting || (trialAfter?.approval.group.id === 'g2' && trialAfter.accepting_new) || stopped.assigned_clubs !== group.assigned_clubs) {
    throw new Error('Stop readback changed or unavailable; reconcile the report, do not assume success');
  }
  save({ action, before, revision, stopped: true, assignedClubs: stopped.assigned_clubs });
  console.log('Group 2 new placements stopped. Existing clubs retain their assignments and access.');
}