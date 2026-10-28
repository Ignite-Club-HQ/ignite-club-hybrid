import type { FeatureBackendContext } from "./featureRouter";
import { readContentInScope } from "./contentRouting";
import { writeOnce } from "./clubScope";
import { getCurrentInternetIdentity } from "./internetIdentityAuth";
import { getActiveIcpTarget } from "./targetRegistry";
import { isBlobStoreConfigured, uploadBytesToBlobStore } from "./blobStoreUpload";
import { resolveAuthBackend } from "./authBackendMode";
import { clubIdFromMediaPath, encryptClubMedia, encryptPiiValue, encryptSharedValue, isClubMediaLockSupported, type SharedAudience } from "./piiVetKeys";
import { grantLiveClubPiiRead, grantLivePiiReadClub, grantLivePiiReadCompetition, registerLivePii } from "./features/vault";
import { MEDIA_BLOB_PII_FIELD } from "./mediaDecrypt";
import type { LiveBlobRef } from "./mediaStorage";
import { sha256Hex } from "./blobStoreProtocol";

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
  context?: FeatureBackendContext;
  storagePath: string;
  file: File | Blob;
  mime: string;
  competitionId?: string;
  /** "own" keeps the per-file lock even under clubs/ (e.g. vault files,
   * which only club staff may open — the club lock admits every member). */
  lock?: "club" | "own";
  /** Role-limited Vault files: lock bytes to this shared audience key. */
  audience?: SharedAudience;
  beforeUpload?: (ref: LiveBlobRef) => Promise<void>;
}): Promise<BlobMediaUpload | null> {
  const target = args.context?.target ?? getActiveIcpTarget();
  if (!isBlobStoreConfigured(target)) return null;
  const identity = args.context?.identity ?? await getCurrentInternetIdentity();
  if (!identity) return null;
  if (args.file.size > 10 * 1024 * 1024) {
    throw new Error("This file is larger than 10 MB. Please choose a smaller file.");
  }
  const ctx = { target, identity };
  const pathClub = clubIdFromMediaPath(args.storagePath);
  if (!args.context && pathClub) {
    return readContentInScope(ctx, "media", writeOnce({ clubId: pathClub }), scoped => tryUploadMediaToBlobStore({ ...args, context: scoped }));
  }
  const bytes = new Uint8Array(await args.file.arrayBuffer());
  // Club photos (clubs/<clubId>/...) share one per-club lock when the
  // deployed canister supports it: no per-photo record, and readers need one
  // key per club per session. Others keep the per-photo lock.
  const clubId = clubIdFromMediaPath(args.storagePath);
  if (clubId && !args.competitionId && args.lock !== "own" && (await isClubMediaLockSupported(ctx))) {
    const ciphertext = await encryptClubMedia(ctx, clubId, bytes);
    return args.beforeUpload
      ? uploadBytesToBlobStore(target, identity, args.storagePath, ciphertext, args.mime, args.beforeUpload)
      : uploadBytesToBlobStore(target, identity, args.storagePath, ciphertext, args.mime);
  }
  const ciphertext = args.audience
    ? await encryptSharedValue(ctx, args.audience, bytes)
    : await encryptPiiValue(ctx, args.storagePath, MEDIA_BLOB_PII_FIELD, bytes);
  // The access record's ciphertext is only a content-hash marker (the store
  // re-verifies the same hash on finalize), so register it IN PARALLEL with
  // the byte upload instead of after it — saves two sequential round trips.
  const localHash = await sha256Hex(ciphertext);
  // Vault intent must be durable before either bytes or access records leave the device.
  // The uploader repeats this exact idempotent binding before its first byte reservation.
  const { orderBlobStoresForPath } = await import("./mediaStorage");
  if (args.beforeUpload) {
    const key = orderBlobStoresForPath(target, args.storagePath)[0];
    const canister = key ? target.canisterIds[key] : undefined;
    if (!canister) throw new Error("No private file store is configured.");
    await args.beforeUpload({ canister, path: args.storagePath, content_hash: localHash });
  }
  const registration = (async () => {
    await registerLivePii(
      ctx,
      args.storagePath,
      MEDIA_BLOB_PII_FIELD,
      new TextEncoder().encode(localHash),
      identity.getPrincipal(),
    );
    if (clubId && !args.competitionId) {
      if (args.beforeUpload) await grantLivePiiReadClub(ctx, args.storagePath, MEDIA_BLOB_PII_FIELD, clubId);
      else await grantLiveClubPiiRead(ctx, args.storagePath, MEDIA_BLOB_PII_FIELD, clubId);
    }
    if (args.competitionId) {
      await grantLivePiiReadCompetition(ctx, args.storagePath, MEDIA_BLOB_PII_FIELD, args.competitionId);
    }
  })();
  const [result] = await Promise.all([
    args.beforeUpload
      ? uploadBytesToBlobStore(target, identity, args.storagePath, ciphertext, args.mime, args.beforeUpload)
      : uploadBytesToBlobStore(target, identity, args.storagePath, ciphertext, args.mime),
    registration,
  ]);
  return result;
}
