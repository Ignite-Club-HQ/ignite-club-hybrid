/** Governor-signed service settings for general group routing.
 * Two phases with readback between each: (1) bind every admission service and
 * the photo store to the shared identity authority, verify; (2) switch on the
 * account admission release flag, verify. Also sets the creator placement
 * binding (router/group/target) on each group's club_domain so direct creation
 * goes through the router. Never installs, upgrades, funds or opens anything.
 * Usage: tsx scripts/set-group-service-settings.ts <group_ids> <operator.pem> <report.json>
 * Env: CONFIRMATION=SET SERVICE SETTINGS */
import { readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { idlFactory } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import type { _SERVICE } from '../src/lab/bindings/shard_router/declarations/shard_router.did';
import { readPinnedGroupRegistry } from '../src/live/groupRegistryPager';
import { ADMISSION_DOMAINS, ADMISSION_FLAG, ADMISSION_AUTHORITY } from '../src/live/groupRemovalWiring';

const GOVERNOR = 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae';

const [groupIdsArg, pem, reportPath] = process.argv.slice(2);
if (!groupIdsArg || !pem || !reportPath) throw new Error('Usage: set-group-service-settings <group_ids> <operator.pem> <report.json>');
if (process.env.CONFIRMATION?.trim() !== 'SET SERVICE SETTINGS') throw new Error('Exact confirmation SET SERVICE SETTINGS required');
const wanted = groupIdsArg.split(',').map(s => s.trim()).filter(Boolean);
if (!wanted.length || wanted.some(id => !/^[a-z0-9-]{1,32}$/.test(id))) throw new Error('Invalid group id list');

const ids = JSON.parse(readFileSync(resolve('deploy/mainnet/.icp/data/mappings/ic.ids.json'), 'utf8'));
const routerId = ids.shard_router as string, identityAccess = ids.identity_access as string;
if (!routerId || !identityAccess) throw new Error('Shared router/identity mappings missing');
const identity = loadOperatorIdentity(pem);
if (identity.getPrincipal().toText() !== GOVERNOR) throw new Error('Existing deployment administrator required');
const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
const router = Actor.createActor<_SERVICE>(idlFactory, { agent, canisterId: Principal.fromText(routerId) });
const ok = <T>(reply: { Ok: T } | { Err: string }): T => { if ('Err' in reply) throw new Error(reply.Err); return reply.Ok; };

const save = (data: unknown) => {
  mkdirSync(dirname(reportPath), { recursive: true });
  const temp = `${reportPath}.tmp`, fd = openSync(temp, 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify(data, (_, v) => typeof v === 'bigint' ? String(v) : v, 2)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, reportPath);
  const dir = openSync(dirname(reportPath), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
};

const mgmtIdl = ({ IDL: I }: { IDL: typeof IDL }) => I.Service({
  canister_status: I.Func([I.Record({ canister_id: I.Principal })], [I.Record({
    status: I.Variant({ running: I.Null, stopped: I.Null, stopping: I.Null }),
    settings: I.Record({ controllers: I.Vec(I.Principal), environment_variables: I.Vec(I.Record({ name: I.Text, value: I.Text })) }) })], []),
  update_settings: I.Func([I.Record({ canister_id: I.Principal, settings: I.Record({ environment_variables: I.Opt(I.Vec(I.Record({ name: I.Text, value: I.Text }))) }) })], [], []),
});
const mgmt = Actor.createActor(mgmtIdl, { agent, canisterId: 'aaaaa-aa' }) as unknown as {
  canister_status(a: { canister_id: Principal }): Promise<{ status: Record<string, null>; settings: { controllers: Principal[]; environment_variables: { name: string; value: string }[] } }>;
  update_settings(a: { canister_id: Principal; settings: { environment_variables: { name: string; value: string }[] } }): Promise<void>;
};
const pid = (id: string) => Principal.fromText(id);
const envOf = async (id: string) => (await mgmt.canister_status({ canister_id: pid(id) })).settings.environment_variables;
/** environment_variables is a replace-all setting: always merge over the
 * current list so existing settings (e.g. worker principals) survive. */
const setEnv = async (id: string, patch: Record<string, string>) => {
  const map = new Map((await envOf(id)).map(e => [e.name, e.value]));
  for (const [k, v] of Object.entries(patch)) map.set(k, v);
  await mgmt.update_settings({ canister_id: pid(id), settings: { environment_variables: [...map].map(([name, value]) => ({ name, value })) } });
};

const registry = await readPinnedGroupRegistry((rev, cursor, limit) => router.read_group_registry_page('mainnet', rev, cursor, limit));
const groups = registry.groups.filter(g => wanted.includes(g.id));
if (groups.length !== wanted.length) throw new Error(`Unknown group id(s): ${wanted.filter(w => !registry.groups.some(g => g.id === w)).join(', ')}`);
const report: Record<string, unknown> = { identityAccess, routerId, groups: [] };

for (const group of groups) {
  const domains = group.domains.map(d => ({ domain: d.domain, id: d.canister.toText() }));
  const photoStore = group.photo_store[0]?.toText();
  const targets: { label: string; id: string }[] = ADMISSION_DOMAINS
    .map(d => ({ label: d, id: domains.find(x => x.domain === d)?.id }))
    .filter((t): t is { label: string; id: string } => Boolean(t.id));
  if (targets.length !== ADMISSION_DOMAINS.length || !photoStore) throw new Error(`Group ${group.id} inventory incomplete`);
  targets.push({ label: 'photo store', id: photoStore });
  const entry: Record<string, unknown> = { groupId: group.id, targets: [] };

  // Phase 1: bind every admission target to the shared identity authority...
  save({ ...report, pending: { phase: 'identity-binding', groupId: group.id } });
  for (const t of targets) await setEnv(t.id, { [ADMISSION_AUTHORITY]: identityAccess });
  for (const t of targets) {
    const value = (await envOf(t.id)).find(e => e.name === ADMISSION_AUTHORITY)?.value;
    if (value !== identityAccess) throw new Error(`${group.id}/${t.label}: identity binding readback failed`);
    (entry.targets as unknown[]).push({ label: t.label, id: t.id, identityBinding: value });
  }
  // ...verify, then switch the release flag on...
  save({ ...report, pending: { phase: 'admission-flag', groupId: group.id } });
  for (const t of targets) await setEnv(t.id, { [ADMISSION_FLAG]: '1' });
  for (const t of targets) {
    const value = (await envOf(t.id)).find(e => e.name === ADMISSION_FLAG)?.value;
    if (value !== '1') throw new Error(`${group.id}/${t.label}: admission flag readback failed`);
  }
  // ...then the creator placement binding on the group's club authority.
  const clubDomain = domains.find(d => d.domain === 'club_domain');
  if (!clubDomain) throw new Error(`Group ${group.id} has no club_domain`);
  save({ ...report, pending: { phase: 'creator-binding', groupId: group.id } });
  await setEnv(clubDomain.id, { IGNITE_NEW_CLUB_PLACEMENT_ROUTER: routerId, IGNITE_NEW_CLUB_PLACEMENT_GROUP: group.id, IGNITE_NEW_CLUB_PLACEMENT_TARGET: 'mainnet' });
  const clubEnv = await envOf(clubDomain.id);
  const binding = Object.fromEntries(clubEnv.map(e => [e.name, e.value]));
  if (binding.IGNITE_NEW_CLUB_PLACEMENT_ROUTER !== routerId || binding.IGNITE_NEW_CLUB_PLACEMENT_GROUP !== group.id ||
      binding.IGNITE_NEW_CLUB_PLACEMENT_TARGET !== 'mainnet') throw new Error(`${group.id}: creator placement binding readback failed`);
  (entry as Record<string, unknown>).creatorBinding = 'set';
  (entry as Record<string, unknown>).clubDomainId = clubDomain.id;
  save({ ...report, groups: [...(report.groups as unknown[]), entry], pending: undefined });
  console.log(`Group ${group.id}: identity binding, admission release and creator binding set and verified.`);
}
console.log('All requested groups configured. Run the routing snapshot next.');
