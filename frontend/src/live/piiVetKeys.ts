import {
  DerivedPublicKey,
  EncryptedVetKey,
  IbeCiphertext,
  IbeIdentity,
  IbeSeed,
  TransportSecretKey,
  type VetKey,
} from "@icp-sdk/vetkeys";
import { connectLivePiiAccessControl } from "./domains";
import type { FeatureBackendContext } from "./featureRouter";
import { unwrapCandid } from "./features/candid";

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
