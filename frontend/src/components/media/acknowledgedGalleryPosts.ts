import type { PendingGalleryUpload } from './pendingGalleryUploads';

/** Only a successful asset AND scope receipt can become an interactive post.
 * Local bytes are reused; gallery discovery and ancillary copies are unrelated. */
export function acknowledgedGalleryPosts(rows: readonly PendingGalleryUpload[], principal: string) {
  const posts = new Map<string, {
    id: string; representativeAssetId: string; ownerId: string; ownerName: string; ownerAvatarUrl: null;
    clubId: string; clubName: string; teamId: string | null; teamName: string | null;
    miniLeagueId: string | null; miniLeagueName: string | null; competitionId: string | null; competitionName: string | null;
    caption: string | null; eventId: string | null; createdAtMs: number; reactions: []; comments: [];
    assets: Array<{ id: string; url: string; sourceUrl: null; loading: false; isVideo: boolean }>;
  }>();
  for (const row of rows) {
    if (!row.assetId || !row.publication || !row.settled) continue;
    const receipt = row.publication;
    const id = receipt.albumId ?? row.assetId;
    const key = `${row.clubId}:${id}`;
    let post = posts.get(key);
    if (!post) {
      post = { id, representativeAssetId: row.assetId, ownerId: principal, ownerName: 'You', ownerAvatarUrl: null,
        clubId: row.clubId, clubName: row.clubName, teamId: row.teamId, teamName: row.teamId ? row.scopeName : null,
        miniLeagueId: receipt.miniLeagueId, miniLeagueName: receipt.miniLeagueId ? row.scopeName : null,
        competitionId: row.competitionId, competitionName: row.competitionId ? row.scopeName : null,
        caption: receipt.caption, eventId: receipt.eventId, createdAtMs: receipt.createdAtMs,
        reactions: [], comments: [], assets: [] };
      posts.set(key, post);
    }
    if (!post.assets.some(asset => asset.id === row.assetId)) post.assets.push({ id: row.assetId, url: row.src, sourceUrl: null, loading: false, isVideo: row.isVideo });
  }
  return [...posts.values()];
}