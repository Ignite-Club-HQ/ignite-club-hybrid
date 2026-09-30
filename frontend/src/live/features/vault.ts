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

/**
 * Batch read of decrypted PII fields (e.g. child display names). The canister
 * omits records the caller cannot read and audits every attempt, so callers
 * should treat a missing entry as "no access / not registered" and fall back.
 */
export async function getLiveDecryptedPiiBatch(
  ctx: FeatureBackendContext,
  piiIds: string[],
  fieldId: string,
  operation: string,
  purpose: string,
) {
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.get_decrypted_pii_batch(piiIds, fieldId, operation, purpose),
    "Get decrypted PII batch",
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
 * Records a verified guardian/child relationship on pii_access_control.
 * `grant_pii_read` for a child's PII records only succeeds once the canister
 * can see a matching guardian relationship here — callers must add the
 * relationship before (or alongside) granting read access, never trust a
 * browser-supplied grant without this canister-side link.
 */
export async function addLiveGuardianRelationship(
  ctx: FeatureBackendContext,
  guardian: Principal,
  childId: string,
) {
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  return unwrapCandid(actor.add_guardian_relationship(guardian, childId), "Add guardian relationship");
}

export async function removeLiveGuardianRelationship(
  ctx: FeatureBackendContext,
  guardian: Principal,
  childId: string,
) {
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  return unwrapCandid(actor.remove_guardian_relationship(guardian, childId), "Remove guardian relationship");
}

/** The caller's own guardian-linked children (their principal as the guardian). */
export async function listMyLiveGuardianChildren(ctx: FeatureBackendContext) {
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  return actor.my_guardian_children();
}

/**
 * Grants a reader principal access to one PII field. The canister enforces
 * the actual authorization (domain owner, or — for guardians — a verified
 * relationship added via `add_guardian_relationship`); this call only
 * requests the grant, it never substitutes for that check.
 */
export async function grantLivePiiRead(
  ctx: FeatureBackendContext,
  piiId: string,
  fieldId: string,
  reader: Principal,
) {
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  return unwrapCandid(actor.grant_pii_read(piiId, fieldId, reader), "Grant PII read");
}

export async function revokeLivePiiRead(
  ctx: FeatureBackendContext,
  piiId: string,
  fieldId: string,
  reader: Principal,
) {
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  return unwrapCandid(actor.revoke_pii_read(piiId, fieldId, reader), "Revoke PII read");
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
  miniLeagueId: string | null = null,
) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_folders(clubId, teamId ? [teamId] : [], miniLeagueId ? [miniLeagueId] : []),
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
  miniLeagueId: string | null = null,
) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_club_files(clubId, teamId ? [teamId] : [], miniLeagueId ? [miniLeagueId] : []),
    "List vault club files",
  );
}

/**
 * Folder-joined variants of the list reads above. The canister denormalizes
 * `folder_name`/`folder_path` onto each file so the UI can show folder
 * context without a client-side folder-id join (VaultFileWithFolder).
 */
export async function listLiveVaultFilesWithFolder(
  ctx: FeatureBackendContext,
  folderId: string,
) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_files_with_folder(folderId),
    "List vault files with folder",
  );
}

export async function listLiveVaultClubFilesWithFolder(
  ctx: FeatureBackendContext,
  clubId: string,
  teamId: string | null,
  miniLeagueId: string | null = null,
) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_club_files_with_folder(
      clubId,
      teamId ? [teamId] : [],
      miniLeagueId ? [miniLeagueId] : [],
    ),
    "List vault club files with folder",
  );
}

export async function listLiveVaultTrashWithFolder(
  ctx: FeatureBackendContext,
  clubId: string,
) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_trashed_files_with_folder(clubId),
    "List vault trash with folder",
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
  miniLeagueId: string | null = null,
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
      candidOpt(miniLeagueId),
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
  miniLeagueId: string | null = null,
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
      candidOpt(miniLeagueId),
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

export async function renameLiveVaultFile(
  ctx: FeatureBackendContext,
  fileId: string,
  name: string,
) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.rename_file(fileId, name), "Rename vault file");
}

/**
 * Moves a file into another folder of the same club (canister adopts the
 * folder's team scope). Pass "" to move to the vault root — the canister has
 * no null folder id, so root is the empty string; team scope then stays as
 * it was. Provisional until the vault scope model is verified post-deploy.
 */
export async function moveLiveVaultFile(
  ctx: FeatureBackendContext,
  fileId: string,
  folderId: string,
) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.move_file(fileId, folderId), "Move vault file");
}

/**
 * Hard delete of the metadata row. File bytes live outside the canister
 * (Supabase storage today, the blob store later), so byte cleanup stays
 * with the storage layer.
 */
export async function permanentlyDeleteLiveVaultFile(ctx: FeatureBackendContext, fileId: string) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_file_permanent(fileId), "Permanently delete vault file");
}
