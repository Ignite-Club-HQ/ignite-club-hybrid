/**
 * Client side of the media_blob_store upload contract
 * (backend/media_blob_store/media_blob_store.did).
 *
 * Pure module: no Supabase, agent, or canister imports — safe to use from
 * the browser, the migration script (scripts/migrate-media-to-blob-store.mjs),
 * and tests alike. Both the frontend uploader and the migration script share
 * these helpers so they can never drift on chunk size or hashing.
 */

/**
 * Chunk size for put_chunk calls. 1 MB keeps each ingress message well under
 * the ~3 MB subnet limit after Candid encoding overhead.
 */
export const BLOB_CHUNK_SIZE = 1_000_000;

/** Splits `bytes` into consecutive chunks of at most `chunkSize`. */
export function chunkBytes(bytes: Uint8Array, chunkSize = BLOB_CHUNK_SIZE): Uint8Array[] {
  if (chunkSize <= 0) throw new Error("chunkSize must be positive");
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return chunks;
}

/** Number of put_chunk calls begin_upload must declare for `size` bytes. */
export function chunkCountFor(size: number, chunkSize = BLOB_CHUNK_SIZE): number {
  if (size < 0) throw new Error("size must not be negative");
  return Math.max(1, Math.ceil(size / chunkSize));
}

/** Lowercase hex SHA-256 of `bytes` — the contract's content_hash format. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Extracts the storage path from a Supabase public-object URL, e.g.
 * ".../storage/v1/object/public/photos/clubs/c1/x.jpg" -> "clubs/c1/x.jpg".
 * Returns null for URLs not shaped like a public object URL for `bucket`.
 */
export function storagePathFromPublicUrl(url: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const at = url.indexOf(marker);
  if (at === -1) return null;
  const raw = url.slice(at + marker.length).split(/[?#]/, 1)[0];
  if (!raw) return null;
  try {
    return raw.split("/").map(decodeURIComponent).join("/");
  } catch {
    return raw;
  }
}
