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

function knownFull(canisterId: string): boolean {
  const at = fullStores.get(canisterId);
  return at !== undefined && Date.now() - at < FULL_CACHE_MS;
}

export async function getLiveBlobStoreUsage(target: IcpTargetConfig, identity: Identity, storeKey: string) {
  const { actor } = await connectLiveBlobStore(target, identity, storeKey);
  return actor.get_usage();
}

function isStoreFullError(error: unknown): boolean {
  return /StoreFull/.test(error instanceof Error ? error.message : String(error));
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
): Promise<BlobStoreUploadResult> {
  const keys = orderBlobStoresForPath(target, path);
  if (keys.length === 0) throw new Error("No photo store is configured.");
  const candidates = keys.filter((k) => !knownFull(target.canisterIds[k]));
  let lastError: unknown = null;
  for (const key of candidates.length > 0 ? candidates : keys) {
    try {
      return await uploadToStore(target, identity, key, path, bytes, mime);
    } catch (error) {
      if (!isStoreFullError(error)) throw error;
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
): Promise<BlobStoreUploadResult> {
  const { actor, canisterId } = await connectLiveBlobStore(target, identity, storeKey);
  const canister = canisterId.toText();
  const expectedHash = await sha256Hex(bytes);

  const uploadId = await unwrapCandid(
    actor.begin_upload(path, mime, BigInt(bytes.length), chunkCountFor(bytes.length)),
    "Begin blob upload",
  );
  try {
    const chunks = chunkBytes(bytes, BLOB_CHUNK_SIZE);
    for (let index = 0; index < chunks.length; index++) {
      await unwrapCandid(actor.put_chunk(uploadId, index, chunks[index]), `Upload blob chunk ${index}`);
    }
    const finalized = await unwrapCandid(actor.finalize_upload(uploadId), "Finalize blob upload");
    if (finalized.content_hash !== expectedHash) {
      throw new Error(
        `Blob store hash mismatch for ${path}: canister reported ${finalized.content_hash}, local ${expectedHash}.`,
      );
    }
    const blobRef: LiveBlobRef = { canister, path: finalized.path, content_hash: finalized.content_hash };
    return { blobRef, url: blobAssetUrl(canister, finalized.path) };
  } catch (error) {
    try {
      await actor.abort_upload(uploadId);
    } catch {
      // Best-effort cleanup; the original error is the one that matters.
    }
    throw error;
  }
}
