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

/**
 * Photo-store sharding: extra stores are registered as canister keys
 * media_blob_store_2, media_blob_store_3, … next to the original
 * media_blob_store. Stores are append-only; photos are never moved — each
 * photo's blob_ref/URL names the store that holds it. A full store refuses
 * new uploads ("StoreFull") and stays readable.
 */
const EXTRA_STORE_KEY = /^media_blob_store_(\d+)$/;

type CanisterIdMap = { canisterIds: Record<string, string> } | null | undefined;

/** Configured photo-store keys, original first then by number. */
export function listBlobStoreKeys(target: CanisterIdMap): string[] {
  if (!target) return [];
  const ok = (k: string) => typeof target.canisterIds[k] === "string" && target.canisterIds[k].trim() !== "";
  const extras = Object.keys(target.canisterIds)
    .filter((k) => EXTRA_STORE_KEY.test(k) && ok(k))
    .sort((a, b) => Number(EXTRA_STORE_KEY.exec(a)![1]) - Number(EXTRA_STORE_KEY.exec(b)![1]));
  return ok(MEDIA_BLOB_STORE_KEY) ? [MEDIA_BLOB_STORE_KEY, ...extras] : extras;
}

/** Canister ids of every configured photo store (read-side allow list). */
export function listBlobStoreCanisterIds(target: CanisterIdMap): string[] {
  return listBlobStoreKeys(target).map((k) => target!.canisterIds[k].trim());
}

function hash32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Upload order for a path: rendezvous hashing on the club id (from a
 * clubs/<clubId>/ prefix, else the whole path) so a club's photos stay on
 * one store, and adding a store only moves new uploads for a few clubs.
 */
export function orderBlobStoresForPath(target: CanisterIdMap, path: string): string[] {
  const groupKey = /^clubs\/([^/]+)\//.exec(path)?.[1] ?? path;
  return listBlobStoreKeys(target)
    .map((key) => ({ key, score: hash32(`${groupKey}|${target!.canisterIds[key]}`) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.key);
}

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
export function blobAssetUrl(canisterId: string, path: string): string {
  // Boundary nodes only route canister-subdomain URLs (icp0.io/<id>/… is a
  // 400), and the blob store's uncertified http_request needs the raw domain.
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `https://${canisterId}.raw.icp0.io${cleanPath}`;
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
