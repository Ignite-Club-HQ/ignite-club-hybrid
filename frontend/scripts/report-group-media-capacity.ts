/** Signed read-only report; no configuration, migration or activation calls. */
import { writeFileSync } from 'node:fs';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { DEPLOYED_MAINNET_CANISTER_IDS as LIVE } from '../src/live/generated/deployedCanisterIds';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import { idlFactory as storeIdl } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';

const [pem, output] = process.argv.slice(2);
if (!pem || !output) throw new Error('Usage: report-group-media-capacity <operator.pem> <report.json>');
const identity = loadOperatorIdentity(pem);
if (identity.getPrincipal().isAnonymous()) throw new Error('Authenticated operator required');
const agent = await HttpAgent.create({ host: 'https://ic0.app', identity });
type Registry = { Ok: { active: boolean; stores: { toText(): string }[] } } | { Err: string };
type Club = { read_media_quota_store_registry(): Promise<Registry>; media_quota_cutover_status(): Promise<unknown> };
type Router = { read_group_registry(alias: string): Promise<{ Ok: { revision: bigint; groups: unknown[] } } | { Err: string }> };
type Store = { get_usage(): Promise<unknown>; stable_storage_status(): Promise<unknown>; memory_stats(): Promise<unknown> };
const club = Actor.createActor(clubIdl, { agent, canisterId: LIVE.club_domain }) as unknown as Club;
const router = Actor.createActor(routerIdl, { agent, canisterId: LIVE.shard_router }) as unknown as Router;
const registry = await club.read_media_quota_store_registry();
if ('Err' in registry) throw new Error(registry.Err);
const groups = await router.read_group_registry('ic');
if ('Err' in groups) throw new Error(groups.Err);
const cutover = await club.media_quota_cutover_status();
// The primary is included even if shared registry hasn't been prepared yet;
// label provenance, never confuse this union with complete deployment proof.
const ids = [...new Set([LIVE.media_blob_store, ...registry.Ok.stores.map(p => p.toText())])];
if (ids.some(id => !id) || ids.length > 65) throw new Error('Invalid store inventory');
const stores = [];
for (const id of ids) {
  const actor = Actor.createActor(storeIdl, { agent, canisterId: id }) as unknown as Store;
  stores.push({ canisterId: id, registeredAtPrimaryAuthority: registry.Ok.stores.some(p => p.toText() === id),
    usage: await actor.get_usage(), stable: await actor.stable_storage_status(), memory: await actor.memory_stats() });
}
const report = { observedAtUtc: new Date().toISOString(), deployment: 'mainnet', primaryAuthority: LIVE.club_domain,
  registry: registry.Ok, groups: groups.Ok, cutover, stores, inventoryComplete: false,
  missing: ['Each group authority registry must be reconciled before declaring complete inventory',
    'Exact store quota mode and global pending bytes need authoritative protocol support',
    'Retained cross-store ledger baseline and mutation integration not activated',
    'Mainnet allocator pressure and larger-capacity acceptance remain unverified'] };
writeFileSync(output, JSON.stringify(report, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n');
console.log(`Read ${stores.length} store(s); no capacity or routing settings changed. Remaining evidence gaps are in the report.`);