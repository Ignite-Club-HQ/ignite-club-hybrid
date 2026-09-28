import type { MediaMetadataClient } from './mediaMetadataClient';

export type MediaFeedAsset = {
  id: string;
  clubId: string;
  ownerId: string;
  kind: string;
  mime: string;
  checksum: string;
  storagePath: string;
  visibility: string;
  childSensitive: boolean;
  deleted: boolean;
};

export type MediaFeedReaction = {
  assetId: string;
  userId: string;
  kind: string;
  createdAtMs: number;
};

export type MediaFeedComment = {
  id: string;
  assetId: string;
  authorId: string;
  body: string;
  createdAtMs: number;
  deleted: boolean;
};

export type RegisterMediaAssetInput = {
  clubId: string;
  kind: string;
  mime: string;
  checksum: string;
  storagePath: string;
  visibility: string;
  expiresAtMs: number;
};

/**
 * Backend-agnostic surface the media feed's business logic runs against.
 * The ICP implementation is `createIcpMediaFeedProvider` below; a Supabase
 * implementation is unnecessary today because MediaPage's existing Supabase
 * code path is untouched — this provider only backs the ICP-native branch.
 */
export interface MediaFeedProvider {
  listAssets(clubId: string): Promise<MediaFeedAsset[]>;
  registerAsset(input: RegisterMediaAssetInput): Promise<MediaFeedAsset>;
  deleteAsset(assetId: string): Promise<MediaFeedAsset>;
  listReactions(assetId: string): Promise<MediaFeedReaction[]>;
  addReaction(assetId: string, kind: string, createdAtMs: number): Promise<MediaFeedReaction>;
  removeReaction(assetId: string): Promise<void>;
  listComments(assetId: string): Promise<MediaFeedComment[]>;
  addComment(assetId: string, body: string, createdAtMs: number): Promise<MediaFeedComment>;
  deleteComment(commentId: string): Promise<MediaFeedComment>;
}

/**
 * The canister's `assets` list is append-only (soft-deleted, never
 * reordered or re-timestamped), so most-recent-first is simply the reverse
 * of registration order — there is no separate `created_at` to sort by.
 */
export async function fetchMediaFeed(provider: MediaFeedProvider, clubId: string): Promise<MediaFeedAsset[]> {
  const assets = await provider.listAssets(clubId);
  return assets.filter(asset => !asset.deleted).slice().reverse();
}

/**
 * Mirrors the source app's reaction contract: a user holds at most one
 * reaction per asset. Reacting with the currently-held kind again removes
 * it (toggle-off); reacting with a different kind replaces it.
 */
export async function toggleMediaReaction(
  provider: MediaFeedProvider,
  assetId: string,
  kind: string,
  userId: string,
  currentReactions: MediaFeedReaction[],
  nowMs: number,
): Promise<MediaFeedReaction | null> {
  const existing = currentReactions.find(reaction => reaction.assetId === assetId && reaction.userId === userId);
  if (existing && existing.kind === kind) {
    await provider.removeReaction(assetId);
    return null;
  }
  return provider.addReaction(assetId, kind, nowMs);
}

function parseAsset(raw: {
  id: string;
  club_id: string;
  owner: { toText(): string };
  kind: string;
  mime: string;
  checksum: string;
  storage_path: string;
  visibility: string;
  child_sensitive: boolean;
  deleted: boolean;
}): MediaFeedAsset {
  return {
    id: raw.id,
    clubId: raw.club_id,
    ownerId: raw.owner.toText(),
    kind: raw.kind,
    mime: raw.mime,
    checksum: raw.checksum,
    storagePath: raw.storage_path,
    visibility: raw.visibility,
    childSensitive: raw.child_sensitive,
    deleted: raw.deleted,
  };
}

function parseReaction(raw: { asset_id: string; user: { toText(): string }; kind: string; created_at_ms: bigint }): MediaFeedReaction {
  return { assetId: raw.asset_id, userId: raw.user.toText(), kind: raw.kind, createdAtMs: Number(raw.created_at_ms) };
}

function parseComment(raw: {
  id: string;
  asset_id: string;
  author: { toText(): string };
  body: string;
  created_at_ms: bigint;
  deleted: boolean;
}): MediaFeedComment {
  return {
    id: raw.id,
    assetId: raw.asset_id,
    authorId: raw.author.toText(),
    body: raw.body,
    createdAtMs: Number(raw.created_at_ms),
    deleted: raw.deleted,
  };
}

/** Adapts the deployed media_metadata canister to `MediaFeedProvider`. */
export function createIcpMediaFeedProvider(client: MediaMetadataClient): MediaFeedProvider {
  return {
    async listAssets(clubId) {
      return (await client.listAssets(clubId)).map(parseAsset);
    },
    async registerAsset(input) {
      const asset = await client.registerAsset(
        input.clubId,
        input.kind,
        input.mime,
        input.checksum,
        input.storagePath,
        input.visibility,
        BigInt(input.expiresAtMs),
      );
      return parseAsset(asset);
    },
    async deleteAsset(assetId) {
      return parseAsset(await client.deleteAsset(assetId));
    },
    async listReactions(assetId) {
      return (await client.listReactions(assetId)).map(parseReaction);
    },
    async addReaction(assetId, kind, createdAtMs) {
      return parseReaction(await client.addReaction(assetId, kind, BigInt(createdAtMs)));
    },
    async removeReaction(assetId) {
      await client.removeReaction(assetId);
    },
    async listComments(assetId) {
      return (await client.listComments(assetId)).map(parseComment);
    },
    async addComment(assetId, body, createdAtMs) {
      return parseComment(await client.addComment(assetId, body, BigInt(createdAtMs)));
    },
    async deleteComment(commentId) {
      return parseComment(await client.deleteComment(commentId));
    },
  };
}

/**
 * In-memory fixture provider for the ICP-lab `useIcpLab` render path, in
 * pages that cannot bootstrap a live actor connection (no session/agent
 * plumbing exists outside `LabApp.tsx`). Mirrors the rest of
 * `fixtureDataLayer.ts`'s convention: synthetic seed data, mutations kept
 * only in memory, nothing persisted across reloads. Implements the same
 * `MediaFeedProvider` contract as `createIcpMediaFeedProvider` so the feed's
 * business logic (`fetchMediaFeed`, `toggleMediaReaction`) is identical
 * regardless of which provider backs it.
 */
export function createFixtureMediaFeedProvider(clubId: string, actorId: string): MediaFeedProvider {
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-fixture-${++counter}`;

  const assets: MediaFeedAsset[] = [
    {
      id: 'media-icp-001',
      clubId,
      ownerId: actorId,
      kind: 'photo',
      mime: 'image/jpeg',
      checksum: 'fixture-checksum-1',
      storagePath: 'fixtures/media/lab-placeholder-1.jpg',
      visibility: 'public',
      childSensitive: false,
      deleted: false,
    },
    {
      id: 'media-icp-002',
      clubId,
      ownerId: actorId,
      kind: 'photo',
      mime: 'image/jpeg',
      checksum: 'fixture-checksum-2',
      storagePath: 'fixtures/media/lab-placeholder-2.jpg',
      visibility: 'public',
      childSensitive: false,
      deleted: false,
    },
  ];
  const reactions: MediaFeedReaction[] = [];
  const comments: MediaFeedComment[] = [];

  return {
    async listAssets(forClubId) {
      return assets.filter(asset => asset.clubId === forClubId);
    },
    async registerAsset(input) {
      const asset: MediaFeedAsset = {
        id: nextId('media'),
        clubId: input.clubId,
        ownerId: actorId,
        kind: input.kind,
        mime: input.mime,
        checksum: input.checksum,
        storagePath: input.storagePath,
        visibility: input.visibility,
        childSensitive: false,
        deleted: false,
      };
      assets.push(asset);
      return asset;
    },
    async deleteAsset(assetId) {
      const asset = assets.find(a => a.id === assetId);
      if (!asset) throw new Error(`Unknown fixture asset: ${assetId}`);
      asset.deleted = true;
      return asset;
    },
    async listReactions(assetId) {
      return reactions.filter(reaction => reaction.assetId === assetId);
    },
    async addReaction(assetId, kind, createdAtMs) {
      const idx = reactions.findIndex(reaction => reaction.assetId === assetId && reaction.userId === actorId);
      const reaction: MediaFeedReaction = { assetId, userId: actorId, kind, createdAtMs };
      if (idx >= 0) reactions[idx] = reaction;
      else reactions.push(reaction);
      return reaction;
    },
    async removeReaction(assetId) {
      const idx = reactions.findIndex(reaction => reaction.assetId === assetId && reaction.userId === actorId);
      if (idx >= 0) reactions.splice(idx, 1);
    },
    async listComments(assetId) {
      return comments.filter(comment => comment.assetId === assetId && !comment.deleted);
    },
    async addComment(assetId, body, createdAtMs) {
      const comment: MediaFeedComment = { id: nextId('comment'), assetId, authorId: actorId, body, createdAtMs, deleted: false };
      comments.push(comment);
      return comment;
    },
    async deleteComment(commentId) {
      const comment = comments.find(c => c.id === commentId);
      if (!comment) throw new Error(`Unknown fixture comment: ${commentId}`);
      comment.deleted = true;
      return comment;
    },
  };
}
