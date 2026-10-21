/** Exact bounded opening evidence. The check report is not a grant:
 * only the governor-signed router opening call may authorize new placement. */
import { ADMISSION_FLAG } from './groupRemovalWiring';

export type ServiceCheck = { name: string; canisterId: string; subnetId: string; moduleHash: string };
export type ObservedService = ServiceCheck & { controllers: string[]; running: boolean; cycles: bigint; heapBytes: bigint;
  environment: { name: string; value: string }[]; configuration?: [string, string][] };
export type OwnerCheckSpec = { governor: string; owner?: string; routerId: string; targetAlias: string; deploymentId: string;
  host: string; revision: string; clubIds?: string[]; services: ServiceCheck[]; minCycles: string; heapBudgetBytes: string };
export function verifyOwnerOpeningChecks(spec: OwnerCheckSpec, observed: ObservedService[], group: {
  id: string; target_alias: string; accepting: boolean; domains: { domain: string; canister: { toText(): string } }[];
  photo_store: [] | [{ toText(): string }];
}, placement: { deployment_id: string; host: string; network_kind: string; domains: { domain: string; subnet: { toText(): string }; canister: { toText(): string } }[] }) {
  if (spec.owner !== undefined && (!spec.owner || ['2vxsx-fae', 'aaaaa-aa'].includes(spec.owner) || spec.owner === spec.governor)) throw new Error('Use your app sign-in principal, not the deploy identity');
  if (spec.clubIds !== undefined && (spec.clubIds.length < 1 || spec.clubIds.length > 10 || new Set(spec.clubIds).size !== spec.clubIds.length ||
      spec.clubIds.some(id => !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)))) throw new Error('Require 1-10 distinct test club UUIDs');
  if (group.id !== 'g2' || group.accepting || group.target_alias !== spec.targetAlias || placement.deployment_id !== spec.deploymentId ||
      placement.host !== spec.host || placement.network_kind !== 'public_mainnet' || !spec.host.startsWith('https://')) throw new Error('Exact closed Group 2 deployment required');
  const expected = group.domains.filter(d => d.domain !== 'secret_workload_identity').map(d => ({ name: d.domain, id: d.canister.toText(),
    subnet: placement.domains.find(p => p.domain === d.domain && p.canister.toText() === d.canister.toText())?.subnet.toText() }));
  const store = group.photo_store[0]?.toText();
  if (!store) throw new Error('Dedicated photo store required');
  expected.push({ name: 'media_blob_store', id: store, subnet: expected.find(d => d.name === 'club_domain')?.subnet });
  if (expected.length !== 13 || observed.length !== 13 || spec.services.length !== 13 || new Set(observed.map(s => s.canisterId)).size !== 13 ||
      new Set(spec.services.map(s => s.name)).size !== 13) throw new Error('Complete exact 13-service inventory required');
  for (const item of expected) {
    const approved = spec.services.find(s => s.name === item.name), actual = observed.find(s => s.name === item.name);
    if (!approved || !actual || !item.subnet || approved.canisterId !== item.id || approved.subnetId !== item.subnet ||
        actual.canisterId !== approved.canisterId || actual.subnetId !== approved.subnetId || actual.moduleHash !== approved.moduleHash ||
        !/^[a-f0-9]{64}$/i.test(approved.moduleHash) || !actual.running || actual.controllers.length !== 1 || actual.controllers[0] !== spec.governor ||
        actual.cycles < BigInt(spec.minCycles) || actual.heapBytes >= BigInt(spec.heapBudgetBytes)) throw new Error(`Unverified module/controller/subnet/health: ${item.name}`);
    // The account admission release switch (historical LOCAL_REHEARSAL name)
    // is the production cross-group lifecycle gate; any other flag stays forbidden.
    // The account admission release switch (historical LOCAL_REHEARSAL name)
    // is the production cross-group lifecycle gate; any other flag stays forbidden.
    if (actual.environment.some(e => e.name.endsWith('LOCAL_REHEARSAL') && e.value === '1' && e.name !== ADMISSION_FLAG)) throw new Error(`Rehearsal flag forbidden: ${item.name}`);
    if (item.name === 'club_domain') {
      const env = (key: string) => { const hits = actual.environment.filter(e => e.name === key); return hits.length === 1 ? hits[0].value : undefined; };
      if (env('IGNITE_NEW_CLUB_PLACEMENT_ROUTER') !== spec.routerId || env('IGNITE_NEW_CLUB_PLACEMENT_GROUP') !== 'g2' ||
          env('IGNITE_NEW_CLUB_PLACEMENT_TARGET') !== spec.targetAlias) throw new Error('Mandatory creator-placement binding missing');
    }
  }
  return { checked: true as const, authorizesOpening: false as const };
}

export function verifyOwnerReciprocalConfiguration(spec: OwnerCheckSpec & { identityAccess: string; pushWorker: string }, observed: ObservedService[],
  routerConfig: [string, string][], identityConfig: [string, string][]) {
  const id = (name: string) => spec.services.find(s => s.name === name)?.canisterId ?? '';
  const links: Record<string, string[]> = {
    club_domain: ['notification_queue', 'mini_league_domain', 'competition_domain', 'events_domain', 'messaging_domain', 'pii_access_control'],
    events_domain: ['club_domain', 'notification_queue', 'mini_league_domain', 'competition_domain'],
    messaging_domain: ['club_domain', 'notification_queue', 'competition_domain'], vault_domain: ['club_domain', 'competition_domain'],
    pii_access_control: ['club_domain', 'competition_domain'], competition_domain: ['club_domain', 'events_domain', 'vault_domain', 'pii_access_control'],
    mini_league_domain: ['club_domain', 'events_domain'], club_points_domain: ['club_domain'], media_blob_store: ['club_domain'],
    notification_queue: ['club_domain', 'messaging_domain'],
  };
  const value = (rows: [string, string][], key: string) => { const hits = rows.filter(r => r[0] === key); if (hits.length !== 1) throw new Error(`Missing/ambiguous configuration: ${key}`); return hits[0][1]; };
  for (const [name, peers] of Object.entries(links)) {
    const rows = observed.find(s => s.name === name)?.configuration;
    if (!rows) throw new Error(`Consensus configuration unavailable: ${name}`);
    for (const peer of peers) if (value(rows, peer) !== id(peer)) throw new Error(`Wrong reciprocal authority: ${name}.${peer}`);
  }
  const queue = observed.find(s => s.name === 'notification_queue')?.configuration ?? [];
  if (!spec.pushWorker) throw new Error('Opening approval notification worker missing');
  if (value(queue, 'identity_access') !== spec.identityAccess) throw new Error('Notification queue shared identity binding mismatch');
  if (!queue.some(r => r[0] === 'worker' && r[1] === spec.pushWorker)) throw new Error('Notification queue has not granted the expected delivery worker');
  const timer = observed.find(s => s.name === 'timer_jobs')?.configuration ?? [];
  if (!timer.some(r => r[0] === 'worker:*' && r[1] === spec.pushWorker)) throw new Error('Timer worker missing');
  const club = observed.find(s => s.name === 'club_domain')?.configuration ?? [];
  if (value(club, 'identity_access') !== spec.identityAccess || !club.some(r => r[0] === 'media_store' && r[1] === id('media_blob_store')) ||
      !club.some(r => r[0] === 'competition_authority' && r[1] === id('competition_domain'))) throw new Error('Club identity/store/competition authority missing');
  const competition = observed.find(s => s.name === 'competition_domain')?.configuration ?? [];
  if (!competition.some(r => r[0] === 'participant_club_authority' && r[1] === id('club_domain'))) throw new Error('Competition participant authority missing');
  if (value(routerConfig, 'deletion_authority') !== spec.identityAccess || value(identityConfig, 'registry') !== spec.routerId ||
      value(identityConfig, 'target_alias') !== spec.targetAlias || value(identityConfig, 'deployment_id') !== spec.deploymentId ||
      value(identityConfig, 'host') !== spec.host || value(identityConfig, 'network_kind') !== 'public_mainnet' ||
      value(identityConfig, 'bound_deletion_released') !== 'true') throw new Error('Bound deletion configuration is not ready');
}