/** Governor-only account access for one new group (g2 or later).
 * Asks the shared account service to add the group's exact 12 readers, which
 * it derives itself from two pinned router reads. Never upgrades the account
 * service, changes settings, opens the group or touches other groups. Safe to
 * re-run: an already-authorized group leaves the reader set unchanged.
 * Usage: tsx scripts/authorize-group-admission.ts <groupId> <approval.json> <operator.pem>
 * Needs the account service build that has authorize_group_admission. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import type { _SERVICE } from '../src/lab/bindings/shard_router/declarations/shard_router.did';
import { readPinnedGroupRegistry } from '../src/live/groupRegistryPager';
import { ADMISSION_DOMAINS, ADMISSION_FLAG, ADMISSION_AUTHORITY } from '../src/live/groupRemovalWiring';
import { IDENTITY, ROUTER, GOVERNOR } from '../../scripts/group2-admission-release-rules.mjs';
import { admissionTargets } from '../../scripts/add-group-plan.mjs';

const [groupId, approvalFile, pem] = process.argv.slice(2);
if (!groupId || !approvalFile || !pem) throw new Error('Usage: authorize-group-admission <groupId> <approval.json> <operator.pem>');
const ids = JSON.parse(readFileSync(new URL('../../deploy/mainnet/.icp/data/mappings/ic.ids.json', import.meta.url), 'utf8'));
if (ids.identity_access !== IDENTITY || ids.shard_router !== ROUTER) throw new Error('Pinned existing mainnet identity/router required');
const identity = loadOperatorIdentity(pem);
if (identity.getPrincipal().toText() !== GOVERNOR) throw new Error('Existing governor required');
const approval = JSON.parse(readFileSync(resolve(approvalFile), 'utf8'));
const provision = JSON.parse(readFileSync(resolve(approval.provisionFile), 'utf8'));
const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
const pid = (id: string) => Principal.fromText(id);
const ok = <T>(r: { Ok: T } | { Err: string }): T => { if ('Err' in r) throw new Error(r.Err); return r.Ok; };
const mgmt = (id: string) => Actor.createActor(() => IDL.Service({ canister_status: IDL.Func([IDL.Record({ canister_id: IDL.Principal })], [IDL.Record({
  status: IDL.Variant({ running: IDL.Null, stopped: IDL.Null, stopping: IDL.Null }), module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
  settings: IDL.Record({ controllers: IDL.Vec(IDL.Principal), environment_variables: IDL.Vec(IDL.Record({ name: IDL.Text, value: IDL.Text })) }) })], []) }),
  { agent, canisterId: 'aaaaa-aa', effectiveCanisterId: pid(id) } as Parameters<typeof Actor.createActor>[1]) as unknown as {
    canister_status(a: { canister_id: Principal }): Promise<{ status: Record<string, null>; module_hash: [] | [Uint8Array];
      settings: { controllers: Principal[]; environment_variables: { name: string; value: string }[] } }> };
const rows = IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text)), unit = IDL.Variant({ Ok: IDL.Null, Err: IDL.Text });
const bindingIdl = IDL.Record({ registry: IDL.Principal, registry_revision: IDL.Nat64, target_alias: IDL.Text, deployment_id: IDL.Text,
  deployment_revision: IDL.Nat64, host: IDL.Text, network_kind: IDL.Text });
const account = Actor.createActor(() => IDL.Service({ authorize_group_admission: IDL.Func([IDL.Text, bindingIdl], [unit], []),
  read_group_opening_configuration: IDL.Func([], [IDL.Variant({ Ok: rows, Err: IDL.Text })], []) }), { agent, canisterId: IDENTITY }) as unknown as {
    authorize_group_admission(g: string, b: unknown): Promise<{ Ok: null } | { Err: string }>;
    read_group_opening_configuration(): Promise<{ Ok: [string, string][] } | { Err: string }> };
const router = Actor.createActor<_SERVICE>(routerIdl, { agent, canisterId: ROUTER });
const registry = () => readPinnedGroupRegistry((rev, cursor, limit) => router.read_group_registry_page('mainnet', rev, cursor, limit));

const live = await registry();
const group = live.groups.find(g => g.id === groupId), placement = live.placements.find(p => p.group_id === groupId);
if (!group || !placement || placement.deployment_id !== 'mainnet' || placement.host !== 'https://icp-api.io' || placement.network_kind !== 'public_mainnet') {
  throw new Error(`Registered mainnet ${groupId} required before account access`);
}
const targets = admissionTargets(group, ADMISSION_DOMAINS);
for (const t of targets) {
  const provisionId = t.name === 'media_blob_store' ? provision.dedicatedBlobStore?.canisterId : provision.canisters?.[t.name];
  const approved = approval.services?.find((s: { name: string }) => s.name === t.name);
  const s = await mgmt(t.id).canister_status({ canister_id: pid(t.id) });
  const hash = Buffer.from(s.module_hash[0] ?? []).toString('hex');
  const get = (k: string) => { const hits = s.settings.environment_variables.filter(e => e.name === k); return hits.length === 1 ? hits[0].value : undefined; };
  if (t.id !== provisionId || approved?.canisterId !== t.id || approved.moduleHash !== hash || s.settings.controllers.length !== 1 ||
      s.settings.controllers[0].toText() !== GOVERNOR || !('running' in s.status) || get(ADMISSION_FLAG) !== '1' || get(ADMISSION_AUTHORITY) !== IDENTITY) {
    throw new Error(`Unverified ${groupId} destination: ${t.name}`);
  }
}
const already = ok(await account.read_group_opening_configuration());
const has = (id: string) => already.some(r => r[0] === 'eligibility_authority' && r[1] === id);
if (targets.every(t => has(t.id)) && already.some(r => r[0] === 'account_admission_released' && r[1] === 'true')) {
  console.log(`${groupId} account access already authorized; nothing changed.`);
  process.exit(0);
}
if ((await registry()).revision !== live.revision) throw new Error('Registry changed before admission authorization; re-run');
ok(await account.authorize_group_admission(groupId, { registry: pid(ROUTER), registry_revision: live.revision, target_alias: 'mainnet', deployment_id: 'mainnet',
  deployment_revision: placement.deployment_revision, host: 'https://icp-api.io', network_kind: 'public_mainnet' }));
const evidence = ok(await account.read_group_opening_configuration());
if (evidence.find(r => r[0] === 'account_admission_released')?.[1] !== 'true' || targets.some(t => !evidence.some(r => r[0] === 'eligibility_authority' && r[1] === t.id))) {
  throw new Error('Admission authorization readback failed');
}
console.log(`${groupId} account access authorized for its 12 services; other groups unchanged.`);
