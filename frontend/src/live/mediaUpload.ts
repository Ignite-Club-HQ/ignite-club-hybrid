import { getCurrentInternetIdentity } from "./internetIdentityAuth";
import { getActiveIcpTarget } from "./targetRegistry";
import { isBlobStoreConfigured, uploadBytesToBlobStore } from "./blobStoreUpload";
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
 */

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
}): Promise<BlobMediaUpload | null> {
  const target = getActiveIcpTarget();
  if (!isBlobStoreConfigured(target)) return null;
  const identity = await getCurrentInternetIdentity();
  if (!identity) return null;
  const bytes = new Uint8Array(await args.file.arrayBuffer());
  return uploadBytesToBlobStore(target, identity, args.storagePath, bytes, args.mime);
}
