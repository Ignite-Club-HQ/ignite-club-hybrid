// Pure conversion: Supabase team_folders + vault_files -> vault_domain
// VaultSnapshot. No network, no source writes. Metadata only: file_url keeps
// pointing at the Supabase object and blob_ref stays empty until the separate
// byte-copy-and-encrypt job moves the bytes into the group's blob store.
import { claimedPrincipal, timestamp } from './migrate-club-members.mjs';
const opt = (v) => (v == null || v === '' ? [] : [v]);
const optTs = (v) => (v == null ? [] : [timestamp(v)]);
const nat32 = (v) => {
  const n = Number(v ?? 0);
  if (!Number.isSafeInteger(n) || n < 0 || n > 4294967295) throw Error('Invalid source value');
  return n;
};

export function buildVaultSnapshot({ clubId, folders = [], files = [], claims, creator }) {
  if (!creator) throw Error('Creator principal required');
  for (const f of folders) if (f.club_id !== clubId) throw Error('Foreign vault folder refused');
  for (const f of files) if (f.club_id !== clubId) throw Error('Foreign vault file refused');
  const folderIds = new Set(folders.map((f) => f.id));
  if (folderIds.size !== folders.length) throw Error('Duplicate folder id refused');
  const fileIds = new Set(files.map((f) => f.id));
  if (fileIds.size !== files.length) throw Error('Duplicate file id refused');
  // uploaded_by/created_by are nullable on legacy rows; the deploy identity
  // stands in so the record stays attributed to the migration, not a member.
  const owner = (uid) => (uid ? claimedPrincipal(claims, uid) : creator);
  return {
    folders: folders.map((f) => ({
      id: f.id, club: clubId, team: opt(f.team_id), parent_id: [], name: f.name ?? 'Folder',
      restricted_roles: [], created_by: owner(f.created_by), created_at_ms: timestamp(f.created_at),
      deleted_at_ms: [], deleted_by: [], mini_league_id: [], competition_id: [],
      sort_order: nat32(f.sort_order), description: opt(f.description), color: opt(f.color),
    })),
    files: files.map((f) => {
      if (f.folder_id && !folderIds.has(f.folder_id)) throw Error('Vault file folder missing');
      return {
        id: f.id, folder_id: f.folder_id ?? '', club: clubId, team: opt(f.team_id), name: f.name ?? 'File',
        file_url: f.file_url, size: BigInt(f.file_size ?? 0), mime: f.file_type ?? 'application/octet-stream',
        uploaded_by: owner(f.uploaded_by), created_at_ms: timestamp(f.created_at), deleted_at_ms: optTs(f.deleted_at),
        deleted_by: f.deleted_by ? [claimedPrincipal(claims, f.deleted_by)] : [],
        mini_league_id: opt(f.mini_league_id), competition_id: opt(f.competition_id),
        is_external_link: !!f.is_external_link, blob_ref: [],
      };
    }),
  };
}
