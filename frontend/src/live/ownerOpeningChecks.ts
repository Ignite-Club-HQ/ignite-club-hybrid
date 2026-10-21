/** Exact bounded owner-opening evidence. The check report is not a grant:
 * only the governor-signed router opening call may authorize new placement. */
export type ServiceCheck = { name: string; canisterId: string; subnetId: string; moduleHash: string };
export type ObservedService = ServiceCheck & { controllers: string[]; running: boolean; cycles: bigint; heapBytes: bigint;
  environment: { name: string; value: string }[] };
export type OwnerCheckSpec = { governor: string; owner: string; routerId: string; targetAlias: string; deploymentId: string;
  host: string; revision: string; clubIds: string[]; services: ServiceCheck[]; minCycles: string; heapBudgetBytes: string };
export function verifyOwnerOpeningChecks(spec: OwnerCheckSpec, observed: ObservedService[], group: {
  id: string; target_alias: string; accepting: boolean; domains: { domain: string; canister: { toText(): string } }[];
  photo_store: [] | [{ toText(): string }];
}, placement: { deployment_id: string; host: string; network_kind: string; domains: { domain: string; subnet: { toText(): string }; canister: { toText(): string } }[] }) {
  if (!spec.owner || ['2vxsx-fae', 'aaaaa-aa'].includes(spec.owner) || spec.owner === spec.governor) throw new Error('Use your app sign-in principal, not the deploy identity');
  if (group.id !== 'g2' || group.accepting || group.target_alias !== spec.targetAlias || placement.deployment_id !== spec.deploymentId ||
      placement.host !== spec.host || placement.network_kind !== 'public_mainnet' || !spec.host.startsWith('https://')) throw new Error('Exact closed Group 2 deployment required');
  if (spec.clubIds.length < 1 || spec.clubIds.length > 10 || new Set(spec.clubIds).size !== spec.clubIds.length ||
      spec.clubIds.some(id => !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))) throw new Error('Require 1-10 distinct test club UUIDs');
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
    if (actual.environment.some(e => e.name.endsWith('LOCAL_REHEARSAL') && e.value === '1')) throw new Error(`Rehearsal flag forbidden: ${item.name}`);
    if (item.name === 'club_domain') {
      const env = (key: string) => { const hits = actual.environment.filter(e => e.name === key); return hits.length === 1 ? hits[0].value : undefined; };
      if (env('IGNITE_NEW_CLUB_PLACEMENT_ROUTER') !== spec.routerId || env('IGNITE_NEW_CLUB_PLACEMENT_GROUP') !== 'g2' ||
          env('IGNITE_NEW_CLUB_PLACEMENT_TARGET') !== spec.targetAlias) throw new Error('Mandatory creator-placement binding missing');
    }
  }
  return { checked: true as const, authorizesOpening: false as const };
}