import { describe, expect, it } from 'vitest';
import { verifyOwnerOpeningChecks, type OwnerCheckSpec, type ObservedService } from './ownerOpeningChecks';
import { GROUP_DOMAINS } from './groupRouting';
const p = (text: string) => ({ toText: () => text });
function fixture() {
  const names = GROUP_DOMAINS.filter(d => d !== 'secret_workload_identity');
  const services = [...names, 'media_blob_store'].map(name => ({ name, canisterId: name, subnetId: 'subnet', moduleHash: 'ab'.repeat(32) }));
  const spec: OwnerCheckSpec = { governor: 'governor', owner: 'owner', routerId: 'router', targetAlias: 'ic', deploymentId: 'mainnet', host: 'https://icp-api.io',
    revision: '2', clubIds: ['00000000-0000-4000-8000-000000000001'], services, minCycles: '10', heapBudgetBytes: '100' };
  const observed: ObservedService[] = services.map(s => ({ ...s, controllers: ['governor'], running: true, cycles: 10n, heapBytes: 1n, environment: s.name === 'club_domain' ? [
    { name: 'IGNITE_NEW_CLUB_PLACEMENT_ROUTER', value: 'router' }, { name: 'IGNITE_NEW_CLUB_PLACEMENT_GROUP', value: 'g2' }, { name: 'IGNITE_NEW_CLUB_PLACEMENT_TARGET', value: 'ic' }] : [] }));
  const group = { id: 'g2', target_alias: 'ic', accepting: false, domains: GROUP_DOMAINS.map(domain => ({ domain, canister: p(domain) })), photo_store: [p('media_blob_store')] as [{ toText(): string }] };
  const placement = { deployment_id: 'mainnet', host: spec.host, network_kind: 'public_mainnet', domains: group.domains.map(d => ({ ...d, subnet: p('subnet') })) };
  const check = () => verifyOwnerOpeningChecks(spec, observed, group, placement);
  return { spec, observed, group, placement, check };
}
describe('owner-only Group 2 opening checks', () => {
  it('requires the exact complete 13 services and never grants opening', () => { const f = fixture(); expect(f.check()).toEqual({ checked: true, authorizesOpening: false }); f.observed.pop(); expect(f.check).toThrow('13-service'); });
  it('rejects owner identity substitution by the deploy key', () => { const f = fixture(); f.spec.owner = f.spec.governor; expect(f.check).toThrow('app sign-in'); });
  it('keeps general Group 2 admission closed', () => { const f = fixture(); f.group.accepting = true; expect(f.check).toThrow('closed'); });
  it('requires exact approved modules and sole governor control', () => { const f = fixture(); f.observed[0].moduleHash = 'cd'.repeat(32); expect(f.check).toThrow('Unverified'); f.observed[0].moduleHash = f.spec.services[0].moduleHash; f.observed[0].controllers.push('other'); expect(f.check).toThrow('Unverified'); });
  it('requires creator binding and forbids mainnet rehearsal flags', () => { const f = fixture(); f.observed[0].environment.pop(); expect(f.check).toThrow('creator-placement'); const g = fixture(); g.observed[1].environment.push({ name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' }); expect(g.check).toThrow('Rehearsal'); });
  it('requires capacity and 1-10 explicit distinct club IDs', () => { const f = fixture(); f.observed[0].cycles = 9n; expect(f.check).toThrow('health'); const g = fixture(); g.spec.clubIds = []; expect(g.check).toThrow('1-10'); });
});