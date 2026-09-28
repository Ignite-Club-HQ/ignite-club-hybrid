import { expect, test } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createHybridMediaRouter } from '../src/lab/hybridMediaRouter';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

type MediaItem = {
  id: string;
  clubId: string;
  kind: 'image' | 'document';
  bytes: number;
  status: 'uploaded' | 'blocked';
};

const client = (items: MediaItem[]) => ({
  upload: async (media: Omit<MediaItem, 'status'>) => {
    const next = { ...media, status: 'uploaded' as const };
    items.push(next);
    return next;
  },
  list: async (clubId: string) => items.filter(item => item.clubId === clubId),
  remove: async (id: string) => {
    const index = items.findIndex(item => item.id === id);
    if (index >= 0) items.splice(index, 1);
  },
});

test('routes attachments through the club placement and keeps them isolated', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: 'club-us', country: 'US', backend: { Icp: { canister: Principal.fromText('aaaaa-aa') } } },
    { clubId: 'club-au', country: 'AU', backend: { Supabase: { environment: 'synthetic-au' } } },
  ]);
  const items: MediaItem[] = [];
  const router = createHybridMediaRouter(registry, {
    supabase: async () => client(items),
    icp: async () => client(items),
  });

  const uploaded = await router.upload('club-us', 'image', 'avatar.png', 64);
  expect(uploaded.clubId).toBe('club-us');
  expect(await router.list('club-us')).toHaveLength(1);
  expect(await router.list('club-au')).toHaveLength(0);

  await router.remove('club-us', uploaded.id);
  expect(await router.list('club-us')).toHaveLength(0);

  router.dispose();
});

test('rejects media writes for a club in read-only mode', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: 'club-readonly', country: 'US', backend: { Icp: { canister: Principal.fromText('aaaaa-aa') } } },
  ]);
  const router = createHybridMediaRouter(registry, {
    supabase: async () => client([]),
    icp: async () => client([]),
  });

  registry.setState('club-readonly', 'ReadOnly');
  await expect(router.upload('club-readonly', 'document', 'note.pdf', 8)).rejects.toThrow('readonly');
  router.dispose();
});
