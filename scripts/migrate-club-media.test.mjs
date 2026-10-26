import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildMediaSnapshot, mimeFromUrl } from './migrate-club-media.mjs';
import { snapshotType } from './migrate-club-writers.mjs';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { Principal } = require('@icp-sdk/core/principal');
const member = Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai');
const now = '2026-10-26T00:00:00Z';
const claims = new Map([['u1', member]]);

test('photo metadata keeps scope, caption and source URL with no blob reference yet', async () => {
  const snap = buildMediaSnapshot({
    clubId: 'c1', claims,
    photos: [{ id: 'ph1', club_id: 'c1', uploader_id: 'u1', image_url: 'https://cdn.example/team.PNG?x=1', file_size: 12345,
      team_id: 't1', event_id: 'e1', mini_league_id: null, competition_id: null, caption: 'Goal!', title: null,
      album_id: null, created_at: now, deleted_at: null }],
  });
  const type = await snapshotType(require, new URL('./migrate-schemas/media_metadata.snapshot.did.js', import.meta.url).href);
  const { IDL } = require('@icp-sdk/core/candid');
  const [back] = IDL.decode([type], IDL.encode([type], [snap]));
  const a = back.assets[0];
  assert.equal(a.owner.toText(), member.toText());
  assert.equal(a.mime, 'image/png');
  assert.equal(a.storage_path, 'https://cdn.example/team.PNG?x=1');
  assert.deepEqual(a.blob_ref, []); // bytes move in the separate copy-and-encrypt job
  assert.equal(a.encrypted, false);
  assert.equal(a.content_length, 12345n);
  assert.equal(a.team_id[0], 't1');
  assert.equal(a.event_id[0], 'e1');
  assert.equal(a.caption[0], 'Goal!');
  assert.equal(a.deleted, false);
});

test('albums keep their names and covers; foreign rows and unclaimed uploaders refuse', async () => {
  const photo = { id: 'ph1', club_id: 'c1', uploader_id: 'u1', image_url: 'https://x/a.jpg', created_at: now };
  const snap = buildMediaSnapshot({ clubId: 'c1', claims, photos: [photo],
    albums: [{ id: 'al1', club_id: 'c1', name: 'Grand Final', cover_photo_id: 'ph1', created_by: 'u1', created_at: now }] });
  assert.equal(snap.albums[0][0].title, 'Grand Final');
  assert.deepEqual(snap.albums[0][0].cover_asset_id, ['ph1']);
  const type = await snapshotType(require, new URL('./migrate-schemas/media_metadata.snapshot.did.js', import.meta.url).href);
  const { IDL } = require('@icp-sdk/core/candid');
  const [back] = IDL.decode([type], IDL.encode([type], [snap]));
  assert.equal(back.albums[0][0].title, 'Grand Final');
  assert.throws(() => buildMediaSnapshot({ clubId: 'c1', claims, photos: [photo], albums: [{ id: 'al1', club_id: 'other', created_by: 'u1', created_at: now }] }), /Foreign photo album/);
  assert.throws(() => buildMediaSnapshot({ clubId: 'c1', claims, photos: [photo], albums: [{ id: 'al1', club_id: 'c1', cover_photo_id: 'missing', created_by: 'u1', created_at: now }] }), /cover/);
  assert.throws(() => buildMediaSnapshot({ clubId: 'c1', claims, photos: [{ ...photo, club_id: 'other' }] }), /Foreign photo/);
  assert.throws(() => buildMediaSnapshot({ clubId: 'c1', claims, photos: [{ ...photo, uploader_id: 'stranger' }] }), /claim/);
  assert.throws(() => buildMediaSnapshot({ clubId: 'c1', claims, photos: [photo, photo] }), /Duplicate photo id/);
});

test('mime detection falls back to jpeg and ignores query strings', () => {
  assert.equal(mimeFromUrl('https://x/a.webp?w=100'), 'image/webp');
  assert.equal(mimeFromUrl('https://x/no-extension'), 'image/jpeg');
});
