import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planByteCopies, destinationPath, sha256Hex, copyByteItem, copyClubBytes,
  applyPhotoBlobRefs, applyVaultBlobRefs, BLOB_CHUNK_SIZE,
} from './migrate-club-bytes.mjs';

const CLUB = 'club-1';
const claims = new Map([['user-1', { toText: () => 'aaaaa-aa' }]]);
const CREATOR = { toText: () => 'bbbbb-bb' };

function makeJournal() {
  const entries = new Map();
  const plain = new Map();
  return {
    get: (id) => entries.get(id),
    put: (id, v) => entries.set(id, { ...entries.get(id), ...v }),
    plaintext: (id) => plain.get(id),
    _keep: (id, bytes) => plain.set(id, bytes),
    _entries: entries,
  };
}

function fakeBlobStore() {
  const calls = [];
  return {
    calls,
    async begin_upload(path, mime, size, chunks) { calls.push(['begin', path, Number(size), chunks]); return 'up-1'; },
    async put_chunk(id, i, data) { calls.push(['chunk', id, i, data.length]); },
    async finalize_upload(id) {
      const total = calls.filter(c => c[0] === 'chunk' && c[1] === id).reduce((s, c) => s + c[3], 0);
      void total;
      return { canister: 'store-1', path: calls.find(c => c[0] === 'begin')[1], content_hash: fakeBlobStore.hash };
    },
    async abort_upload(id) { calls.push(['abort', id]); },
    hash: '',
  };
}

function fakePii() {
  const calls = [];
  return {
    calls,
    async register_pii(id, field, marker, owner) { calls.push(['register', id, field, owner, marker.length]); },
    async grant_pii_read_club(id, field, club) { calls.push(['grant', id, club]); },
  };
}

test('planByteCopies maps photos and vault files to club-scoped paths', () => {
  const items = planByteCopies({
    clubId: CLUB, claims, creator: CREATOR,
    photos: [{ id: 'p1', club_id: CLUB, storage_path: 'clubs/club-1/a.jpg', mime_type: 'image/jpeg', uploaded_by: 'user-1' }],
    vaultFiles: [
      { id: 'v1', club_id: CLUB, file_url: 'vault/doc.pdf', mime_type: 'application/pdf', uploaded_by: null },
      { id: 'v2', club_id: CLUB, file_url: '', is_external_link: true },
    ],
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].path, `clubs/${CLUB}/migrated/photos/p1/a.jpg`);
  assert.equal(items[0].owner, 'aaaaa-aa');
  assert.equal(items[1].path, `clubs/${CLUB}/migrated/vault/v1/doc.pdf`);
  assert.equal(items[1].owner, 'bbbbb-bb'); // unattributed -> deploy identity
});

test('planByteCopies refuses foreign rows, missing paths and unclaimed uploaders', () => {
  assert.throws(() => planByteCopies({ clubId: CLUB, claims, creator: CREATOR, photos: [{ id: 'x', club_id: 'other', storage_path: 'a' }] }), /Foreign photo/);
  assert.throws(() => planByteCopies({ clubId: CLUB, claims, creator: CREATOR, photos: [{ id: 'x', club_id: CLUB }] }), /no storage path/);
  assert.throws(() => planByteCopies({ clubId: CLUB, claims, creator: CREATOR, photos: [{ id: 'x', club_id: CLUB, storage_path: 'a', uploaded_by: 'stranger' }] }), /not claimed/);
  assert.throws(() => planByteCopies({ clubId: CLUB, claims, creator: CREATOR, vaultFiles: [{ id: 'x', club_id: CLUB, file_url: '' }] }), /no source URL/);
});

test('destinationPath rejects traversal and NUL', () => {
  assert.throws(() => destinationPath(CLUB, 'photos', 'p1', 'a/../b.jpg'), /Unsafe/);
  assert.throws(() => destinationPath(CLUB, 'photos', 'p1', 'a\0b.jpg'), /Unsafe/);
});

test('copyByteItem encrypts, registers, chunks and finalizes with hash check', async () => {
  const plain = new Uint8Array(BLOB_CHUNK_SIZE + 10).fill(7);
  const journal = makeJournal();
  const blobStore = fakeBlobStore();
  const pii = fakePii();
  const item = { kind: 'photo', id: 'p1', clubId: CLUB, sourcePath: 'src/a.jpg', path: `clubs/${CLUB}/migrated/photos/p1/a.jpg`, mime: 'image/jpeg', owner: 'aaaaa-aa' };
  // Pre-compute what the store will report: encrypt once to learn the hash is
  // impossible (random seed), so have the store echo the hash the job checks.
  // Instead: run once with a store that captures ciphertext and reports its hash.
  let captured;
  blobStore.put_chunk = async (id, i, data) => { blobStore.calls.push(['chunk', id, i, data.length]); (captured ??= []).push(data); };
  blobStore.finalize_upload = async () => {
    const ct = Buffer.concat(captured.map((c) => Buffer.from(c)));
    return { canister: 'store-1', path: item.path, content_hash: sha256Hex(new Uint8Array(ct)) };
  };
  const ref = await copyByteItem({ canisters: { pii_access_control: 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae' } }, await fakePublicKey(), item, {
    download: async () => plain, blobStore, pii, journal,
  });
  assert.equal(captured.length, 2); // 1 MB + 10 bytes
  assert.equal(ref.canister, 'store-1');
  assert.equal(ref.path, item.path);
  assert.equal(ref.content_hash.length, 64);
  assert.deepEqual(pii.calls[0].slice(0, 3), ['register', item.path, 'blob']);
  assert.equal(pii.calls[0][3], 'aaaaa-aa');
  assert.deepEqual(pii.calls[1], ['grant', item.path, CLUB]);
  assert.equal(journal.get('p1').phase, 'finalized');
});

// The production key check needs the real target; bypass by monkey-patching
// is not possible for an imported binding, so tests use a stub target whose
// pii canister is valid and accept that encryptBlob verifies against the real
// production key. For unit tests we pass the real derived key.
async function fakePublicKey() {
  const { productionPiiPublicKey } = await import('./migrate-club-family.mjs');
  return productionPiiPublicKey({ canisters: { pii_access_control: 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae' } });
}

test('copyByteItem refuses to replay an unknown outcome', async () => {
  const journal = makeJournal();
  journal.put('p1', { phase: 'finalizing', uploadId: 'up-1' });
  const item = { kind: 'photo', id: 'p1', clubId: CLUB, sourcePath: 's', path: 'd', mime: 'm', owner: 'o' };
  await assert.rejects(
    copyByteItem({ canisters: {} }, new Uint8Array(96), item, { download: async () => new Uint8Array(1), blobStore: fakeBlobStore(), pii: fakePii(), journal }),
    /Unknown outcome retained/,
  );
});

test('copyByteItem resumes a finalized item without re-uploading', async () => {
  const journal = makeJournal();
  const blobRef = { canister: 's', path: 'p', content_hash: 'h' };
  journal.put('p1', { phase: 'finalized', blobRef });
  const item = { kind: 'photo', id: 'p1', clubId: CLUB, sourcePath: 's', path: 'd', mime: 'm', owner: 'o' };
  const ref = await copyByteItem({ canisters: {} }, new Uint8Array(96), item, { download: async () => { throw Error('must not download'); }, blobStore: fakeBlobStore(), pii: fakePii(), journal });
  assert.equal(ref, blobRef);
});

test('copyClubBytes splits refs by kind and patch helpers fill blob_ref', async () => {
  const journal = makeJournal();
  const blobStore = fakeBlobStore();
  let captured;
  blobStore.put_chunk = async (id, i, data) => { (captured ??= []).push(data); };
  blobStore.finalize_upload = async () => {
    const ct = Buffer.concat(captured.map((c) => Buffer.from(c)));
    captured = undefined;
    return { canister: 'store-1', path: 'p', content_hash: sha256Hex(new Uint8Array(ct)) };
  };
  const key = await fakePublicKey();
  const items = [
    { kind: 'photo', id: 'p1', clubId: CLUB, sourcePath: 'a', path: 'pa', mime: 'm', owner: 'aaaaa-aa' },
    { kind: 'vault', id: 'v1', clubId: CLUB, sourcePath: 'b', path: 'pb', mime: 'm', owner: 'bbbbb-bb' },
  ];
  const refs = await copyClubBytes({ canisters: { pii_access_control: 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae' } }, key, items, {
    download: async () => new Uint8Array(100), blobStore, pii: fakePii(), journal,
  });
  assert.equal(refs.photos.size, 1);
  assert.equal(refs.vault.size, 1);
  const mediaSnap = { assets: [{ id: 'p1', blob_ref: [] }] };
  applyPhotoBlobRefs(mediaSnap, refs.photos);
  assert.equal(mediaSnap.assets[0].blob_ref[0].canister, 'store-1');
  const vaultSnap = { files: [{ id: 'v1', blob_ref: [] }] };
  applyVaultBlobRefs(vaultSnap, refs.vault);
  assert.equal(vaultSnap.files[0].blob_ref[0].canister, 'store-1');
});
