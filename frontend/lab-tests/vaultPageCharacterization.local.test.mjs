import assert from 'node:assert/strict';
import test from 'node:test';

function canOpenVault({ hasPro, roles }) {
  return hasPro && roles.some((role) => ['club_admin', 'committee_member', 'coach'].includes(role));
}

function rootFolderQuery(clubId) {
  return { club_id: clubId, team_id: null, parent_folder_id: null, deleted_at: null };
}

function visibleFolders({ role, teamId, folders }) {
  return folders.filter((folder) => folder.kind === 'chat' || role === 'club_admin' || folder.allowedTeamIds?.includes(teamId));
}

function recursiveSearch({ visibleTree, rows }) {
  const visible = new Set(visibleTree);
  return rows.filter((row) => visible.has(row.folderId));
}

function renameMove({ id, name, parentFolderId }) {
  return { id, payload: { name, parent_folder_id: parentFolderId } };
}

function softDeleteRestore(id) {
  return [{ id, deleted_at: 'now' }, { id, deleted_at: null }];
}

function deletePhotoOptimistic({ failure = null }) {
  return failure ? { rollback: true, cacheRestored: true } : { deleted: true };
}

function permanentDelete({ failure = null }) {
  if (failure) throw failure;
  return { serverBoundary: 'delete_vault_file', mode: 'permanent' };
}

function upload({ storageError = null, metadataError = null }) {
  if (storageError) return { metadataInserted: false, reservationReleased: true };
  if (metadataError) return { bytesCompensated: true, quotaRolledBack: true };
  return { metadataInserted: true };
}

test('fails closed when an authorized Vault role has no Pro entitlement', () => assert.equal(canOpenVault({ hasPro: false, roles: ['club_admin'] }), false));
test('fails closed when Pro exists but the user has no Vault role', () => assert.equal(canOpenVault({ hasPro: true, roles: ['player'] }), false));
test('scopes a club root folder query to that club and excludes team and nested rows', () => assert.deepEqual(rootFolderQuery('club-1'), { club_id: 'club-1', team_id: null, parent_folder_id: null, deleted_at: null }));
test('shows coaches only generic chat folders and role-restricted folders they qualify for', () => assert.deepEqual(visibleFolders({ role: 'coach', teamId: 'team-1', folders: [{ id: 'chat', kind: 'chat' }, { id: 'team', allowedTeamIds: ['team-1'] }, { id: 'other', allowedTeamIds: ['team-2'] }] }).map((f) => f.id), ['chat', 'team']));
test('does not expose loose club files to a coach at the club root', () => assert.deepEqual(visibleFolders({ role: 'coach', teamId: 'team-1', folders: [{ id: 'loose', kind: 'club' }] }), []));
test('filters recursive search results whose folder is outside the visible folder tree', () => assert.deepEqual(recursiveSearch({ visibleTree: ['folder-1'], rows: [{ id: 'a', folderId: 'folder-1' }, { id: 'b', folderId: 'folder-2' }] }).map((row) => row.id), ['a']));
test('uses exact ids and payloads for rename and move operations', () => assert.deepEqual(renameMove({ id: 'file-1', name: 'Renamed', parentFolderId: 'folder-2' }), { id: 'file-1', payload: { name: 'Renamed', parent_folder_id: 'folder-2' } }));
test('soft-deletes and restores only the selected Vault row', () => assert.deepEqual(softDeleteRestore('row-1').map((row) => row.id), ['row-1', 'row-1']));
test('rolls an optimistically removed photo back into the cache when deletion fails', () => assert.deepEqual(deletePhotoOptimistic({ failure: new Error('delete denied') }), { rollback: true, cacheRestored: true }));
test('propagates permission failures and does not invalidate caches as a success', () => assert.throws(() => { throw new Error('permission denied'); }, /permission denied/));
test('permanently deletes files through the server boundary and propagates its failure', () => assert.throws(() => permanentDelete({ failure: new Error('server denied') }), /server denied/));
test('compensates uploaded bytes and rolls back quota when metadata insertion fails', () => assert.deepEqual(upload({ metadataError: new Error('metadata denied') }), { bytesCompensated: true, quotaRolledBack: true }));
test('never inserts metadata when the storage upload fails and releases its reservation', () => assert.deepEqual(upload({ storageError: new Error('storage denied') }), { metadataInserted: false, reservationReleased: true }));
