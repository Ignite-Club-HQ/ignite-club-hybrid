import type { Identity } from "@icp-sdk/core/agent";
import { idlFactory as blobStoreIdl } from "../lab/bindings/media_blob_store/declarations/media_blob_store.did.js";
import type { _SERVICE as BlobStoreActor } from "../lab/bindings/media_blob_store/declarations/media_blob_store.did.js";
import { createLiveActor } from "./icpAgent";
import { blobAssetUrl, listBlobStoreKeys, MEDIA_BLOB_STORE_KEY, orderBlobStoresForPath, type LiveBlobRef } from "./mediaStorage";
import { BLOB_CHUNK_SIZE, chunkBytes, chunkCountFor, sha256Hex } from "./blobStoreProtocol";
import { unwrapCandid } from "./features/candid";
import type { IcpTargetConfig } from "./targetRegistry";

/**
 * Live connector + chunked uploader for the media_blob_store canister
 * (contract: backend/media_blob_store/media_blob_store.did).
 *
 * The blob store holds media *bytes* on-chain; media_metadata keeps the
 * matching `blob_ref` pointer. Until a blob-store canister ID is registered
 * in placement settings, `isBlobStoreConfigured` is false and callers stay
 * on Supabase storage.
 */

export function isBlobStoreConfigured(target: IcpTargetConfig | null): boolean {
  return listBlobStoreKeys(target).length > 0;
}

export async function connectLiveBlobStore(target: IcpTargetConfig, identity: Identity, storeKey = MEDIA_BLOB_STORE_KEY) {
  return createLiveActor<BlobStoreActor>(target, identity, storeKey, "Media blob store", blobStoreIdl);
}

/** Per-store usage, cached briefly so uploads skip stores known to be full. */
const fullStores = new Map<string, number>();
const FULL_CACHE_MS = 10 * 60_000;
const CHUNK_CONCURRENCY = 4;

function knownFull(canisterId: string): boolean {
  const at = fullStores.get(canisterId);
  return at !== undefined && Date.now() - at < FULL_CACHE_MS;
}

export async function getLiveBlobStoreUsage(target: IcpTargetConfig, identity: Identity, storeKey: string) {
  const { actor } = await connectLiveBlobStore(target, identity, storeKey);
  return actor.get_usage();
}

const FREE_LIMIT_MESSAGES: Record<string, string> = {
  gallery_photo: "You've used your 10 free photo uploads this cycle. Upgrade to Pro for unlimited uploads.",
  chat_photo: "You've used your 10 free chat photos this cycle. Upgrade to Pro for unlimited chat photos.",
  chat_file: "Your club has used its free chat file allowance (10 files / 25 MB) this cycle. Upgrade to Pro for unlimited chat attachments.",
  vault: "Your club has used its free vault allowance (10 files / 25 MB) this cycle. Upgrade to Pro for 5 GB of club storage.",
};

/** Free-plan cap rejection from the canister, mapped to the Supabase wording. */
export function freeLimitMessage(error: unknown): string | null {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes("FileTooLarge")) return "This file is larger than 10 MB. Please choose a smaller file.";
  if (text.includes("StorageAllowanceFull")) return "Your club has used all of its storage. Delete files or purchase more storage to keep uploading.";
  if (text.includes("StorageAllowanceUnavailable")) return "We couldn't check your club's storage right now. Please try again shortly.";
  const m = /FreeLimitReached:(\w+)/.exec(text);
  return m ? FREE_LIMIT_MESSAGES[m[1]] ?? "Free plan upload limit reached. Upgrade to Pro." : null;
}

export interface ClubMediaUsage {
  category: string;
  count: number;
  bytes: number;
  countLimit: number;
  bytesLimit: number | null;
}

/** Free-plan media usage for a club this cycle, summed across photo stores. */
export async function getLiveClubMediaUsage(
  target: IcpTargetConfig,
  identity: Identity,
  clubId: string,
): Promise<Record<string, ClubMediaUsage>> {
  const out: Record<string, ClubMediaUsage> = {};
  for (const key of listBlobStoreKeys(target)) {
    try {
      const { actor } = await connectLiveBlobStore(target, identity, key);
      const rows = await actor.get_club_media_usage(clubId);
      for (const r of rows) {
        const prev = out[r.category];
        out[r.category] = {
          category: r.category,
          count: (prev?.count ?? 0) + Number(r.count),
          bytes: (prev?.bytes ?? 0) + Number(r.bytes),
          countLimit: Number(r.count_limit),
          bytesLimit: r.bytes_limit.length ? Number(r.bytes_limit[0]) : null,
        };
      }
    } catch {
      // Store not upgraded yet / unreachable — skip it.
    }
  }
  return out;
}

export interface ClubMediaBytes {
  finalized: number;
  pending: number;
}

/**
 * Authoritative per-club media bytes (vault + gallery + chat combined) as the
 * photo store's own admission check sees them, summed across photo stores.
 * Stores that predate the query or are unreachable contribute nothing, so
 * callers can fall back to their own accounting.
 */
export async function getLiveClubMediaBytes(
  target: IcpTargetConfig,
  identity: Identity,
  clubId: string,
): Promise<ClubMediaBytes> {
  const out: ClubMediaBytes = { finalized: 0, pending: 0 };
  const keys = listBlobStoreKeys(target);
  if (!keys.length) throw new Error("Club storage cannot be measured: no store configured");
  for (const key of keys) {
    const { actor } = await connectLiveBlobStore(target, identity, key);
    const r = await actor.get_club_media_bytes(clubId);
    out.finalized += Number(r.finalized);
    out.pending += Number(r.pending);
  }
  return out;
}

function isStoreFullError(error: unknown): boolean {
  return /StoreFull/.test(error instanceof Error ? error.message : String(error));
}

/**
 * Deletes bytes previously uploaded via `uploadBytesToBlobStore`. Used by
 * permanent-delete flows so removing a vault item also frees the on-chain
 * blob store space it occupied. Best-effort at call sites — a missing/stale
 * canister id must not block the rest of a deletion.
 */
export async function deleteBlobFromStore(
  target: IcpTargetConfig,
  identity: Identity,
  storeKey: string,
  path: string,
): Promise<void> {
  const { actor } = await connectLiveBlobStore(target, identity, storeKey);
  await unwrapCandid(actor.delete_blob(path), "Delete blob");
}

export interface BlobStoreUploadResult {
  blobRef: LiveBlobRef;
  /** Public on-chain URL serving the bytes (matches blobAssetUrl). */
  url: string;
}

/**
 * Uploads `bytes` to the blob store at `path` using the chunked contract,
 * verifies the canister-reported SHA-256 against the local hash, and returns
 * the blob_ref to record plus the URL to store in place of a Supabase URL.
 * Aborts the partial upload before rethrowing on any failure.
 */
export async function uploadBytesToBlobStore(
  target: IcpTargetConfig,
  identity: Identity,
  path: string,
  bytes: Uint8Array,
  mime: string,
  beforeUpload?: (ref: LiveBlobRef) => Promise<void>,
): Promise<BlobStoreUploadResult> {
  const keys = orderBlobStoresForPath(target, path);
  if (keys.length === 0) throw new Error("No photo store is configured.");
  // Journaled private uploads never change their pinned store, even after a full refusal.
  const candidates = beforeUpload ? keys.slice(0, 1) : keys.filter((k) => !knownFull(target.canisterIds[k]));
  let lastError: unknown = null;
  for (const key of candidates.length > 0 ? candidates : keys) {
    try {
      return await uploadToStore(target, identity, key, path, bytes, mime, beforeUpload);
    } catch (error) {
      const friendly = freeLimitMessage(error);
      if (friendly) throw new Error(friendly);
      if (!isStoreFullError(error)) throw error;
      if (beforeUpload) throw error;
      fullStores.set(target.canisterIds[key], Date.now());
      lastError = error;
    }
  }
  throw new Error(`Every photo store is full — add a new store in Placement Settings. (${String(lastError)})`);
}

async function uploadToStore(
  target: IcpTargetConfig,
  identity: Identity,
  storeKey: string,
  path: string,
  bytes: Uint8Array,
  mime: string,
  beforeUpload?: (ref: LiveBlobRef) => Promise<void>,
): Promise<BlobStoreUploadResult> {
  const { actor, canisterId } = await connectLiveBlobStore(target, identity, storeKey);
  const canister = canisterId.toText();
  const expectedHash = await sha256Hex(bytes);
  await beforeUpload?.({ canister, path, content_hash: expectedHash });

  // A reservation response may be lost after success. Retry identical terms
  // against the same store/path; never fail over an unknown operation.
  let uploadId: string;
  try {
    uploadId = await unwrapCandid(actor.begin_upload(path, mime, BigInt(bytes.length), chunkCountFor(bytes.length)), "Begin blob upload");
  } catch (error) {
    if (freeLimitMessage(error) || isStoreFullError(error)) throw error;
    uploadId = await unwrapCandid(actor.begin_upload(path, mime, BigInt(bytes.length), chunkCountFor(bytes.length)), "Resume blob upload");
  }
  let finalizeStarted = false;
  try {
    // Chunks are independent, index-addressed writes, so send several at once
    // instead of waiting ~2s per chunk round trip.
    const chunks = chunkBytes(bytes, BLOB_CHUNK_SIZE);
    let next = 0;
    const worker = async () => {
      while (next < chunks.length) {
        const index = next++;
        await unwrapCandid(actor.put_chunk(uploadId, index, chunks[index]), `Upload blob chunk ${index}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, worker));
    finalizeStarted = true;
    let finalized;
    try {
      finalized = await unwrapCandid(actor.finalize_upload(uploadId), "Finalize blob upload");
    } catch {
      // The server's journal makes the same finalize retry safe even after
      // committing bytes or the quota. Do not release uncertain commits.
      finalized = await unwrapCandid(actor.finalize_upload(uploadId), "Confirm blob upload");
    }
    if (finalized.content_hash !== expectedHash) {
      throw new Error(
        `Blob store hash mismatch for ${path}: canister reported ${finalized.content_hash}, local ${expectedHash}.`,
      );
    }
    const blobRef: LiveBlobRef = { canister, path: finalized.path, content_hash: finalized.content_hash };
    return { blobRef, url: blobAssetUrl(canister, finalized.path) };
  } catch (error) {
    if (!finalizeStarted) {
      try {
        await actor.abort_upload(uploadId);
      } catch {
        // The durable journal retains unresolved releases for recovery.
      }
    }
    throw error;
  }
}
