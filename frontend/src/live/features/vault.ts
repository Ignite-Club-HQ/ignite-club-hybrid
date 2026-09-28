import type { Principal } from "@icp-sdk/core/principal";
import { connectLivePiiAccessControl } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import { unwrapCandid } from "./candid";

/**
 * Vault feature -> pii_access_control canister.
 *
 * Canister-side counterpart of the Supabase vault repositories in
 * `features/vault/`: encrypted PII records with per-field access control and
 * key rotation. Plaintext only ever crosses to the canister as bytes; the
 * canister encrypts at rest under the current master key.
 *
 * NOTE: untested against a live canister until deployment — verify the
 * field_id/domain_owner conventions during the post-deploy sign-in test.
 */

export async function registerLivePii(
  ctx: FeatureBackendContext,
  piiId: string,
  fieldId: string,
  plaintext: Uint8Array,
  domainOwner: Principal,
) {
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.register_pii(piiId, fieldId, plaintext, domainOwner),
    "Register PII",
  );
}

export async function getLiveEncryptedPii(
  ctx: FeatureBackendContext,
  piiId: string,
  fieldId: string,
) {
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_encrypted_pii(piiId, fieldId), "Get encrypted PII");
}

export async function getLiveDecryptedPii(
  ctx: FeatureBackendContext,
  piiId: string,
  fieldId: string,
  operation: string,
  purpose: string,
) {
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.get_decrypted_pii(piiId, fieldId, operation, purpose),
    "Get decrypted PII",
  );
}

export async function deleteLivePii(
  ctx: FeatureBackendContext,
  piiId: string,
  fieldId: string,
) {
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_pii(piiId, fieldId), "Delete PII");
}

export async function deriveLiveMediaKey(
  ctx: FeatureBackendContext,
  childId: string,
  authorizer: Principal,
  purpose: string,
  expirySeconds: number,
) {
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.derive_media_key(childId, authorizer, purpose, BigInt(expirySeconds)),
    "Derive media key",
  );
}

export async function getLiveKeyMetadata(ctx: FeatureBackendContext) {
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  return actor.get_key_metadata();
}
