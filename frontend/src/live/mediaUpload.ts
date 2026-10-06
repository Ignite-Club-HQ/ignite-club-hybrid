import { getCurrentInternetIdentity } from "./internetIdentityAuth";
import { getActiveIcpTarget } from "./targetRegistry";
import { isBlobStoreConfigured, uploadBytesToBlobStore } from "./blobStoreUpload";
import { resolveAuthBackend } from "./authBackendMode";
import { clubIdFromMediaPath, encryptClubMedia, encryptPiiValue, isClubMediaLockSupported } from "./piiVetKeys";
import { grantLiveClubPiiRead, registerLivePii } from "./features/vault";
import { MEDIA_BLOB_PII_FIELD } from "./mediaDecrypt";
import type { LiveBlobRef } from "./mediaStorage";

/**
 * Upload-side routing for media bytes: the mirror of resolveMediaSource on
 * the read side. Callers keep their existing Supabase storage upload as the
 * fallback branch — this returns null, and nothing changes, until BOTH:
 *   1. an admin has registered a media_blob_store canister ID in placement
 *      settings, and
 *   2. the member is signed in with Internet Identity (canister writes need
 *      an authenticated principal).
 * Once both hold, uploads go on-chain and the returned URL is stored in the
 * photo/vault row instead of a Supabase storage URL. A configured-but-failed
 * upload throws rather than silently diverting bytes to Supabase (same rule
 * as featureRouter.ts).
 *
 * Encryption: bytes are IBE-encrypted in the browser (identity
 * `<storagePath>"blob"`) before leaving the device, so the blob
 * store only ever holds ciphertext. The matching pii_access_control record
 * (pii_id = storagePath, field_id = "blob", domain owner = uploader) gates
 * who may derive the decryption vetKey — it is REQUIRED, so a registration
 * failure fails the whole upload (an orphaned blob would be undecryptable
 * by everyone). The club read grant, derived from a `clubs/<clubId>/` path
 * prefix, is best-effort like every other grant.
 */

/**
 * True when media uploads cannot succeed for the current session: the member
 * is on the ICP backend and no media_blob_store canister is configured yet.
 * UI surfaces use this to HIDE upload controls for Internet Identity members
 * (blocked options must not be visible), rather than throwing on submit.
 * Supabase-mode sessions always return false — their uploads work as before.
 */
export function isIcpMediaUploadUnavailable(): boolean {
  if (resolveAuthBackend() !== "icp") return false;
  return !isBlobStoreConfigured(getActiveIcpTarget());
}

export interface BlobMediaUpload {
  /** On-chain URL to persist in place of a Supabase storage URL. */
  url: string;
  /** Pointer to record on the media_metadata asset via set_blob_ref. */
  blobRef: LiveBlobRef;
}

export async function tryUploadMediaToBlobStore(args: {
  storagePath: string;
  file: File | Blob;
  mime: string;
  /** "own" keeps the per-file lock even under clubs/ (e.g. vault files,
   * which only club staff may open — the club lock admits every member). */
  lock?: "club" | "own";
}): Promise<BlobMediaUpload | null> {
  const target = getActiveIcpTarget();
  if (!isBlobStoreConfigured(target)) return null;
  const identity = await getCurrentInternetIdentity();
  if (!identity) return null;
  const ctx = { target, identity };
  const bytes = new Uint8Array(await args.file.arrayBuffer());
  // Club photos (clubs/<clubId>/...) share one per-club lock when the
  // deployed canister supports it: no per-photo record, and readers need one
  // key per club per session. Others keep the per-photo lock.
  const clubId = clubIdFromMediaPath(args.storagePath);
  if (clubId && args.lock !== "own" && (await isClubMediaLockSupported(ctx))) {
    const ciphertext = await encryptClubMedia(ctx, clubId, bytes);
    return uploadBytesToBlobStore(target, identity, args.storagePath, ciphertext, args.mime);
  }
  const ciphertext = await encryptPiiValue(ctx, args.storagePath, MEDIA_BLOB_PII_FIELD, bytes);
  const result = await uploadBytesToBlobStore(target, identity, args.storagePath, ciphertext, args.mime);
  // The stored record's ciphertext is only a content-hash marker — the real
  // bytes are served by the blob store. What matters is that the record
  // exists so the vetKey relay can authorize readers against it.
  await registerLivePii(
    ctx,
    args.storagePath,
    MEDIA_BLOB_PII_FIELD,
    new TextEncoder().encode(result.blobRef.content_hash),
    identity.getPrincipal(),
  );
  if (clubId) {
    await grantLiveClubPiiRead(ctx, args.storagePath, MEDIA_BLOB_PII_FIELD, clubId);
  }
  return result;
}
