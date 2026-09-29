/**
 * Resolves where a media asset's bytes live.
 *
 * Today every asset's bytes sit in Supabase storage, addressed by the
 * canister asset's `storage_path`. The media_metadata canister also carries
 * an optional `blob_ref` pointer to an ICP blob-store canister (canister key
 * "media_blob_store"). When a blob store is deployed, assets uploaded there
 * carry that pointer and resolve to an on-chain URL instead — feature code
 * only ever consumes LiveMediaSource, so the switch touches nothing outside
 * this module.
 *
 * Pure module: no Supabase or canister imports (same cycle rule as
 * targetRegistry/backendRouting).
 */

export const MEDIA_BLOB_STORE_KEY = "media_blob_store";

/** Matches the Candid BlobRef record on the media_metadata canister. */
export interface LiveBlobRef {
  canister: string;
  path: string;
  content_hash: string;
}

export type LiveMediaSource =
  | { kind: "supabase"; storagePath: string }
  | { kind: "icp-blob"; canisterId: string; path: string; contentHash: string; url: string };

/** Asset shape subset needed to locate bytes (Candid opt decodes to [] | [value]). */
export interface LiveAssetLocation {
  storage_path: string;
  blob_ref?: [] | [LiveBlobRef];
}

/** Public URL for a blob served by an asset/blob-store canister. */
export function blobAssetUrl(canisterId: string, path: string, host = "https://icp0.io"): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${host.replace(/\/+$/, "")}/${canisterId}${cleanPath}`;
}

export function resolveMediaSource(asset: LiveAssetLocation): LiveMediaSource {
  const ref = asset.blob_ref?.[0];
  if (ref) {
    return {
      kind: "icp-blob",
      canisterId: ref.canister,
      path: ref.path,
      contentHash: ref.content_hash,
      url: blobAssetUrl(ref.canister, ref.path),
    };
  }
  return { kind: "supabase", storagePath: asset.storage_path };
}
