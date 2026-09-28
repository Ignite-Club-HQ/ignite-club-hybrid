import { expect, test } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createPlacementRegistryClient } from '../src/lab/placementRegistryClient';

test('converts the local registry Candid decision into the hybrid seam', async () => {
  const actor = {
    get_decision: async () => ({ Ok: [{
      backend_enabled: true, country_allowed: true, writable: true, reason: 'active',
      placement: { club_id: 'club-au', country: 'AU', version: 4n, state: { Active: null }, backend: { Icp: { canister: Principal.fromText('aaaaa-aa') } } },
    }] }),
  } as any;
  await expect(createPlacementRegistryClient(actor).get_decision('club-au')).resolves.toEqual({ Ok: [{
    backend_enabled: true, country_allowed: true, writable: true, reason: 'active',
    placement: { club_id: 'club-au', country: 'AU', version: 4n, state: 'Active', backend: { Icp: { canister: Principal.fromText('aaaaa-aa') } } },
  }] });
});

test('preserves registry errors and empty placements', async () => {
  const error = createPlacementRegistryClient({ get_decision: async () => ({ Err: 'registry unavailable' }) } as any);
  await expect(error.get_decision('club-au')).resolves.toEqual({ Err: 'registry unavailable' });
  const empty = createPlacementRegistryClient({ get_decision: async () => ({ Ok: [] }) } as any);
  await expect(empty.get_decision('club-au')).resolves.toEqual({ Ok: [] });
});
