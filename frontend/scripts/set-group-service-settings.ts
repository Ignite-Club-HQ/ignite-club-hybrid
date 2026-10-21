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
import { IDL } from '@icp-sdk/core/candid';
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

const ids = JSON.parse(readFileSync(new URL('../../deploy/mainnet/.icp/data/mappings/ic.ids.json', import.meta.url), 'utf8'));
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
type Mgmt = {
  canister_status(a: { canister_id: Principal }): Promise<{ status: Record<string, null>; settings: { controllers: Principal[]; environment_variables: { name: string; value: string }[] } }>;
  update_settings(a: { canister_id: Principal; settings: { environment_variables: [] | [{ name: string; value: string }[]] } }): Promise<void>;
};
/** The management canister must be addressed via the target's subnet:
 * pass effectiveCanisterId, else the boundary returns canister_not_found. */
const mgmtFor = (id: string) => Actor.createActor(mgmtIdl, {
  agent, canisterId: 'aaaaa-aa', effectiveCanisterId: Principal.fromText(id),
} as Parameters<typeof Actor.createActor>[1]) as unknown as Mgmt;
const pid = (id: string) => Principal.fromText(id);
const envOf = async (id: string) => (await mgmtFor(id).canister_status({ canister_id: pid(id) })).settings.environment_variables;
/** environment_variables is a replace-all setting: always merge over the
 * current list so existing settings (e.g. worker principals) survive. */
const setEnv = async (id: string, patch: Record<string, string>) => {
  const map = new Map((await envOf(id)).map(e => [e.name, e.value]));
  for (const [k, v] of Object.entries(patch)) map.set(k, v);
  await mgmtFor(id).update_settings({ canister_id: pid(id), settings: { environment_variables: [[...map].map(([name, value]) => ({ name, value }))] } });
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
// Shared account-service link required by the opening check: the router names
// identity_access as its deletion authority, identity_access releases the bound
// deletion protocol and pins this exact router deployment, and each group's
// club authority names the shared identity. Every write is skipped when the
// value is already correct and verified by consensus readback afterwards.
const readConfig = async (id: string): Promise<[string, string][] | string> => {
  const rows = IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text));
  const a = Actor.createActor(() => IDL.Service({ read_group_opening_configuration: IDL.Func([], [IDL.Variant({ Ok: rows, Err: IDL.Text })], []) }),
    { agent, canisterId: pid(id) }) as unknown as { read_group_opening_configuration(): Promise<{ Ok: [string, string][] } | { Err: string }> };
  const r = await a.read_group_opening_configuration();
  return 'Ok' in r ? r.Ok : r.Err;
};
const readRows = async (id: string): Promise<[string, string][]> => {
  const rows = IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text));
  const a = Actor.createActor(() => IDL.Service({ read_group_opening_configuration: IDL.Func([], [rows], []) }),
    { agent, canisterId: pid(id) }) as unknown as { read_group_opening_configuration(): Promise<[string, string][]> };
  return a.read_group_opening_configuration();
};
const val = (rows: [string, string][] | string, k: string) => typeof rows === 'string' ? undefined : rows.find(r => r[0] === k)?.[1];
const unit = IDL.Variant({ Ok: IDL.Null, Err: IDL.Text });
const linker = (id: string) => Actor.createActor(() => IDL.Service({
  set_deletion_authority: IDL.Func([IDL.Principal], [unit], []),
  pin_owner_test_deletion_registry: IDL.Func([IDL.Record({ registry: IDL.Principal, registry_revision: IDL.Nat64, target_alias: IDL.Text,
    deployment_id: IDL.Text, deployment_revision: IDL.Nat64, host: IDL.Text, network_kind: IDL.Text })], [unit], []),
  set_owner_test_deletion_identity: IDL.Func([IDL.Principal], [unit], []),
}), { agent, canisterId: pid(id) }) as unknown as Record<string, (...a: unknown[]) => Promise<{ Ok: null } | { Err: string }>>;

save({ ...report, pending: { phase: 'account-service-link' } });
const link: Record<string, string> = {};
if ((await envOf(identityAccess)).find(e => e.name === 'IGNITE_BOUND_DELETION_RELEASE')?.value !== '1') {
  await setEnv(identityAccess, { IGNITE_BOUND_DELETION_RELEASE: '1' }); link.deletionRelease = 'set';
} else link.deletionRelease = 'already set';
if ((await envOf(identityAccess)).find(e => e.name === 'IGNITE_BOUND_DELETION_RELEASE')?.value !== '1') throw new Error('Account service deletion release readback failed');
const routerAuthority = val(await readConfig(routerId), 'deletion_authority');
if (!routerAuthority) { ok(await linker(routerId).set_deletion_authority(pid(identityAccess))); link.routerAuthority = 'set'; }
else if (routerAuthority !== identityAccess) throw new Error(`Router deletion authority is bound to ${routerAuthority}, not the account service; stop and review`);
else link.routerAuthority = 'already set';
if (val(await readConfig(identityAccess), 'registry') !== routerId) {
  ok(await linker(identityAccess).pin_owner_test_deletion_registry({ registry: pid(routerId), registry_revision: registry.revision, target_alias: 'mainnet',
    deployment_id: 'mainnet', deployment_revision: 1n, host: 'https://icp-api.io', network_kind: 'public_mainnet' }));
  link.registryPin = `pinned at revision ${registry.revision}`;
} else link.registryPin = 'already pinned';
for (const group of groups) {
  const club = group.domains.find(d => d.domain === 'club_domain')!.canister.toText();
  const bound = val(await readRows(club), 'identity_access');
  if (!bound) {
    const r = await linker(club).set_owner_test_deletion_identity(pid(identityAccess));
    if ('Err' in r && r.Err === 'Complete Group 2 placement binding required') throw new Error(`${group.id} club service has the placement settings saved but has not loaded them yet. Run "Upgrade Group 2 (closed)" with action reload and confirmation RELOAD GROUP 2 SETTINGS, then rerun settings.`);
    ok(r); link[`${group.id}ClubIdentity`] = 'set';
  }
  else if (bound !== identityAccess) throw new Error(`${group.id} club service is bound to another account service (${bound}); stop and review`);
  else link[`${group.id}ClubIdentity`] = 'already set';
  if (val(await readRows(club), 'identity_access') !== identityAccess) throw new Error(`${group.id}: club identity readback failed`);
}
const idCfg = await readConfig(identityAccess);
if (val(await readConfig(routerId), 'deletion_authority') !== identityAccess || val(idCfg, 'registry') !== routerId ||
    val(idCfg, 'network_kind') !== 'public_mainnet' || val(idCfg, 'bound_deletion_released') !== 'true') {
  throw new Error(`Account service link readback failed: ${typeof idCfg === 'string' ? idCfg : JSON.stringify(idCfg)}`);
}
save({ ...report, link, pending: undefined });
console.log(`Account service linked: ${JSON.stringify(link)}`);
console.log('All requested groups configured. Run check next.');
