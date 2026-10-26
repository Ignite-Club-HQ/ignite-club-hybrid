// Media/Vault byte copy-and-encrypt: downloads each photo/Vault file from
// Supabase storage, IBE-encrypts it offline to the destination group's
// production PII key, uploads the ciphertext to the group's media_blob_store
// with the chunked contract, and registers the matching pii_access_control
// record so the bytes are decryptable by the club. Metadata steps (media,
// vault) run first with empty blob_ref; this job patches the pointers in.
//
// Safety rules (mirrors frontend/src/live/blobStoreUpload.ts):
// - begin_upload is retried once with identical terms against the same
//   store/path; a lost reservation response must not duplicate uploads.
// - finalize_upload is retried once; the canister journal makes the same
//   finalize safe after committing bytes.
// - Any other unknown outcome is RETAINED in the journal and stops the job —
//   never replayed, never failed over to another store.
// - PII registration uses the ciphertext's SHA-256 as the marker ciphertext,
//   exactly like the app, so the store's finalize hash check agrees.

import { createHash } from 'node:crypto';
import { productionPiiPublicKey } from './migrate-club-family.mjs';

export const BLOB_CHUNK_SIZE = 1_000_000;
export const BLOB_FIELD = 'blob';
const CHUNK_CONCURRENCY = 4;

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Deterministic club-scoped destination path for a migrated byte item. */
export function destinationPath(clubId, kind, id, sourcePath) {
  const src = String(sourcePath ?? '');
  const base = src.split('/').pop() || 'file';
  if (src.split('/').includes('..') || src.includes('\0')) throw Error(`Unsafe source path refused: ${sourcePath}`);
  return `clubs/${clubId}/migrated/${kind}/${id}/${base}`;
}

/**
 * Pure plan: one item per photo/Vault file that has bytes to copy.
 * Refuses: rows from another club, external links (no bytes), rows with no
 * storage path, and items whose uploader is neither claimed nor the club
 * creator (their PII record would be owned by a stranger).
 */
export function planByteCopies({ clubId, photos = [], vaultFiles = [], claims, creator }) {
  const items = [];
  const creatorText = typeof creator === 'string' ? creator : creator.toText();
  const ownerFor = (userId, label) => {
    if (!userId) return creatorText;
    const p = claims?.get(userId);
    if (!p) throw Error(`${label} uploader ${userId} has not claimed an account; refusing to copy their bytes`);
    return typeof p === 'string' ? p : p.toText();
  };
  for (const ph of photos) {
    if (ph.club_id !== clubId) throw Error('Foreign photo refused');
    if (!ph.storage_path) throw Error(`Photo ${ph.id} has no storage path; nothing to copy`);
    items.push({
      kind: 'photo', id: ph.id, clubId,
      sourcePath: ph.storage_path,
      path: destinationPath(clubId, 'photos', ph.id, ph.storage_path),
      mime: ph.mime_type || 'application/octet-stream',
      owner: ownerFor(ph.uploaded_by, `Photo ${ph.id}`),
    });
  }
  for (const f of vaultFiles) {
    if (f.club_id !== clubId) throw Error('Foreign vault file refused');
    if (f.is_external_link) continue; // links have no bytes
    if (!f.file_url) throw Error(`Vault file ${f.id} has no source URL; nothing to copy`);
    items.push({
      kind: 'vault', id: f.id, clubId,
      sourcePath: f.file_url,
      path: destinationPath(clubId, 'vault', f.id, f.file_url),
      mime: f.mime_type || 'application/octet-stream',
      owner: ownerFor(f.uploaded_by, `Vault file ${f.id}`),
    });
  }
  const seen = new Set();
  for (const it of items) {
    if (seen.has(it.path)) throw Error(`Duplicate destination path ${it.path}`);
    seen.add(it.path);
  }
  return items;
}

/**
 * IBE-encrypt bytes to the production key under identity `path ++ U+001F ++ "blob"`.
 * The seed is derived deterministically from the path and plaintext so an
 * interrupted item re-encrypts to the SAME ciphertext and content hash —
 * resume re-registers an identical PII marker instead of conflicting with it.
 */
export async function encryptBlob(target, publicKey, path, bytes) {
  const { DerivedPublicKey, IbeCiphertext, IbeIdentity, IbeSeed } = await import(new URL('../frontend/node_modules/@icp-sdk/vetkeys/dist/lib/index.es.js', import.meta.url).href);
  const expected = await productionPiiPublicKey(target);
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== expected.length || publicKey.some((b, i) => b !== expected[i])) {
    throw Error('Destination PII public key mismatch');
  }
  const seedBytes = createHash('sha256').update(`${path}\u001f`).update(bytes).digest();
  return IbeCiphertext.encrypt(
    DerivedPublicKey.deserialize(publicKey),
    IbeIdentity.fromBytes(new TextEncoder().encode(`${path}${BLOB_FIELD}`)),
    bytes,
    IbeSeed.fromBytes(seedBytes),
  ).serialize();
}

/**
 * Live copy of one planned item. `deps` are injected so tests never touch a
 * network: { download(sourcePath) -> Uint8Array, blobStore, pii, journal }.
 * The journal records each acknowledged phase per item id; an item whose
 * last phase is unknown (begin/finalize threw twice) is left for recovery
 * and throws 'Unknown outcome retained'.
 */
export async function copyByteItem(target, publicKey, item, deps) {
  const { download, blobStore, pii, journal } = deps;
  const prior = journal.get(item.id);
  if (prior?.phase === 'finalized') return prior.blobRef;
  if (prior && prior.phase !== 'downloaded' && prior.phase !== 'encrypted' && prior.phase !== 'registered' && prior.phase !== 'begun') {
    throw Error(`Unknown outcome retained for ${item.id} at phase ${prior.phase}; recover before retrying`);
  }

  // Plaintext is never persisted: resume re-downloads and the deterministic
  // seed reproduces the identical ciphertext/hash, so re-registration and the
  // journaled upload reservation stay consistent.
  const plain = await download(item.sourcePath);
  journal.put(item.id, { phase: 'downloaded', bytes: plain.length });

  const ciphertext = await encryptBlob(target, publicKey, item.path, plain);
  const hash = sha256Hex(ciphertext);
  journal.put(item.id, { phase: 'encrypted', bytes: plain.length, hash });

  // PII record: marker ciphertext is the content hash, owner is the claimed
  // uploader (or the deploy identity for unattributed rows). Club read grant
  // is best-effort, matching the app.
  await pii.register_pii(item.path, BLOB_FIELD, Array.from(new TextEncoder().encode(hash)), item.owner);
  try {
    await pii.grant_pii_read_club(item.path, BLOB_FIELD, item.clubId);
  } catch {
    // Best-effort like the app; the owner record already protects the bytes.
  }
  journal.put(item.id, { phase: 'registered', hash });

  const chunkCount = Math.max(1, Math.ceil(ciphertext.length / BLOB_CHUNK_SIZE));
  let uploadId = prior?.uploadId;
  if (!uploadId) {
    try {
      uploadId = await blobStore.begin_upload(item.path, item.mime, BigInt(ciphertext.length), chunkCount);
    } catch {
      // Identical-terms retry only; a lost reservation must not duplicate.
      uploadId = await blobStore.begin_upload(item.path, item.mime, BigInt(ciphertext.length), chunkCount);
    }
    journal.put(item.id, { phase: 'begun', hash, uploadId });
  }

  const chunks = [];
  for (let off = 0; off < ciphertext.length; off += BLOB_CHUNK_SIZE) chunks.push(ciphertext.subarray(off, off + BLOB_CHUNK_SIZE));
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const index = next++;
      await blobStore.put_chunk(uploadId, index, chunks[index]);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, worker));
  } catch (error) {
    try { await blobStore.abort_upload(uploadId); } catch { /* journal retains it */ }
    throw error;
  }

  let finalized;
  try {
    finalized = await blobStore.finalize_upload(uploadId);
  } catch {
    finalized = await blobStore.finalize_upload(uploadId);
  }
  if (finalized.content_hash !== hash) {
    throw Error(`Blob store hash mismatch for ${item.path}: canister ${finalized.content_hash}, local ${hash}`);
  }
  const blobRef = { canister: finalized.canister, path: finalized.path, content_hash: finalized.content_hash };
  journal.put(item.id, { phase: 'finalized', hash, uploadId, blobRef });
  return blobRef;
}

/**
 * Copy every planned item in order, then return { photos, vault } maps of
 * item id -> BlobRef for patching the media/vault snapshots. Stops at the
 * first unknown outcome; completed items stay finalized in the journal.
 */
export async function copyClubBytes(target, publicKey, items, deps) {
  const refs = { photos: new Map(), vault: new Map() };
  for (const item of items) {
    const ref = await copyByteItem(target, publicKey, item, deps);
    (item.kind === 'photo' ? refs.photos : refs.vault).set(item.id, ref);
  }
  return refs;
}

/** Patch blob_ref pointers into an already-built media snapshot (pure). */
export function applyPhotoBlobRefs(mediaSnap, refs) {
  for (const asset of mediaSnap.assets) {
    const ref = refs.get(asset.id);
    if (ref) asset.blob_ref = [ref];
  }
  return mediaSnap;
}

/** Patch blob_ref pointers into an already-built vault snapshot (pure). */
export function applyVaultBlobRefs(vaultSnap, refs) {
  for (const file of vaultSnap.files) {
    const ref = refs.get(file.id);
    if (ref) file.blob_ref = [ref];
  }
  return vaultSnap;
}
