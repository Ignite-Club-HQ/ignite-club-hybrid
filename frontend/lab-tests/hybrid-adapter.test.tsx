import { expect, test } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createHybridClubLinksService } from '../src/lab/hybridClubLinksService';
import type { ClubLinksService } from '../src/lab/ClubLinksService';

const link = (id: string, club_id: string) => ({ id, club_id, title: 'x', subtitle: null, url: 'https://example.com', icon: 'link', open_mode: 'same_tab', is_active: true, sort_order: 0, created_at: new Date(0).toISOString(), revision: 1n });
const fake = (calls: string[], name: string): ClubLinksService => ({
  listAdmin: async club => { calls.push(`${name}:list:${club}`); return [link(`link-${club}`, club)]; },
  listVisible: async club => { calls.push(`${name}:visible:${club}`); return [link(`link-${club}`, club)]; },
  get: async id => link(id, 'club-au'), save: async (club, draft) => link(draft.id ?? `new-${club}`, club),
  remove: async id => { calls.push(`${name}:remove:${id}`); }, setActive: async () => undefined, reorder: async () => undefined,
});

test('selects the registry backend and never falls back', async () => {
  const calls: string[] = [];
  const registry = {
    get_decision: async (clubId: string) => ({ Ok: [{
      backend_enabled: true, country_allowed: true, writable: true, reason: 'active',
      placement: { state: 'Active' as const, version: 1n, backend: clubId === 'club-au'
        ? { Supabase: { environment: 'lab' } }
        : { Icp: { canister: Principal.fromText('aaaaa-aa') } } },
    }] }),
  };
  const service = createHybridClubLinksService(registry, { supabase: async environment => fake(calls, `supabase:${environment}`), icp: async canister => fake(calls, `icp:${canister.toText()}`) });
  await service.listAdmin('club-au');
  await service.listAdmin('club-us');
  expect(calls).toEqual(['supabase:lab:list:club-au', 'icp:aaaaa-aa:list:club-us']);
});

test('fails closed for disabled placement and does not invoke a provider', async () => {
  let invoked = false;
  const registry = { get_decision: async () => ({ Ok: [{ backend_enabled: false, country_allowed: true, writable: false, reason: 'ICP disabled', placement: { state: 'Active' as const, version: 1n, backend: { Icp: { canister: { toText: () => 'aaaaa-aa' } } } } }] }) };
  const service = createHybridClubLinksService(registry, { supabase: async () => { invoked = true; return fake([], 'supabase'); }, icp: async () => { invoked = true; return fake([], 'icp'); } });
  await expect(service.listVisible('club-au')).rejects.toThrow('ICP disabled');
  expect(invoked).toBe(false);
});

test('allows reads but blocks writes for read-only placement', async () => {
  const calls: string[] = [];
  const registry = { get_decision: async () => ({ Ok: [{ backend_enabled: true, country_allowed: true, writable: false, reason: 'migration in progress', placement: { state: 'ReadOnly' as const, version: 2n, backend: { Supabase: { environment: 'lab' } } } }] }) };
  const service = createHybridClubLinksService(registry, { supabase: async () => fake(calls, 'supabase'), icp: async () => fake(calls, 'icp') });
  await service.listVisible('club-au');
  await expect(service.save('club-au', { title: 'x', subtitle: null, url: 'https://example.com', icon: 'link', open_mode: 'same_tab', is_active: true })).rejects.toThrow('migration in progress');
  expect(calls).toEqual(['supabase:visible:club-au']);
});
