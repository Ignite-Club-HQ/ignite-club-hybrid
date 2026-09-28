import { expect, test } from 'vitest';
import {
  createFixtureMediaFeedProvider,
  createIcpMediaFeedProvider,
  fetchMediaFeed,
  toggleMediaReaction,
  type MediaFeedAsset,
  type MediaFeedProvider,
  type MediaFeedReaction,
} from '../src/lab/hybridMediaFeedRepository';
import type { MediaMetadataClient } from '../src/lab/mediaMetadataClient';

function asset(overrides: Partial<MediaFeedAsset> = {}): MediaFeedAsset {
  return {
    id: 'asset-club-a-1',
    clubId: 'club-a',
    ownerId: 'owner-1',
    kind: 'photo',
    mime: 'image/png',
    checksum: 'checksum-1',
    storagePath: '/synthetic/one.png',
    visibility: 'club',
    childSensitive: false,
    deleted: false,
    ...overrides,
  };
}

function makeProvider(overrides: Partial<MediaFeedProvider> = {}): MediaFeedProvider {
  return {
    listAssets: async () => [],
    registerAsset: async () => asset(),
    deleteAsset: async () => asset({ deleted: true }),
    listReactions: async () => [],
    addReaction: async (assetId, kind, createdAtMs) => ({ assetId, userId: 'me', kind, createdAtMs }),
    removeReaction: async () => {},
    listComments: async () => [],
    addComment: async (assetId, body, createdAtMs) => ({ id: 'comment-1', assetId, authorId: 'me', body, createdAtMs, deleted: false }),
    deleteComment: async () => ({ id: 'comment-1', assetId: 'asset-club-a-1', authorId: 'me', body: 'x', createdAtMs: 0, deleted: true }),
    ...overrides,
  };
}

test('fetchMediaFeed drops deleted assets and orders most-recent-first', async () => {
  const provider = makeProvider({
    listAssets: async () => [
      asset({ id: 'asset-1' }),
      asset({ id: 'asset-2', deleted: true }),
      asset({ id: 'asset-3' }),
    ],
  });

  const feed = await fetchMediaFeed(provider, 'club-a');

  expect(feed.map(item => item.id)).toEqual(['asset-3', 'asset-1']);
});

test('fetchMediaFeed returns an empty feed untouched', async () => {
  const feed = await fetchMediaFeed(makeProvider(), 'club-a');
  expect(feed).toEqual([]);
});

test('toggleMediaReaction adds a reaction when the user has none yet', async () => {
  let addCall: [string, string, number] | undefined;
  const provider = makeProvider({
    addReaction: async (assetId, kind, createdAtMs) => {
      addCall = [assetId, kind, createdAtMs];
      return { assetId, userId: 'me', kind, createdAtMs };
    },
  });

  const result = await toggleMediaReaction(provider, 'asset-1', 'like', 'me', [], 1000);

  expect(addCall).toEqual(['asset-1', 'like', 1000]);
  expect(result).toEqual({ assetId: 'asset-1', userId: 'me', kind: 'like', createdAtMs: 1000 });
});

test('toggleMediaReaction removes the reaction when re-selecting the same kind', async () => {
  let removedAssetId: string | undefined;
  const provider = makeProvider({
    removeReaction: async assetId => { removedAssetId = assetId; },
  });
  const current: MediaFeedReaction[] = [{ assetId: 'asset-1', userId: 'me', kind: 'like', createdAtMs: 500 }];

  const result = await toggleMediaReaction(provider, 'asset-1', 'like', 'me', current, 1000);

  expect(removedAssetId).toBe('asset-1');
  expect(result).toBeNull();
});

test('toggleMediaReaction replaces a different kind rather than accumulating', async () => {
  let addCall: [string, string, number] | undefined;
  const provider = makeProvider({
    addReaction: async (assetId, kind, createdAtMs) => {
      addCall = [assetId, kind, createdAtMs];
      return { assetId, userId: 'me', kind, createdAtMs };
    },
  });
  const current: MediaFeedReaction[] = [{ assetId: 'asset-1', userId: 'me', kind: 'like', createdAtMs: 500 }];

  const result = await toggleMediaReaction(provider, 'asset-1', 'love', 'me', current, 1000);

  expect(addCall).toEqual(['asset-1', 'love', 1000]);
  expect(result?.kind).toBe('love');
});

test('toggleMediaReaction only replaces the reaction on the asset being reacted to', async () => {
  let addCall: [string, string, number] | undefined;
  const provider = makeProvider({
    addReaction: async (assetId, kind, createdAtMs) => {
      addCall = [assetId, kind, createdAtMs];
      return { assetId, userId: 'me', kind, createdAtMs };
    },
  });
  // Same user already reacted to a *different* asset with 'like' — that must
  // not be mistaken for an existing reaction on asset-2.
  const current: MediaFeedReaction[] = [{ assetId: 'asset-1', userId: 'me', kind: 'like', createdAtMs: 500 }];

  const result = await toggleMediaReaction(provider, 'asset-2', 'like', 'me', current, 1000);

  expect(addCall).toEqual(['asset-2', 'like', 1000]);
  expect(result?.assetId).toBe('asset-2');
});

function fakePrincipal(text: string) {
  return { toText: () => text };
}

function fakeMediaMetadataClient(overrides: Partial<MediaMetadataClient> = {}): MediaMetadataClient {
  return {
    registerAsset: async () => ({
      id: 'asset-club-a-1',
      club_id: 'club-a',
      owner: fakePrincipal('owner-1'),
      kind: 'photo',
      mime: 'image/png',
      checksum: 'checksum-1',
      storage_path: '/synthetic/one.png',
      visibility: 'club',
      content_length: 0n,
      encrypted: false,
      child_sensitive: false,
      retention_until_ms: 0n,
      deleted: false,
      expires_at_ms: 0n,
    }),
    getAsset: async () => [],
    listAssets: async () => [],
    deleteAsset: async () => { throw new Error('not used'); },
    issueCapability: async () => { throw new Error('not used'); },
    addReaction: async (assetId, kind, createdAtMs) => ({ asset_id: assetId, user: fakePrincipal('me'), kind, created_at_ms: createdAtMs }),
    removeReaction: async () => {},
    listReactions: async () => [],
    addComment: async (assetId, body, createdAtMs) => ({ id: 'comment-1', asset_id: assetId, author: fakePrincipal('me'), body, created_at_ms: createdAtMs, deleted: false }),
    listComments: async () => [],
    deleteComment: async () => { throw new Error('not used'); },
    grantRole: async () => { throw new Error('not used'); },
    dispose() {},
    ...overrides,
  } as unknown as MediaMetadataClient;
}

test('createIcpMediaFeedProvider translates candid principals and bigints into plain domain values', async () => {
  const client = fakeMediaMetadataClient();
  const provider = createIcpMediaFeedProvider(client);

  const registered = await provider.registerAsset({
    clubId: 'club-a',
    kind: 'photo',
    mime: 'image/png',
    checksum: 'checksum-1',
    storagePath: '/synthetic/one.png',
    visibility: 'club',
    expiresAtMs: 60_000,
  });
  expect(registered).toEqual({
    id: 'asset-club-a-1',
    clubId: 'club-a',
    ownerId: 'owner-1',
    kind: 'photo',
    mime: 'image/png',
    checksum: 'checksum-1',
    storagePath: '/synthetic/one.png',
    visibility: 'club',
    childSensitive: false,
    deleted: false,
  });

  const reaction = await provider.addReaction('asset-club-a-1', 'like', 1234);
  expect(reaction).toEqual({ assetId: 'asset-club-a-1', userId: 'me', kind: 'like', createdAtMs: 1234 });

  const comment = await provider.addComment('asset-club-a-1', 'Nice shot!', 5678);
  expect(comment).toEqual({ id: 'comment-1', assetId: 'asset-club-a-1', authorId: 'me', body: 'Nice shot!', createdAtMs: 5678, deleted: false });
});

test('createFixtureMediaFeedProvider seeds a club-scoped, session-only feed', async () => {
  const provider = createFixtureMediaFeedProvider('club-icp-001', 'icp-member');

  const feed = await fetchMediaFeed(provider, 'club-icp-001');
  expect(feed.length).toBe(2);
  expect(feed.every(item => item.clubId === 'club-icp-001')).toBe(true);

  // A different club's feed must not see these fixture assets.
  const otherClubFeed = await fetchMediaFeed(provider, 'club-icp-other');
  expect(otherClubFeed).toEqual([]);
});

test('createFixtureMediaFeedProvider supports react/unreact and comment round-trips in memory', async () => {
  const provider = createFixtureMediaFeedProvider('club-icp-001', 'icp-member');
  const [asset] = await provider.listAssets('club-icp-001');

  const reacted = await toggleMediaReaction(provider, asset.id, 'like', 'icp-member', [], 1000);
  expect(reacted?.kind).toBe('like');
  expect(await provider.listReactions(asset.id)).toEqual([{ assetId: asset.id, userId: 'icp-member', kind: 'like', createdAtMs: 1000 }]);

  const unreacted = await toggleMediaReaction(provider, asset.id, 'like', 'icp-member', await provider.listReactions(asset.id), 2000);
  expect(unreacted).toBeNull();
  expect(await provider.listReactions(asset.id)).toEqual([]);

  const comment = await provider.addComment(asset.id, 'Great photo!', 3000);
  expect(comment).toMatchObject({ assetId: asset.id, authorId: 'icp-member', body: 'Great photo!', deleted: false });
  expect(await provider.listComments(asset.id)).toEqual([comment]);

  await provider.deleteComment(comment.id);
  expect(await provider.listComments(asset.id)).toEqual([]);
});

test('createFixtureMediaFeedProvider registerAsset/deleteAsset round-trip and soft-delete', async () => {
  const provider = createFixtureMediaFeedProvider('club-icp-001', 'icp-member');

  const registered = await provider.registerAsset({
    clubId: 'club-icp-001',
    kind: 'photo',
    mime: 'image/png',
    checksum: 'checksum-x',
    storagePath: '/synthetic/new.png',
    visibility: 'public',
    expiresAtMs: 0,
  });
  expect(registered.deleted).toBe(false);
  expect((await fetchMediaFeed(provider, 'club-icp-001')).some(item => item.id === registered.id)).toBe(true);

  await provider.deleteAsset(registered.id);
  expect((await fetchMediaFeed(provider, 'club-icp-001')).some(item => item.id === registered.id)).toBe(false);
});
