import { Principal } from '@icp-sdk/core/principal';
import { expect, test } from 'vitest';
import type { ClubLinksService } from '../src/lab/ClubLinksService';
import { createFixtureClubLinksService } from '../src/lab/clubLinksService.mjs';
import { createHybridClubLinksService } from '../src/lab/hybridClubLinksService';
import { createLocalSupabaseProvider } from '../src/lab/localSupabaseAdapter';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

const CLUB_A = 'club-baseline-a';
const CLUB_B = 'club-baseline-b';
const ICP_A = Principal.fromText('aaaaa-aa');
const ICP_B = Principal.fromText('2vxsx-fae');

const draft = (title: string, isActive: boolean) => ({
  title,
  subtitle: null,
  url: `https://${title.toLowerCase().replaceAll(' ', '-')}.invalid`,
  icon: 'link',
  open_mode: 'browser',
  is_active: isActive,
});

type BackendMode = 'supabase' | 'icp';

function createBaselineHarness(mode: BackendMode) {
  const calls: string[] = [];
  const registry = createSyntheticPlacementRegistry([
    {
      clubId: CLUB_A,
      country: 'AU',
      backend: mode === 'supabase'
        ? { Supabase: { environment: 'local-au' } }
        : { Icp: { canister: ICP_A } },
    },
    {
      clubId: CLUB_B,
      country: 'US',
      backend: mode === 'supabase'
        ? { Supabase: { environment: 'local-us' } }
        : { Icp: { canister: ICP_B } },
    },
  ]);
  const supabase = createLocalSupabaseProvider({
    environments: ['local-au', 'local-us'],
    clubIdForEnvironment: environment => environment === 'local-au' ? CLUB_A : CLUB_B,
  });
  const icpServices = new Map<string, ClubLinksService & { dispose(): void }>();
  const service = createHybridClubLinksService(registry, {
    supabase: async environment => {
      calls.push(`supabase:${environment}`);
      return supabase(environment);
    },
    icp: async canister => {
      const key = canister.toText();
      calls.push(`icp:${key}`);
      let provider = icpServices.get(key);
      if (!provider) {
        const clubId = key === ICP_A.toText() ? CLUB_A : CLUB_B;
        provider = createFixtureClubLinksService({ clubId }) as ClubLinksService & { dispose(): void };
        provider.dispose = () => undefined;
        icpServices.set(key, provider);
      }
      return provider;
    },
  });
  return { calls, service };
}

for (const mode of ['supabase', 'icp'] as const) {
  test(`adapts the imported Club Links baseline in explicit ${mode} mode`, async () => {
    const { calls, service } = createBaselineHarness(mode);
    try {
      await service.save(CLUB_A, draft('Active baseline link', true));
      await service.save(CLUB_A, draft('Inactive baseline link', false));
      await service.save(CLUB_B, draft('Other club link', true));

      await expect(service.listVisible(CLUB_A)).resolves.toHaveLength(1);
      await expect(service.listAdmin(CLUB_A)).resolves.toHaveLength(2);
      await expect(service.listAdmin(CLUB_B)).resolves.toHaveLength(1);

      const inactive = (await service.listAdmin(CLUB_A)).find(link => !link.is_active);
      expect(inactive).toBeDefined();
      await expect(service.get(inactive!.id)).resolves.toMatchObject({ club_id: CLUB_A, is_active: false });
      await expect(service.listVisible(CLUB_B)).resolves.toMatchObject([
        expect.objectContaining({ club_id: CLUB_B, title: 'Other club link' }),
      ]);

      const expectedProvider = mode === 'supabase' ? 'supabase:' : 'icp:';
      expect(calls.every(call => call.startsWith(expectedProvider))).toBe(true);
    } finally {
      service.dispose();
    }
  });
}

test('ICP mode does not call Supabase or fall back when the local provider fails', async () => {
  let supabaseCalls = 0;
  let icpCalls = 0;
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: ICP_A } },
  }]);
  const service = createHybridClubLinksService(registry, {
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error('Supabase must not be used in ICP mode');
    },
    icp: async () => {
      icpCalls += 1;
      throw new Error('local ICP provider unavailable');
    },
  });

  try {
    await expect(service.listAdmin(CLUB_A)).rejects.toThrow('local ICP provider unavailable');
    expect(icpCalls).toBe(1);
    expect(supabaseCalls).toBe(0);
  } finally {
    service.dispose();
  }
});
