import {
  DerivedPublicKey,
  EncryptedVetKey,
  IbeCiphertext,
  IbeIdentity,
  IbeSeed,
  TransportSecretKey,
  VetKey,
} from "@icp-sdk/vetkeys";
import { connectLivePiiAccessControl } from "./domains";
import type { FeatureBackendContext } from "./featureRouter";
import { unwrapCandid } from "./features/candid";
import { clearDeviceMediaCaches, forgetStoredClubKey, loadStoredClubKey, storeClubKey } from "./deviceMediaCache";

/**
 * Client-side vetKeys (IBE) cryptography for pii_access_control.
 *
 * The canister holds no key material: writers encrypt offline under the
 * canister's IBE public key (fetched once per canister, also derivable
 * offline from the subnet master key), readers fetch their vetKey through
 * the canister's authorization-gated relay and decrypt locally. All
 * cryptography happens here — the Motoko side only relays encrypted keys.
 *
 * The IBE identity for a record is `pii_id ++ "\u001F" ++ field_id` (unit
 * separator); it must stay byte-identical with ibeIdentity in
 * backend/pii_access_control/src/main.mo.
 *
 * Derived vetKeys are cached in memory for the session (each derivation is
 * a paid vetkd_derive_key call on the canister). The cache is cleared on
 * sign-out via clearPiiVetKeyCache.
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** IBE identity bytes for a record. Mirrors ibeIdentity in main.mo. */
export function piiIbeIdentity(piiId: string, fieldId: string): Uint8Array {
  return textEncoder.encode(`${piiId}${fieldId}`);
}

/** Canister relay caps a vetKey batch at 25 (each derivation costs cycles). */
const VETKEY_BATCH_SIZE = 25;

let verificationKeyCache: { canisterId: string; key: DerivedPublicKey } | null = null;
const vetKeyCache = new Map<string, VetKey>();

/** Drops all cached key material — call on sign-out / identity switch. */
export function clearPiiVetKeyCache(): void {
  verificationKeyCache = null;
  vetKeyCache.clear();
  clubMediaKeyCache.clear();
  clubMediaLockSupported = null;
  void clearDeviceMediaCaches();
}

// ==================== Per-club photo key ====================

/** Field id of media blobs — must equal MEDIA_BLOB_PII_FIELD. */
const CLUB_MEDIA_FIELD = "blob";
const clubMediaKeyCache = new Map<string, Promise<VetKey>>();
let clubMediaLockSupported: Promise<boolean> | null = null;

/** pii id whose IBE identity locks every photo of a club. Mirrors main.mo. */
export function clubMediaPiiId(clubId: string): string {
  return `clubmedia:${clubId}`;
}

/** Club id from a `clubs/<clubId>/...` storage path, else null. */
export function clubIdFromMediaPath(path: string): string | null {
  return /^clubs\/([^/]+)\//.exec(path)?.[1] ?? null;
}

/**
 * True when the deployed pii_access_control supports the per-club photo key
 * (older canisters lack club_media_lock_version). Checked once per session.
 */
export function isClubMediaLockSupported(ctx: FeatureBackendContext): Promise<boolean> {
  if (!clubMediaLockSupported) {
    clubMediaLockSupported = (async () => {
      try {
        const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
        await (actor as unknown as { club_media_lock_version: () => Promise<bigint> }).club_media_lock_version();
        return true;
      } catch {
        return false;
      }
    })();
  }
  return clubMediaLockSupported;
}

/** Encrypts photo bytes to the club's shared photo identity. */
export function encryptClubMedia(ctx: FeatureBackendContext, clubId: string, bytes: Uint8Array): Promise<Uint8Array> {
  return encryptPiiValue(ctx, clubMediaPiiId(clubId), CLUB_MEDIA_FIELD, bytes);
}

/**
 * The caller's club photo key — one paid derivation per club per session,
 * concurrent callers share the in-flight request. Failures are not cached.
 */
export function fetchClubMediaVetKey(ctx: FeatureBackendContext, clubId: string): Promise<VetKey> {
  let pending = clubMediaKeyCache.get(clubId);
  if (!pending) {
    pending = (async () => {
      const { actor, canisterId } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
      const cid = canisterId.toText();
      const principal = ctx.identity.getPrincipal().toText();
      // Device-stored key (7 days) skips the slow, paid derivation.
      const stored = loadStoredClubKey(cid, principal, clubId);
      if (stored) {
        try {
          return VetKey.deserialize(stored);
        } catch {
          forgetStoredClubKey(cid, principal, clubId);
        }
      }
      const { key: verificationKey } = await getPiiVerificationKey(ctx);
      const transport = TransportSecretKey.random();
      const encrypted = await unwrapCandid(
        (actor as unknown as {
          get_club_media_vetkey: (c: string, t: Uint8Array) => Promise<{ Ok: Uint8Array | number[] } | { Err: string }>;
        }).get_club_media_vetkey(clubId, transport.publicKeyBytes()),
        "Fetch club photo key",
      );
      const key = EncryptedVetKey.deserialize(Uint8Array.from(encrypted)).decryptAndVerify(
        transport,
        verificationKey,
        piiIbeIdentity(clubMediaPiiId(clubId), CLUB_MEDIA_FIELD),
      );
      storeClubKey(cid, principal, clubId, key.serialize());
      return key;
    })();
    clubMediaKeyCache.set(clubId, pending);
    pending.catch(() => clubMediaKeyCache.delete(clubId));
  }
  return pending;
}

/**
 * Decrypts a club photo with the shared club key; returns null when the
 * bytes were not locked to the club (older per-photo lock) so the caller
 * can fall back to decryptPiiValue.
 */
export async function tryDecryptClubMedia(
  ctx: FeatureBackendContext,
  clubId: string,
  ciphertext: Uint8Array,
): Promise<Uint8Array | null> {
  if (!(await isClubMediaLockSupported(ctx))) return null;
  let key: VetKey;
  try {
    key = await fetchClubMediaVetKey(ctx, clubId);
  } catch {
    return null;
  }
  try {
    return IbeCiphertext.deserialize(ciphertext).decrypt(key);
  } catch {
    return null;
  }
}

async function getPiiVerificationKey(
  ctx: FeatureBackendContext,
): Promise<{ canisterId: string; key: DerivedPublicKey }> {
  const { actor, canisterId } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  const id = canisterId.toText();
  if (verificationKeyCache && verificationKeyCache.canisterId === id) {
    return verificationKeyCache;
  }
  const bytes = await actor.pii_vetkey_verification_key();
  const key = DerivedPublicKey.deserialize(Uint8Array.from(bytes));
  verificationKeyCache = { canisterId: id, key };
  return verificationKeyCache;
}

/**
 * Encrypts a PII value offline (IBE under the canister's derived public
 * key). No authorization is needed to encrypt — access control is enforced
 * at key-derivation time when someone tries to read.
 */
export async function encryptPiiValue(
  ctx: FeatureBackendContext,
  piiId: string,
  fieldId: string,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const { key } = await getPiiVerificationKey(ctx);
  const ciphertext = IbeCiphertext.encrypt(
    key,
    IbeIdentity.fromBytes(piiIbeIdentity(piiId, fieldId)),
    plaintext,
    IbeSeed.random(),
  );
  return ciphertext.serialize();
}

/**
 * Fetches (and caches) the caller's vetKeys for the given records through
 * the canister's gated relay. Records the caller cannot read come back
 * null canister-side and are simply absent from the returned map.
 */
export async function fetchPiiVetKeys(
  ctx: FeatureBackendContext,
  piiIds: string[],
  fieldId: string,
): Promise<Map<string, VetKey>> {
  const out = new Map<string, VetKey>();
  const missing = piiIds.filter((id) => !vetKeyCache.has(`${fieldId}${id}`));
  if (missing.length === 0) {
    for (const id of piiIds) out.set(id, vetKeyCache.get(`${fieldId}${id}`)!);
    return out;
  }

  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  const { key: verificationKey } = await getPiiVerificationKey(ctx);

  for (let start = 0; start < missing.length; start += VETKEY_BATCH_SIZE) {
    const chunk = missing.slice(start, start + VETKEY_BATCH_SIZE);
    // One fresh transport key per relay call; every derived key in the
    // batch is encrypted under it.
    const transport = TransportSecretKey.random();
    const keys = await unwrapCandid(
      actor.get_encrypted_pii_vetkeys_batch(chunk, fieldId, transport.publicKeyBytes()),
      "Fetch PII vetKeys",
    );
    for (let i = 0; i < chunk.length; i++) {
      const entry = keys[i];
      if (!entry || entry.length === 0) continue; // no access / not registered
      const vetKey = EncryptedVetKey.deserialize(Uint8Array.from(entry[0])).decryptAndVerify(
        transport,
        verificationKey,
        piiIbeIdentity(chunk[i], fieldId),
      );
      vetKeyCache.set(`${fieldId}${chunk[i]}`, vetKey);
    }
  }

  for (const id of piiIds) {
    const cached = vetKeyCache.get(`${fieldId}${id}`);
    if (cached) out.set(id, cached);
  }
  return out;
}

/** Decrypts one IBE ciphertext with the caller's vetKey for that record. */
export async function decryptPiiValue(
  ctx: FeatureBackendContext,
  piiId: string,
  fieldId: string,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const keys = await fetchPiiVetKeys(ctx, [piiId], fieldId);
  const vetKey = keys.get(piiId);
  if (!vetKey) throw new Error("No vetKey for PII record (no access or not registered)");
  return IbeCiphertext.deserialize(ciphertext).decrypt(vetKey);
}

/** Convenience: encrypt a UTF-8 string field. */
export async function encryptPiiText(
  ctx: FeatureBackendContext,
  piiId: string,
  fieldId: string,
  text: string,
): Promise<Uint8Array> {
  return encryptPiiValue(ctx, piiId, fieldId, textEncoder.encode(text));
}

/** Convenience: decrypt a UTF-8 string field. */
export async function decryptPiiText(
  ctx: FeatureBackendContext,
  piiId: string,
  fieldId: string,
  ciphertext: Uint8Array,
): Promise<string> {
  return textDecoder.decode(await decryptPiiValue(ctx, piiId, fieldId, ciphertext));
}
