import { cachedGeneralRoutingActive, routingActive } from "./generalActivation";
import { hasOwnerTestRouting, readOwnerTestRoute } from './ownerTestRouting';
import { getCurrentInternetIdentityConfirmed } from "./internetIdentityAuth";
import { getActiveIcpTarget } from "./targetRegistry";
import { blobAssetUrl, listBlobStoreCanisterIds } from "./mediaStorage";
import { clubIdFromMediaPath, decryptPiiValue, tryDecryptClubMedia } from "./piiVetKeys";
import { readCachedPhoto, writeCachedPhoto } from "./deviceMediaCache";
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

/** Principal from the stored Internet Identity session, without awaiting
 * session restoration. Enough to key the on-device photo cache; never used
 * to derive keys or fetch ciphertext. */
function storedSessionPrincipal(): string | null {
  try {
    const raw = localStorage.getItem("ignite_icp_internet_identity_session");
    const parsed = raw ? (JSON.parse(raw) as { principal?: unknown }) : null;
    return typeof parsed?.principal === "string" ? parsed.principal : null;
  } catch {
    return null;
  }
}

/** Parses a blob-store URL into its canister path, or null when the URL is
 * not served by the configured media_blob_store canister. */
export function parseIcpBlobUrl(
  url: string,
  target: IcpTargetConfig | null,
  requireConfigured = !cachedGeneralRoutingActive() && !hasOwnerTestRouting(),
): { path: string; canisterId: string } | null {
  if (!target) return null;
  // Any configured photo store (sharding) — unknown canisters are rejected.
  const stores = listBlobStoreCanisterIds(target);
  if (requireConfigured && stores.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.replace(/^\/+/, "").split("/");
  let path: string;
  let canisterId: string;
  if (ICP_GATEWAY_HOSTS.includes(parsed.hostname)) {
    // Legacy path-style URLs stored before the subdomain fix.
    if (requireConfigured && !stores.includes(segments[0])) return null;
    canisterId = segments[0];
    path = segments.slice(1).join("/");
  } else {
    const sub = /^([a-z0-9-]+)\.(?:raw\.)?icp0\.io$/.exec(parsed.hostname)?.[1];
    if (!sub || requireConfigured && !stores.includes(sub)) return null;
    canisterId = sub;
    path = segments.join("/");
  }
  return path ? { path, canisterId } : null;
}

/** Stored session principal (sync), for keying instant on-device snapshots. */
export function storedIcpPrincipal(): string | null {
  return storedSessionPrincipal();
}

/** Cache-only lookup: object URL for a photo already decrypted on this
 * device, or null. Never touches the network or derives keys. */
export async function readCachedIcpBlobObjectUrl(url: string): Promise<string | null> {
  const principal = storedSessionPrincipal();
  if (!principal) return null;
  const match = parseIcpBlobUrl(url, getActiveIcpTarget());
  if (!match) return null;
  const cached = await readCachedPhoto(principal, match.canisterId, match.path).catch(() => null);
  return cached ? URL.createObjectURL(cached) : null;
}

/**
 * Returns an object URL with the decrypted bytes when `url` points at the
 * blob store, or null when it is not a blob-store URL. Throws when the
 * bytes cannot be fetched or decrypted — callers must not fall back to the
 * raw URL, which serves only ciphertext.
 */
export async function resolveIcpBlobObjectUrl(url: string): Promise<string | null> {
  let target = getActiveIcpTarget();
  const routeIdentity = await getCurrentInternetIdentityConfirmed();
  const general = routeIdentity ? await routingActive({ target, identity: routeIdentity }) : false;
  const owner = routeIdentity && !general ? await readOwnerTestRoute({ target, identity: routeIdentity }) : null;
  if ((general || owner) && parseIcpBlobUrl(url, target, false)) {
    const { clubDispatch } = await import("./groupDispatch");
    const targets = await clubDispatch.readAcross("media", "media_metadata", async ctx => parseIcpBlobUrl(url, ctx.target, true) ? [ctx.target] : [], parts => parts.flat());
    const unique = [...new Map(targets.map(t => [JSON.stringify(t.canisterIds), t])).values()];
    if (!unique.length) throw new Error("Photo store is not in the approved group inventory");
    if (new Set(unique.map(t => t.canisterIds.pii_access_control)).size !== 1) throw new Error("Photo store has conflicting encryption authorities");
    target = unique[0];
  }
  const match = parseIcpBlobUrl(url, target, true);
  if (!match) return null;
  // Photos seen before on this device open straight from the local cache.
  // Check it BEFORE awaiting session re-confirmation: after a reconnect or
  // tab reload the confirmed identity can take a moment to restore, and a
  // cached photo needs no fresh proof — the bytes are already decrypted
  // on this device, scoped to the stored principal.
  const storedPrincipal = storedSessionPrincipal();
  if (storedPrincipal) {
    const cached = await readCachedPhoto(storedPrincipal, match.canisterId, match.path);
    if (cached) return URL.createObjectURL(cached);
  }
  const identity = await getCurrentInternetIdentityConfirmed();
  if (!identity) {
    throw new Error("Internet Identity sign-in required to decrypt blob-store media");
  }
  const principal = identity.getPrincipal().toText();
  if (principal !== storedPrincipal) {
    const cached = await readCachedPhoto(principal, match.canisterId, match.path);
    if (cached) return URL.createObjectURL(cached);
  }
  // Always fetch via the routable raw subdomain, whatever form was stored.
  const response = await fetch(blobAssetUrl(match.canisterId, match.path));
  if (!response.ok) {
    throw new Error(`Blob store fetch failed (${response.status})`);
  }
  const ciphertext = new Uint8Array(await response.arrayBuffer());
  const ctx = { identity, target };
  // Club photos: try the shared per-club key first (one derivation per club
  // per session); photos locked before the change fall back to their own key.
  const clubId = clubIdFromMediaPath(match.path);
  const plaintext =
    (clubId ? await tryDecryptClubMedia(ctx, clubId, ciphertext) : null) ??
    (await decryptPiiValue(ctx, match.path, MEDIA_BLOB_PII_FIELD, ciphertext));
  // Copy into a plain ArrayBuffer — BlobPart rejects views over a
  // SharedArrayBuffer-backed buffer, and the decrypted bytes come back as a
  // Uint8Array<ArrayBufferLike>.
  const buffer = new ArrayBuffer(plaintext.byteLength);
  new Uint8Array(buffer).set(plaintext);
  void writeCachedPhoto(principal, match.canisterId, match.path, buffer);
  return URL.createObjectURL(new Blob([buffer]));


}
