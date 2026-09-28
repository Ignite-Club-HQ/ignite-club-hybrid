import { describe, expect, test } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';
import { resolveClubBackend, withClubBackend } from '../src/lab/backendRouter';
import { resolveLocalAuthMode } from '../src/lab/localRuntimeMode';

const providers = [
  {
    label: 'icp',
    clubId: 'club-icp',
    placement: { country: 'US', backend: { Icp: { canister: Principal.fromText('aaaaa-aa') } } },
    expectedKind: 'icp',
    providerResult: 'icp:aaaaa-aa',
  },
  {
    label: 'supabase',
    clubId: 'club-supabase',
    placement: { country: 'AU', backend: { Supabase: { environment: 'staging-au' } } },
    expectedKind: 'supabase',
    providerResult: 'supabase:staging-au',
  },
] as const;

describe.each(providers)('provider matrix: $label', ({ clubId, placement, expectedKind, providerResult }) => {
  test('resolves the authoritative control-plane backend for the club', async () => {
    const registry = createSyntheticPlacementRegistry([{ clubId, country: placement.country, backend: placement.backend }]);

    await expect(resolveClubBackend(registry, clubId)).resolves.toMatchObject({ kind: expectedKind });
  });

  test('executes the provider call without falling back to another backend', async () => {
    const registry = createSyntheticPlacementRegistry([{ clubId, country: placement.country, backend: placement.backend }]);

    await expect(withClubBackend(
      registry,
      {
        icp: async canister => `icp:${canister.toText()}`,
        supabase: async environment => `supabase:${environment}`,
      },
      clubId,
      provider => provider,
    )).resolves.toBe(providerResult);
  });
});

test('backend selection follows the local lab contract and fail-closes on disabled placements', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: 'club-icp', country: 'US', backend: { Icp: { canister: Principal.fromText('aaaaa-aa') } } },
    { clubId: 'club-supabase', country: 'AU', backend: { Supabase: { environment: 'staging-au' } } },
  ]);

  expect(resolveLocalAuthMode('', true)).toBe(true);
  expect(resolveLocalAuthMode('?backend=icp', true)).toBe(true);
  expect(resolveLocalAuthMode('?backend=supabase', true)).toBe(false);

  registry.setAvailability('icp', false);
  await expect(resolveClubBackend(registry, 'club-icp')).rejects.toThrow('Backend unavailable');

  registry.setAvailability('icp', true);
  registry.setState('club-icp', 'Blocked');
  await expect(resolveClubBackend(registry, 'club-icp')).rejects.toThrow('Backend unavailable');
});
