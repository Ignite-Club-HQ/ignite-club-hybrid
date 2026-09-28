import { Principal } from '@icp-sdk/core/principal';
import { expect, test } from 'vitest';
import {
  createHybridMediaRouter,
  type MediaClient,
  type MediaAsset,
} from '../src/lab/hybridMediaRouter';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

const CLUB_A = 'club-media-a';
const CLUB_B = 'club-media-b';
const ICP_A = Principal.fromText('aaaaa-aa');
const ICP_B = Principal.fromText('2vxsx-fae');

function createMediaClient(): MediaClient {
  const assets: MediaAsset[] = [];
  return {
    async upload(asset) {
      const stored = { ...asset, status: 'uploaded' as const };
      assets.push(stored);
      return stored;
    },
    async list(clubId) {
      return assets.filter(asset => asset.clubId === clubId);
    },
    async remove(id) {
      const index = assets.findIndex(asset => asset.id === id);
      if (index >= 0) assets.splice(index, 1);
    },
  };
}

for (const mode of ['supabase', 'icp'] as const) {
  test(`routes imported media storage behavior through explicit ${mode} placement`, async () => {
    const registry = createSyntheticPlacementRegistry([
      {
        clubId: CLUB_A,
        country: 'AU',
        backend: mode === 'supabase'
          ? { Supabase: { environment: 'media-au' } }
          : { Icp: { canister: ICP_A } },
      },
      {
        clubId: CLUB_B,
        country: 'US',
        backend: mode === 'supabase'
          ? { Supabase: { environment: 'media-us' } }
          : { Icp: { canister: ICP_B } },
      },
    ]);
    const calls: string[] = [];
    const clients = new Map<string, MediaClient>();
    const getClient = (key: string) => {
      let client = clients.get(key);
      if (!client) {
        client = createMediaClient();
        clients.set(key, client);
      }
      return client;
    };
    const router = createHybridMediaRouter(registry, {
      supabase: async environment => {
        calls.push(`supabase:${environment}`);
        return getClient(`supabase:${environment}`);
      },
      icp: async canister => {
        const key = canister.toText();
        calls.push(`icp:${key}`);
        return getClient(`icp:${key}`);
      },
    });

    const assetA = await router.upload(CLUB_A, 'image', 'club-a.jpg', 64);
    const assetB = await router.upload(CLUB_B, 'document', 'club-b.pdf', 128);

    await expect(router.list(CLUB_A)).resolves.toEqual([
      expect.objectContaining({ id: assetA.id, clubId: CLUB_A, name: 'club-a.jpg' }),
    ]);
    await expect(router.list(CLUB_B)).resolves.toEqual([
      expect.objectContaining({ id: assetB.id, clubId: CLUB_B, name: 'club-b.pdf' }),
    ]);
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call.startsWith(mode === 'supabase' ? 'supabase:' : 'icp:'))).toBe(true);

    await router.remove(CLUB_A, assetA.id);
    await expect(router.list(CLUB_A)).resolves.toEqual([]);
    await expect(router.list(CLUB_B)).resolves.toHaveLength(1);

    router.dispose();
  });
}

test('does not fall back to Supabase when the selected ICP media provider fails', async () => {
  let supabaseCalls = 0;
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: ICP_A } },
  }]);
  const router = createHybridMediaRouter(registry, {
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error('Supabase must not be used in ICP mode');
    },
    icp: async () => {
      throw new Error('local ICP media provider unavailable');
    },
  });

  await expect(router.upload(CLUB_A, 'image', 'failed.jpg', 8))
    .rejects.toThrow('local ICP media provider unavailable');
  expect(supabaseCalls).toBe(0);
  router.dispose();
});
