import { getCurrentInternetIdentity } from "./internetIdentityAuth";
import { getActiveIcpTarget } from "./targetRegistry";
import { blobAssetUrl, MEDIA_BLOB_STORE_KEY } from "./mediaStorage";
import { decryptPiiValue } from "./piiVetKeys";
import type { IcpTargetConfig } from "./targetRegistry";

/**
 * Read-side decryption for media stored on the media_blob_store canister.
 *
 * Blob-store URLs serve IBE ciphertext (identity `<path>\u001F"blob"`),
 * so they cannot be handed to <img> directly. This module detects those
 * URLs, fetches the ciphertext, derives the caller's vetKey through the
 * pii_access_control relay (which enforces the owner/club grants), and
 * returns a browser object URL for the decrypted bytes. Key derivation is
 * gated canister-side exactly like PII field reads — a URL alone yields
 * nothing without a grant.
 *
 * The field id MUST stay "blob" in sync with the upload side
 * (mediaUpload.ts) and the canister rules in backend/AGENTS.md.
 */
export const MEDIA_BLOB_PII_FIELD = "blob";

const ICP_GATEWAY_HOSTS = ["icp0.io", "raw.icp0.io"];

/** Parses a blob-store URL into its canister path, or null when the URL is
 * not served by the configured media_blob_store canister. */
export function parseIcpBlobUrl(
  url: string,
  target: IcpTargetConfig | null,
): { path: string; canisterId: string } | null {
  if (!target) return null;
  const canisterId = target.canisterIds[MEDIA_BLOB_STORE_KEY];
  if (!canisterId) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.replace(/^\/+/, "").split("/");
  let path: string;
  if (ICP_GATEWAY_HOSTS.includes(parsed.hostname)) {
    // Legacy path-style URLs stored before the subdomain fix.
    if (segments[0] !== canisterId) return null;
    path = segments.slice(1).join("/");
  } else if (
    parsed.hostname === `${canisterId}.raw.icp0.io` ||
    parsed.hostname === `${canisterId}.icp0.io`
  ) {
    path = segments.join("/");
  } else {
    return null;
  }
  return path ? { path, canisterId } : null;
}

/**
 * Returns an object URL with the decrypted bytes when `url` points at the
 * blob store, or null when it is not a blob-store URL. Throws when the
 * bytes cannot be fetched or decrypted — callers must not fall back to the
 * raw URL, which serves only ciphertext.
 */
export async function resolveIcpBlobObjectUrl(url: string): Promise<string | null> {
  const target = getActiveIcpTarget();
  const match = parseIcpBlobUrl(url, target);
  if (!match) return null;
  const identity = await getCurrentInternetIdentity();
  if (!identity) {
    throw new Error("Internet Identity sign-in required to decrypt blob-store media");
  }
  // Always fetch via the routable raw subdomain, whatever form was stored.
  const response = await fetch(blobAssetUrl(match.canisterId, match.path));
  if (!response.ok) {
    throw new Error(`Blob store fetch failed (${response.status})`);
  }
  const ciphertext = new Uint8Array(await response.arrayBuffer());
  const plaintext = await decryptPiiValue({ identity, target }, match.path, MEDIA_BLOB_PII_FIELD, ciphertext);
  // Copy into a plain ArrayBuffer — BlobPart rejects views over a
  // SharedArrayBuffer-backed buffer, and the decrypted bytes come back as a
  // Uint8Array<ArrayBufferLike>.
  const buffer = new ArrayBuffer(plaintext.byteLength);
  new Uint8Array(buffer).set(plaintext);
  return URL.createObjectURL(new Blob([buffer]));

}
