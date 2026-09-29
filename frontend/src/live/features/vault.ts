import type { Principal } from "@icp-sdk/core/principal";
import { connectLivePiiAccessControl, connectLiveVaultDomain } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import { candidOpt, toNat64, unwrapCandid } from "./candid";

/**
 * Vault feature -> vault_domain canister (folder/file metadata) plus
 * pii_access_control (encrypted records).
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

/**
 * Folder/file metadata surface on vault_domain.
 *
 * NOTE: untested against a live canister until deployment. The canister
 * scopes folders/files to club + optional team; mini-league scoping is a
 * Supabase-only concept with no canister shape yet.
 */
export async function listLiveVaultFolders(
  ctx: FeatureBackendContext,
  clubId: string,
  teamId: string | null,
) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_folders(clubId, teamId ? [teamId] : []),
    "List vault folders",
  );
}

export async function listLiveVaultFiles(ctx: FeatureBackendContext, folderId: string) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_files(folderId), "List vault files");
}

export async function listLiveVaultClubFiles(
  ctx: FeatureBackendContext,
  clubId: string,
  teamId: string | null,
) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_club_files(clubId, teamId ? [teamId] : []),
    "List vault club files",
  );
}

export async function listLiveVaultTrash(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_trashed_files(clubId), "List vault trash");
}

/**
 * Vault write surface (folders + files) on vault_domain.
 *
 * NOTE: untested against a live canister until deployment — the parameter
 * order below is inferred from vault_domain.did (positional record fields);
 * verify against a live canister after deploy.
 */

export interface LiveVaultBlobRef {
  canister: string;
  content_hash: string;
  path: string;
}

export async function createLiveVaultFolder(
  ctx: FeatureBackendContext,
  id: string,
  clubId: string,
  teamId: string | null,
  parentId: string | null,
  name: string,
  restrictedRoles: string[],
) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_folder(
      id,
      clubId,
      candidOpt(teamId),
      candidOpt(parentId),
      name,
      restrictedRoles,
    ),
    "Create vault folder",
  );
}

export async function updateLiveVaultFolder(
  ctx: FeatureBackendContext,
  folderId: string,
  name: string,
  restrictedRoles: string[],
) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.update_folder(folderId, name, restrictedRoles),
    "Update vault folder",
  );
}

export async function deleteLiveVaultFolder(ctx: FeatureBackendContext, folderId: string) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_folder(folderId), "Delete vault folder");
}

export async function registerLiveVaultFile(
  ctx: FeatureBackendContext,
  id: string,
  folderId: string,
  clubId: string,
  teamId: string | null,
  name: string,
  fileUrl: string,
  size: number,
  mime: string,
  isExternalLink: boolean,
  blobRef: LiveVaultBlobRef | null,
) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.register_file(
      id,
      folderId,
      clubId,
      candidOpt(teamId),
      name,
      fileUrl,
      toNat64(size),
      mime,
      isExternalLink,
      candidOpt(blobRef),
    ),
    "Register vault file",
  );
}

export async function trashLiveVaultFile(ctx: FeatureBackendContext, fileId: string) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.trash_file(fileId), "Trash vault file");
}

export async function restoreLiveVaultFile(ctx: FeatureBackendContext, fileId: string) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.restore_file(fileId), "Restore vault file");
}
