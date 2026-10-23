/** Operator-only consensus evidence. Does not configure, upgrade, place clubs,
 * grant access, store raw membership relationships or authorize cutover. */
import { readFileSync, writeFileSync } from 'node:fs';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { readPinnedGroupRegistry } from '../src/live/groupRegistryPager';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import type { _SERVICE as ClubService, Cursor } from '../src/lab/bindings/club_domain/declarations/club_domain.did';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import type { _SERVICE as RouterService } from '../src/lab/bindings/shard_router/declarations/shard_router.did';
import { checkLegacyOwnership } from '../../scripts/membership-legacy-ownership.mjs';
import { GROUP2_GOVERNOR } from '../../scripts/group2-upgrade-rules.mjs';

const [pem, output] = process.argv.slice(2);
if (!pem || !output) throw new Error('Existing governor key path and output path required');
const identity = loadOperatorIdentity(pem);
if (identity.getPrincipal().toText() !== GROUP2_GOVERNOR) throw new Error('Existing governor required');
const shared = JSON.parse(readFileSync(new URL('../../deploy/mainnet/.icp/data/mappings/ic.ids.json', import.meta.url), 'utf8'));
if (shared.club_domain !== 'mzzzv-taaaa-aaaal-qxlrq-cai' || shared.shard_router !== 'jcdfe-vqaaa-aaaal-qxloq-cai') throw new Error('Pinned original authority mapping required');
const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
const router = Actor.createActor<RouterService>(routerIdl, { agent, canisterId: shared.shard_router });
const actors = new Map<string, ClubService>();
const actor = (id: string) => {
  let service = actors.get(id);
  if (!service) { service = Actor.createActor<ClubService>(clubIdl, { agent, canisterId: id }); actors.set(id, service); }
  return service;
};
const unwrap = <T,>(r: { Ok: T } | { Err: string }): T => {
  if ('Err' in r) throw new Error(r.Err); return r.Ok;
};
type Source = { groupId: string; canisterId: string };
const report = await checkLegacyOwnership({
  async registry() {
    const snapshot = await readPinnedGroupRegistry((rev, cursor, limit) => router.read_group_registry_page('mainnet', rev, cursor, limit));
    const sources: Source[] = snapshot.groups.map(g => {
      const club = g.domains.find(d => d.domain === 'club_domain');
      const placement = snapshot.placements.find(p => p.group_id === g.id);
      if (!club || !placement || g.target_alias !== 'mainnet' || placement.deployment_id !== 'mainnet' ||
          placement.host !== 'https://icp-api.io' || placement.network_kind !== 'public_mainnet' ||
          placement.domains.find(d => d.domain === 'club_domain')?.canister.toText() !== club.canister.toText()) throw new Error('Exact registered club placement required');
      return { groupId: g.id, canisterId: club.canister.toText() };
    });
    // Original Group 1 predates registration. The original mapping is explicit,
    // not inferred from a missing club assignment or from the operator's names.
    const g1 = sources.find(s => s.groupId === 'g1');
    if (g1 && g1.canisterId !== shared.club_domain) throw new Error('Registered Group 1 differs from original authority');
    if (!g1) sources.push({ groupId: 'g1', canisterId: shared.club_domain });
    sources.sort((a, b) => a.groupId.localeCompare(b.groupId));
    return { sources, fingerprint: JSON.stringify(snapshot, (_, v) => typeof v === 'bigint' ? String(v) : v) };
  },
  read: (source: Source, cursor: Cursor | null) => actor(source.canisterId).read_membership_source_page(cursor ? [cursor] : []),
  async status(source: Source) { return unwrap(await actor(source.canisterId).read_membership_discovery_status()); },
});
// Only club IDs and source revision/count observations are emitted, never ACLs.
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log('Owner-named clubs cross-checked against all complete source exports; no ownership or readiness changes.');