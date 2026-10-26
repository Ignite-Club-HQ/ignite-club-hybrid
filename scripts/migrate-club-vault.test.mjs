import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildVaultSnapshot } from './migrate-club-vault.mjs';
import { snapshotType } from './migrate-club-writers.mjs';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { Principal } = require('@icp-sdk/core/principal');
const member = Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai');
const creator = Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai');
const now = '2026-10-26T00:00:00Z';
const claims = new Map([['u1', member]]);
const folder = { id: 'f1', club_id: 'c1', team_id: 't1', name: 'Policies', sort_order: 2, description: 'Club policies', color: '#fff', created_by: 'u1', created_at: now };

test('vault folders and files keep tree links, attribution and source URLs', async () => {
  const snap = buildVaultSnapshot({
    clubId: 'c1', claims, creator, folders: [folder],
    files: [
      { id: 'v1', club_id: 'c1', folder_id: 'f1', team_id: 't1', name: 'Policy.pdf', file_url: 'https://files/policy.pdf',
        file_size: 999, file_type: 'application/pdf', uploaded_by: 'u1', created_at: now, deleted_at: null, deleted_by: null,
        mini_league_id: null, competition_id: null, is_external_link: false },
      { id: 'v2', club_id: 'c1', folder_id: null, team_id: null, name: 'Link', file_url: 'https://drive.example/doc',
        file_size: null, file_type: null, uploaded_by: null, created_at: now, is_external_link: true },
    ],
  });
  const type = await snapshotType(require, new URL('./migrate-schemas/vault_domain.snapshot.did.js', import.meta.url).href);
  const { IDL } = require('@icp-sdk/core/candid');
  const [back] = IDL.decode([type], IDL.encode([type], [snap]));
  const f = back.folders[0];
  assert.equal(f.created_by.toText(), member.toText());
  assert.equal(f.sort_order, 2);
  assert.equal(f.description[0], 'Club policies');
  const [v1, v2] = back.files;
  assert.equal(v1.folder_id, 'f1');
  assert.equal(v1.uploaded_by.toText(), member.toText());
  assert.equal(v1.size, 999n);
  assert.deepEqual(v1.blob_ref, []); // bytes move in the separate copy-and-encrypt job
  assert.equal(v2.folder_id, ''); // root file
  assert.equal(v2.uploaded_by.toText(), creator.toText()); // legacy null uploader attributed to the migration
  assert.equal(v2.is_external_link, true);
  assert.equal(v2.mime, 'application/octet-stream');
});

test('refuses foreign rows, missing folders, duplicates and unclaimed owners', () => {
  assert.throws(() => buildVaultSnapshot({ clubId: 'c1', claims, creator, folders: [{ ...folder, club_id: 'other' }] }), /Foreign vault folder/);
  assert.throws(() => buildVaultSnapshot({ clubId: 'c1', claims, creator, files: [{ id: 'v', club_id: 'c1', folder_id: 'nope', name: 'x', file_url: 'u', created_at: now }] }), /folder missing/);
  assert.throws(() => buildVaultSnapshot({ clubId: 'c1', claims, creator, folders: [folder, folder] }), /Duplicate folder id/);
  assert.throws(() => buildVaultSnapshot({ clubId: 'c1', claims, creator, folders: [{ ...folder, created_by: 'stranger' }] }), /claim/);
  assert.throws(() => buildVaultSnapshot({ clubId: 'c1', claims, creator, files: [{ id: 'v', club_id: 'other', folder_id: null, name: 'x', file_url: 'u', created_at: now }] }), /Foreign vault file/);
});
