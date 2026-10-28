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
import type { PrivateProfileAudience } from './privateProfileAudience';
import { unwrapCandid } from "./features/candid";
import { clearDeviceCachedPhotos, forgetStoredClubKey, loadStoredClubKey, storeClubKey } from "./deviceMediaCache";

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
 * Ordinary record reads retain vetKeys on device for 30 days and in memory
 * for the session; fresh verification and other-person audience reads do not.
 * Own-name reads may explicitly opt in with retainOwnKey. Each derivation is a paid
 * vetkd_derive_key call on the canister. In-memory caches are cleared on
 * sign-out via clearPiiVetKeyCache; device key copies survive so the next
 * sign-in opens without re-deriving, and stay removable through the explicit
 * "remove saved copies" action (clearStoredDeviceKeys).
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
let clubNameKeyGeneration = 0;

/** Drops all in-session key material and cached photo bytes — call on
 * sign-out / identity switch. Device key copies keep their 30-day life so a
 * returning sign-in does not re-derive them; clearStoredDeviceKeys removes
 * those copies explicitly. */
export function clearPiiVetKeyCache(): void {
  clubNameKeyGeneration++;
  verificationKeyCache = null;
  vetKeyCache.clear();
  clubNameKeyCache.clear();
  clubMediaKeyCache.clear();
  sharedKeyCache.clear();
  clubMediaLockSupported.clear();
  void import("./mediaDecrypt").then(m => m.clearIcpPhotoResolutionCache());
  void clearDeviceCachedPhotos();
}

// ==================== Per-club photo key ====================

/** Field id of media blobs — must equal MEDIA_BLOB_PII_FIELD. */
const CLUB_MEDIA_FIELD = "blob";
const clubMediaKeyCache = new Map<string, Promise<VetKey>>();
const clubMediaLockSupported = new Map<string, Promise<boolean>>();

const clubNameKeyCache = new Map<string, Promise<VetKey>>();
export const CLUB_NAME_SCHEME_PREFIX = 'vetkey-club-names-v1:';
export function clubNamePiiId(club: string): string {
  if (!club || club.length > 64 || /[\u001f/]/.test(club)) throw new Error('Invalid club name scope.');
  return `clubnames:${club}`;
}

/** Separate from photo/email keys. Caller must freshly authorize ciphertext
 * before using this cache; possession is never an application access grant.
 * Retained keys cannot be withdrawn from a previously authorized device. */
export async function fetchClubNameVetKey(
  ctx: FeatureBackendContext, ids: string[], audience: PrivateProfileAudience, assertActive: () => void,
): Promise<VetKey> {
  if (audience.kind !== 'club' || !ids.length || ids.length > 25 || new Set(ids).size !== ids.length) throw new Error('Exact bounded club name audience required.');
  const piiId = clubNamePiiId(audience.resource);
  const identity = ctx.identity;
  const principal = identity.getPrincipal().toText();
  const target = JSON.stringify(ctx.target);
  const scope = { ...audience };
  const subjects = [...ids];
  const generation = clubNameKeyGeneration;
  const active = () => {
    assertActive();
    if (generation !== clubNameKeyGeneration || ctx.identity !== identity || identity.getPrincipal().toText() !== principal || JSON.stringify(ctx.target) !== target) throw new Error('Club name key context changed.');
  };
  active();
  const { actor, canisterId } = await connectLivePiiAccessControl(ctx.target, identity);
  active();
  const cid = canisterId.toText();
  const slot = `private-club-name:${ctx.target.host}:${piiId}`;
  const cacheId = `${target}|${principal}|${scope.authority.toText()}|${piiId}`;
  let pending = clubNameKeyCache.get(cacheId);
  if (!pending) {
    pending = (async () => {
      const stored = loadStoredClubKey(cid, principal, slot);
      if (stored) {
        try { return VetKey.deserialize(stored); } catch { forgetStoredClubKey(cid, principal, slot); }
      }
      const { key: verification } = await getPiiVerificationKey(ctx);
      active();
      const transport = TransportSecretKey.random();
      const bytes = await unwrapCandid((actor as unknown as {
        get_private_profile_club_name_vetkey: (ids: string[], scope: PrivateProfileAudience, transport: Uint8Array) => Promise<{ Ok: Uint8Array | number[] } | { Err: string }>;
      }).get_private_profile_club_name_vetkey(subjects, scope, transport.publicKeyBytes()), 'Unlock club names');
      active();
      const key = EncryptedVetKey.deserialize(Uint8Array.from(bytes)).decryptAndVerify(transport, verification, piiIbeIdentity(piiId, 'display_name'));
      active();
      storeClubKey(cid, principal, slot, key.serialize());
      return key;
    })();
    if (clubNameKeyCache.size >= 64) {
      const oldest = clubNameKeyCache.keys().next().value;
      if (oldest !== undefined) clubNameKeyCache.delete(oldest);
    }
    clubNameKeyCache.set(cacheId, pending);
    void pending.catch(() => { if (clubNameKeyCache.get(cacheId) === pending) clubNameKeyCache.delete(cacheId); });
  }
  const key = await pending;
  active();
  return key;
}

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
  const scope = `${ctx.target.host}|${ctx.target.canisterIds.pii_access_control ?? ""}`;
  let supported = clubMediaLockSupported.get(scope);
  if (!supported) {
    supported = (async () => {
      try {
        const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
        await (actor as unknown as { club_media_lock_version: () => Promise<bigint> }).club_media_lock_version();
        return true;
      } catch {
        return false;
      }
    })();
    clubMediaLockSupported.set(scope, supported);
  }
  return supported;
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
  const cacheKey = `${ctx.target.host}|${ctx.target.canisterIds.pii_access_control ?? ""}|${ctx.identity.getPrincipal().toText()}|${clubId}`;
  let pending = clubMediaKeyCache.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      const { actor, canisterId } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
      const cid = canisterId.toText();
      const principal = ctx.identity.getPrincipal().toText();
      // Device-stored key (30 days) skips the slow, paid derivation.
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
    clubMediaKeyCache.set(cacheKey, pending);
    pending.catch(() => clubMediaKeyCache.delete(cacheKey));
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
  // Check support and load the key together; on first open these were two
  // round trips in a row before any photo could show.
  const keyRequest = fetchClubMediaVetKey(ctx, clubId);
  keyRequest.catch(() => {});
  if (!(await isClubMediaLockSupported(ctx))) return null;
  let key: VetKey;
  try {
    key = await keyRequest;
  } catch {
    return null;
  }
  try {
    return IbeCiphertext.deserialize(ciphertext).decrypt(key);
  } catch {
    return null;
  }
}

/** Starts loading the club photo key early (device copy when saved, else one
 * shared derivation) so it overlaps listing and photo downloads. Never throws.
 * Call only for clubs that actually have locked photos to show. */
export function prewarmClubMediaKey(ctx: FeatureBackendContext, clubId: string): void {
  void isClubMediaLockSupported(ctx).then(ok => ok ? fetchClubMediaVetKey(ctx, clubId) : null).catch(() => {});
}

/** Unlocks a saved (still-encrypted) club photo with the key already saved on
 * this device. No network call, no paid derivation; null when no key is saved
 * (expired or the member was removed), so the caller re-reads with authorization. */
export function decryptClubMediaWithSavedKey(piiCanisterId: string, principal: string, clubId: string, ciphertext: Uint8Array): Uint8Array | null {
  const stored = loadStoredClubKey(piiCanisterId, principal, clubId);
  if (!stored) return null;
  try { return IbeCiphertext.deserialize(ciphertext).decrypt(VetKey.deserialize(stored)); } catch { return null; }
}

async function getPiiVerificationKey(
  ctx: FeatureBackendContext,
): Promise<{ canisterId: string; key: DerivedPublicKey }> {
  const { actor, canisterId } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  const id = canisterId.toText();
  if (verificationKeyCache && verificationKeyCache.canisterId === id) {
    return verificationKeyCache;
  }
  // The verification key is PUBLIC (it only verifies derived keys) and fixed
  // per canister, but fetching it is a slow update call plus a management
  // canister round trip. Keep a device copy so sign-in never waits on it twice.
  const storageKey = `${VERIFICATION_KEY_STORAGE_PREFIX}${ctx.target.host}|${id}`;
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const key = DerivedPublicKey.deserialize(Uint8Array.from(atob(stored), (c) => c.charCodeAt(0)));
      verificationKeyCache = { canisterId: id, key };
      return verificationKeyCache;
    }
  } catch { /* fall through to a network read */ }
  const inFlight = verificationKeyInFlight.get(storageKey);
  if (inFlight) return inFlight;
  const request = (async () => {
    const bytes = Uint8Array.from(await actor.pii_vetkey_verification_key());
    const key = DerivedPublicKey.deserialize(bytes);
    verificationKeyCache = { canisterId: id, key };
    try { localStorage.setItem(storageKey, btoa(String.fromCharCode(...bytes))); } catch { /* best effort */ }
    return verificationKeyCache;
  })().finally(() => verificationKeyInFlight.delete(storageKey));
  verificationKeyInFlight.set(storageKey, request);
  return request;
}

const VERIFICATION_KEY_STORAGE_PREFIX = "ignite_pii_verification_key:";
const verificationKeyInFlight = new Map<string, Promise<{ canisterId: string; key: DerivedPublicKey }>>();

/** Starts loading the public verification key early so a first unlock can
 * overlap it with the ciphertext read. Never throws. */
export function prewarmPiiVerificationKey(ctx: FeatureBackendContext): void {
  void getPiiVerificationKey(ctx).catch(() => {});
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
  options: { fresh?: boolean; assertActive?: () => void; audience?: PrivateProfileAudience; retainOwnKey?: boolean } = {},
): Promise<Map<string, VetKey>> {
  const active = options.assertActive ?? (() => {});
  if (options.audience) {
    if (fieldId !== 'display_name') throw new Error('Private-name audiences cannot unlock another field.');
    options = { ...options, fresh: true, audience: { ...options.audience } };
  }
  // Record keys (children, guests, Player of the Match, own name) are kept on
  // device for 30 days so reopening the app skips the paid derivation; the
  // ciphertext itself is still re-read through an authorized read every time.
  // Audience-scoped reads of another person's name never reuse or store a copy.
  const retain = !options.audience && (options.retainOwnKey === true || !options.fresh);
  active();
  const out = new Map<string, VetKey>();
  const { actor, canisterId } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  active();
  const cid = canisterId.toText();
  const principal = ctx.identity.getPrincipal().toText();
  // Device-stored keys (30 days, kept through sign-out) skip the paid
  // derivation — previously every app open re-derived every visible name.
  const memoryKey = (id: string) => `${ctx.target.host}|${cid}|${principal}|${fieldId}\u001f${id}`;
  const storeKey = (id: string) => `pii:${fieldId}:${id}`;
  // Private profile reads re-read their ciphertext every time; a retained key
  // copy only skips the derivation step, never the authorized read.
  for (const id of piiIds) {
    if (options.fresh && !retain) continue;
    const memKey = memoryKey(id);
    if (vetKeyCache.has(memKey)) continue;
    const stored = loadStoredClubKey(cid, principal, storeKey(id));
    if (!stored) continue;
    try {
      vetKeyCache.set(memKey, VetKey.deserialize(stored));
    } catch {
      forgetStoredClubKey(cid, principal, storeKey(id));
    }
  }
  const missing = [...new Set(piiIds)].filter((id) => (options.fresh && !retain) || !vetKeyCache.has(memoryKey(id)));
  if (missing.length === 0) {
    for (const id of piiIds) { const key = vetKeyCache.get(memoryKey(id)); if (key) out.set(id, key); }
    return out;
  }

  const { key: verificationKey } = await getPiiVerificationKey(ctx);
  active();

  for (let start = 0; start < missing.length; start += VETKEY_BATCH_SIZE) {
    active();
    const chunk = missing.slice(start, start + VETKEY_BATCH_SIZE);
    // One fresh transport key per relay call; every derived key in the
    // batch is encrypted under it.
    const transport = TransportSecretKey.random();
    const keys = await unwrapCandid(
      options.audience
        ? actor.get_private_profile_name_vetkeys_batch(chunk, options.audience, transport.publicKeyBytes())
        : actor.get_encrypted_pii_vetkeys_batch(chunk, fieldId, transport.publicKeyBytes()),
      "Fetch PII vetKeys",
    );
    active();
    if (keys.length !== chunk.length) throw new Error("Invalid PII key response length.");
    for (let i = 0; i < chunk.length; i++) {
      const entry = keys[i];
      if (!entry || entry.length === 0) continue; // no access / not registered
      const vetKey = EncryptedVetKey.deserialize(Uint8Array.from(entry[0])).decryptAndVerify(
        transport,
        verificationKey,
        piiIbeIdentity(chunk[i], fieldId),
      );
      if (options.fresh && !retain) out.set(chunk[i], vetKey);
      else {
        vetKeyCache.set(memoryKey(chunk[i]), vetKey);
        if (retain) storeClubKey(cid, principal, storeKey(chunk[i]), vetKey.serialize());
      }
    }
  }

  active();
  if (options.fresh && !retain) return out;
  for (const id of piiIds) {
    const cached = vetKeyCache.get(memoryKey(id));
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

// ==================== Shared audience keys ====================
// Children's names (club), guest/fill-in/POTM names (team) and
// role-restricted Vault files (role audience) share one key per audience
// instead of one paid key per record. Ciphertext carries a marker naming its
// audience; the canister re-checks membership before and after derivation.

export type SharedAudienceKind = 'clubchildren' | 'teamnames' | 'vaultrole';
export type SharedAudience = { kind: SharedAudienceKind; scope: string; club: string };

const SHARED_MAGIC = textEncoder.encode('IGSK1\n');
const SHARED_FIELD = 'shared';
const sharedKeyCache = new Map<string, Promise<VetKey>>();

/** Canonical Vault role audience: "<club>|<team or empty>|<sorted roles>". */
export function vaultRoleScope(club: string, team: string | null | undefined, roles: readonly string[]): string {
  const clean = [...new Set(roles.map(r => r.trim()).filter(Boolean))].sort();
  return `${club}|${team ?? ''}|${clean.join(',')}`;
}

function validAudience(a: SharedAudience): boolean {
  return ['clubchildren', 'teamnames', 'vaultrole'].includes(a.kind) && !!a.scope && a.scope.length <= 512
    && !!a.club && a.club.length <= 64 && !/[\u001f:\n]/.test(a.club) && !/\n/.test(a.scope);
}

export function sharedAudiencePiiId(a: SharedAudience): string {
  return `${a.kind}:${a.scope}`;
}

/** Wraps ciphertext with its audience marker. */
export function wrapSharedCiphertext(a: SharedAudience, ciphertext: Uint8Array): Uint8Array {
  const head = textEncoder.encode(JSON.stringify({ k: a.kind, s: a.scope, c: a.club }) + '\n');
  const out = new Uint8Array(SHARED_MAGIC.length + head.length + ciphertext.length);
  out.set(SHARED_MAGIC, 0); out.set(head, SHARED_MAGIC.length); out.set(ciphertext, SHARED_MAGIC.length + head.length);
  return out;
}

/** Audience + inner ciphertext, or null for per-record ciphertext. */
export function parseSharedCiphertext(bytes: Uint8Array): { audience: SharedAudience; ciphertext: Uint8Array } | null {
  if (bytes.length < SHARED_MAGIC.length + 3) return null;
  for (let i = 0; i < SHARED_MAGIC.length; i++) if (bytes[i] !== SHARED_MAGIC[i]) return null;
  const end = bytes.indexOf(10, SHARED_MAGIC.length);
  if (end < 0 || end - SHARED_MAGIC.length > 700) return null;
  try {
    const j = JSON.parse(textDecoder.decode(bytes.subarray(SHARED_MAGIC.length, end))) as { k: SharedAudienceKind; s: string; c: string };
    const audience: SharedAudience = { kind: j.k, scope: j.s, club: j.c };
    if (!validAudience(audience)) return null;
    return { audience, ciphertext: bytes.subarray(end + 1) };
  } catch { return null; }
}

/** Device slot; begins with the club id so pruneStoredClubKeys drops it on leaving. */
export function sharedKeySlot(a: SharedAudience): string {
  return `shared:${a.club}:${a.kind}:${a.scope}`;
}

export async function encryptSharedValue(ctx: FeatureBackendContext, a: SharedAudience, plaintext: Uint8Array): Promise<Uint8Array> {
  if (!validAudience(a)) throw new Error('Invalid shared audience.');
  const { key } = await getPiiVerificationKey(ctx);
  const ct = IbeCiphertext.encrypt(key, IbeIdentity.fromBytes(piiIbeIdentity(sharedAudiencePiiId(a), SHARED_FIELD)), plaintext, IbeSeed.random());
  return wrapSharedCiphertext(a, ct.serialize());
}

/** One paid derivation per audience per 30 days on this device. */
export function fetchSharedAudienceVetKey(ctx: FeatureBackendContext, a: SharedAudience): Promise<VetKey> {
  if (!validAudience(a)) return Promise.reject(new Error('Invalid shared audience.'));
  const principal = ctx.identity.getPrincipal().toText();
  const cacheKey = `${ctx.target.host}|${ctx.target.canisterIds.pii_access_control ?? ''}|${principal}|${sharedKeySlot(a)}`;
  let pending = sharedKeyCache.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      const { actor, canisterId } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
      const cid = canisterId.toText();
      const slot = sharedKeySlot(a);
      const stored = loadStoredClubKey(cid, principal, slot);
      if (stored) {
        try { return VetKey.deserialize(stored); } catch { forgetStoredClubKey(cid, principal, slot); }
      }
      const { key: verification } = await getPiiVerificationKey(ctx);
      const transport = TransportSecretKey.random();
      const bytes = await unwrapCandid((actor as unknown as {
        get_shared_audience_vetkey: (k: string, s: string, t: Uint8Array) => Promise<{ Ok: Uint8Array | number[] } | { Err: string }>;
      }).get_shared_audience_vetkey(a.kind, a.scope, transport.publicKeyBytes()), 'Unlock shared details');
      const key = EncryptedVetKey.deserialize(Uint8Array.from(bytes)).decryptAndVerify(transport, verification, piiIbeIdentity(sharedAudiencePiiId(a), SHARED_FIELD));
      storeClubKey(cid, principal, slot, key.serialize());
      return key;
    })();
    if (sharedKeyCache.size >= 128) {
      const oldest = sharedKeyCache.keys().next().value;
      if (oldest !== undefined) sharedKeyCache.delete(oldest);
    }
    sharedKeyCache.set(cacheKey, pending);
    pending.catch(() => sharedKeyCache.delete(cacheKey));
  }
  return pending;
}

/** Decrypts marker-wrapped ciphertext; null when not shared or not permitted. */
export async function tryDecryptShared(ctx: FeatureBackendContext, bytes: Uint8Array): Promise<Uint8Array | null> {
  const parsed = parseSharedCiphertext(bytes);
  if (!parsed) return null;
  try {
    const key = await fetchSharedAudienceVetKey(ctx, parsed.audience);
    return IbeCiphertext.deserialize(parsed.ciphertext).decrypt(key);
  } catch { return null; }
}
