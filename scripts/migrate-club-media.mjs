// Pure conversion: Supabase photos -> media_metadata FenceSnapshot.
// No network, no source writes. Metadata only: storage_path keeps pointing at
// the Supabase object URL and blob_ref stays empty until the separate
// byte-copy-and-encrypt job moves the bytes into the group's blob store.
import { claimedPrincipal, timestamp } from './migrate-club-members.mjs';
const opt = (v) => (v == null || v === '' ? [] : [v]);

const MIME_BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime' };
export function mimeFromUrl(url) {
  const ext = String(url ?? '').split('?')[0].split('.').pop()?.toLowerCase();
  return MIME_BY_EXT[ext] ?? 'image/jpeg';
}

export function buildMediaSnapshot({ clubId, photos = [], albums = [], claims }) {
  for (const p of photos) if (p.club_id !== clubId) throw Error('Foreign photo refused');
  const ids = photos.map((p) => p.id);
  if (new Set(ids).size !== ids.length) throw Error('Duplicate photo id refused');
  const photoIds = new Set(ids);
  // Album names/covers carry over; covers must point at a migrated photo.
  const mappedAlbums = albums.filter((a) => !a.deleted_at).map((a) => {
    if (a.club_id !== clubId) throw Error('Foreign photo album refused');
    const cover = a.cover_photo_id ?? null;
    if (cover && !photoIds.has(cover)) throw Error('Album cover references an unknown photo');
    return {
      id: a.id, club_id: clubId, title: String(a.name ?? a.title ?? 'Album'),
      cover_asset_id: opt(cover), created_by: claimedPrincipal(claims, a.created_by),
      created_at_ms: timestamp(a.created_at),
    };
  });
  return {
    albums: [mappedAlbums],
    assets: photos.map((p) => ({
      id: p.id, club_id: clubId, owner: claimedPrincipal(claims, p.uploader_id),
      kind: 'photo', mime: mimeFromUrl(p.image_url), checksum: '', storage_path: p.image_url, blob_ref: [],
      visibility: 'club', content_length: BigInt(p.file_size ?? 0), encrypted: false, child_sensitive: false,
      retention_until_ms: 0n, deleted: !!p.deleted_at, expires_at_ms: 0n, created_at_ms: timestamp(p.created_at),
      team_id: opt(p.team_id), mini_league_id: opt(p.mini_league_id), competition_id: opt(p.competition_id),
      event_id: opt(p.event_id), caption: opt(p.caption ?? p.title), album_id: opt(p.album_id),
    })),
    capabilities: [], reactions: [], comments: [], roles: [], cards: [],
  };
}
