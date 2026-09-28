import { expect, test } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createHybridClubLinksService } from '../src/lab/hybridClubLinksService';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';
import { createSyntheticSupabaseProvider } from '../src/lab/syntheticSupabaseProvider';

const icpCanister = Principal.fromText('aaaaa-aa');
const draft = { title: 'Hybrid link', subtitle: null, url: 'https://example.com', icon: 'link', open_mode: 'browser', is_active: true };

test('routes reads and writes by placement and preserves provider isolation', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: 'club-au', country: 'AU', backend: { Supabase: { environment: 'lab-au' } } },
    { clubId: 'club-us', country: 'US', backend: { Icp: { canister: icpCanister } } },
  ]);
  const supabase = createSyntheticSupabaseProvider({ clubIdForEnvironment: environment => environment === 'lab-au' ? 'club-au' : 'club-us' });
  const icpStores = new Map<string, ReturnType<typeof createSyntheticSupabaseProvider>>();
  const service = createHybridClubLinksService(registry, {
    supabase,
    icp: async canister => {
      let provider = icpStores.get(canister.toText());
      if (!provider) { provider = createSyntheticSupabaseProvider({ clubIdForEnvironment: () => 'club-us' }); icpStores.set(canister.toText(), provider); }
      return provider(`icp-${canister.toText()}`);
    },
  });
  await service.save('club-au', draft);
  await service.save('club-us', draft);
  await expect(service.listAdmin('club-au')).resolves.toHaveLength(1);
  await expect(service.listAdmin('club-us')).resolves.toHaveLength(1);
  const auLinks = await service.listAdmin('club-au');
  const usLinks = await service.listAdmin('club-us');
  await expect(service.get(auLinks[0].id)).resolves.toMatchObject({ club_id: 'club-au' });
  await expect(service.get(usLinks[0].id)).resolves.toMatchObject({ club_id: 'club-us' });
  expect(await supabase('lab-au').then(s => s.listAdmin('club-au'))).toHaveLength(1);
  expect(await supabase('lab-us').then(s => s.listAdmin('club-us'))).toHaveLength(0);
  service.dispose();
});

test('enforces backend kill switch, country policy and read-only migration state', async () => {
  const registry = createSyntheticPlacementRegistry([{ clubId: 'club-au', country: 'AU', backend: { Supabase: { environment: 'lab-au' } } }]);
  const service = createHybridClubLinksService(registry, { supabase: createSyntheticSupabaseProvider({ clubIdForEnvironment: () => 'club-au' }), icp: async () => { throw new Error('ICP provider must not be called'); } });
  await service.save('club-au', draft);
  registry.setAvailability('supabase', false);
  await expect(service.listVisible('club-au')).rejects.toThrow('supabase disabled');
  registry.setAvailability('supabase', true);
  registry.setPlacement('club-au', 'au', { Supabase: { environment: 'lab-au' } });
  await expect(service.listVisible('club-au')).rejects.toThrow('country policy denied');
  registry.setPlacement('club-au', 'AU', { Supabase: { environment: 'lab-au' } });
  registry.setState('club-au', 'ReadOnly');
  await expect(service.listVisible('club-au')).resolves.toHaveLength(1);
  await expect(service.save('club-au', draft)).rejects.toThrow('readonly');
  service.dispose();
});
