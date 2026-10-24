import type { Principal } from "@icp-sdk/core/principal";
import { IbeCiphertext } from "@icp-sdk/vetkeys";
import { connectLivePiiAccessControl, connectLiveVaultDomain } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import { encryptPiiValue, fetchPiiVetKeys } from "../piiVetKeys";
import { candidOpt, toNat64, unwrapCandid } from "./candid";

/**
 * Vault feature -> vault_domain canister (folder/file metadata) plus
 * pii_access_control (encrypted records).
 *
 * Canister-side counterpart of the Supabase vault repositories in
 * `features/vault/`: encrypted PII records with per-field access control.
 * Encryption is client-side IBE (vetKeys) — `register_pii` receives
 * ciphertext the browser produced offline, and reads fetch ciphertext plus
 * the caller's authorization-gated vetKey and decrypt locally. The
 * canister never sees plaintext or keys.
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
  const ciphertext = await encryptPiiValue(ctx, piiId, fieldId, plaintext);
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.register_pii(piiId, fieldId, ciphertext, domainOwner),
    "Register PII",
  );
}

export async function getLiveEncryptedPii(
  ctx: FeatureBackendContext,
  piiId: string,
  fieldId: string,
  operation = "read_pii",
  purpose = "Read PII field",
) {
  const rows = await getLiveEncryptedPiiBatch(ctx, [piiId], fieldId, operation, purpose);
  return rows.find((row) => row.pii_id === piiId) ?? null;
}

/**
 * Batch read of PII ciphertext (e.g. child display names). The canister
 * omits records the caller cannot read and audits every attempt, so callers
 * should treat a missing entry as "no access / not registered" and fall
 * back. Decrypt locally via `fetchPiiVetKeys` + `decryptPiiValue`, or use
 * `resolveLivePiiTextBatch` for text fields.
 */
export async function getLiveEncryptedPiiBatch(
  ctx: FeatureBackendContext,
  piiIds: string[],
  fieldId: string,
  operation: string,
  purpose: string,
) {
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.get_encrypted_pii_batch(piiIds, fieldId, operation, purpose),
    "Get encrypted PII batch",
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
 * Grants every member of a club read access to one PII field (verified
 * live canister-side via club_domain's has_club_staff_role). Lets club
 * staff render names — e.g. a coach viewing an event roster — without a
 * per-principal grant. Caller must own the record (or be governor).
 */
export async function grantLivePiiReadClub(
  ctx: FeatureBackendContext,
  piiId: string,
  fieldId: string,
  clubId: string,
) {
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  return unwrapCandid(actor.grant_pii_read_club(piiId, fieldId, clubId), "Grant PII read to club");
}

export async function revokeLivePiiReadClub(
  ctx: FeatureBackendContext,
  piiId: string,
  fieldId: string,
  clubId: string,
) {
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  return unwrapCandid(actor.revoke_pii_read_club(piiId, fieldId, clubId), "Revoke PII read from club");
}

export async function grantLivePiiReadCompetition(
  ctx: FeatureBackendContext,
  piiId: string,
  fieldId: string,
  competitionId: string,
) {
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.grant_pii_read_competition(piiId, fieldId, competitionId),
    "Grant PII read to competition",
  );
}

export async function revokeLivePiiReadCompetition(
  ctx: FeatureBackendContext,
  piiId: string,
  fieldId: string,
  competitionId: string,
) {
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.revoke_pii_read_competition(piiId, fieldId, competitionId),
    "Revoke PII read from competition",
  );
}

/**
 * Best-effort club-scoped read grant for one PII field. Logged, never
 * thrown — the grant can be retried later by the record owner.
 */
export async function grantLiveClubPiiRead(
  ctx: FeatureBackendContext,
  piiId: string,
  fieldId: string,
  clubId: string,
): Promise<void> {
  try {
    await grantLivePiiReadClub(ctx, piiId, fieldId, clubId);
  } catch (error) {
    console.error("[vault] club PII read grant failed", {
      piiId,
      fieldId,
      clubId,
      message: (error as Error)?.message,
    });
  }
}

/** Best-effort club-scoped read grant for a child's `name` field. */
export async function grantLiveClubChildNameRead(
  ctx: FeatureBackendContext,
  childId: string,
  clubId: string,
): Promise<void> {
  await grantLiveClubPiiRead(ctx, childId, "name", clubId);
}

/**
 * Best-effort batch decrypt returning a pii_id -> plaintext map. Missing
 * entries mean "no access / not registered" — callers fall back to a
 * neutral label, never an error state. Logged, never thrown.
 */
export async function resolveLivePiiTextBatch(
  ctx: FeatureBackendContext,
  piiIds: string[],
  fieldId: string,
  operation: string,
  purpose: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (piiIds.length === 0) return out;
  try {
    const rows = await getLiveEncryptedPiiBatch(ctx, piiIds, fieldId, operation, purpose);
    if (rows.length === 0) return out;
    const readableIds = rows.map((row) => row.pii_id);
    const vetKeys = await fetchPiiVetKeys(ctx, readableIds, fieldId);
    const decoder = new TextDecoder();
    for (const row of rows) {
      const vetKey = vetKeys.get(row.pii_id);
      if (!vetKey) continue; // ciphertext readable but no key grant — treat as no access
      try {
        const plaintext = IbeCiphertext.deserialize(
          Uint8Array.from(row.ciphertext),
        ).decrypt(vetKey);
        out.set(row.pii_id, decoder.decode(plaintext));
      } catch {
        // Corrupt ciphertext or wrong identity — skip, fall back to the neutral label.
      }
    }
  } catch (error) {
    console.error("[vault] PII batch decrypt failed", {
      fieldId,
      count: piiIds.length,
      message: (error as Error)?.message,
    });
  }
  return out;
}

/**
 * Field-id conventions for non-vault PII records (kept in sync with the
 * reads in homeFeed.ts / inboxPreviewSources.ts):
 * - child name      -> pii_id = child id,        field_id = "name"
 * - invite email    -> pii_id = invite id,       field_id = "email"
 * - user display name -> pii_id = principal text, field_id = "display_name"
 * - own contact email -> pii_id = principal text, field_id = "contact_email"
 *   (optional, member-owned; powers member self-registered competition
 *   welcome emails — see memberWelcomeEmail.ts)
 *
 * Ownership: the caller who creates the record is its domain owner (the club
 * admin acts as data controller for children they create; a user owns their
 * own profile record). Owners grant guardians read access via
 * `grant_pii_read`; guardians additionally self-register the verified
 * relationship when they accept an invite (acceptParentInvite.ts).
 */

const textEncoder = new TextEncoder();

/**
 * Registers a child's name on pii_access_control and grants the parent read
 * access. Best effort: the child record itself already exists on club_domain,
 * so a PII failure is logged, never thrown — the grant can be retried later.
 * The caller becomes the record's domain owner.
 */
export async function registerLiveChildNamePii(
  ctx: FeatureBackendContext,
  childId: string,
  childName: string,
  parent: Principal,
): Promise<void> {
  const owner = ctx.identity.getPrincipal();
  try {
    await registerLivePii(ctx, childId, "name", textEncoder.encode(childName), owner);
    await grantLivePiiRead(ctx, childId, "name", parent);
  } catch (error) {
    console.error("[vault] child name PII registration failed", {
      childId,
      message: (error as Error)?.message,
    });
  }
}

/**
 * Best-effort read grant of a child's `name` field to a newly linked
 * guardian. Succeeds when the caller owns the record or is a verified
 * guardian; otherwise the canister rejects it and the grant can be seeded
 * later by the owner. Never throws.
 */
export async function grantLiveGuardianChildNameRead(
  ctx: FeatureBackendContext,
  childId: string,
  guardian: Principal,
): Promise<void> {
  try {
    await grantLivePiiRead(ctx, childId, "name", guardian);
  } catch (error) {
    console.error("[vault] guardian name-read grant failed", {
      childId,
      message: (error as Error)?.message,
    });
  }
}

/**
 * Registers a caller-owned free-text PII field (invite email, own display
 * name). Best effort — logged, never thrown.
 */
export async function registerLivePiiText(
  ctx: FeatureBackendContext,
  piiId: string,
  fieldId: string,
  text: string,
): Promise<void> {
  try {
    await registerLivePii(
      ctx,
      piiId,
      fieldId,
      textEncoder.encode(text),
      ctx.identity.getPrincipal(),
    );
  } catch (error) {
    console.error("[vault] PII registration failed", {
      piiId,
      fieldId,
      message: (error as Error)?.message,
    });
  }
}

/**
 * Folder/file metadata surface on vault_domain.
 *
 * NOTE: untested against a live canister until deployment. The canister
 * scopes folders/files to club + optional team; mini-league scoping is a
 * Supabase-only concept with no canister shape yet.
 */
async function readVaultPages(ctx: FeatureBackendContext, clubId: string, teamId: string | null, leagueId: string | null, competitionId: string | null, folderId: string | null, trash: boolean) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  const items: import("../../lab/bindings/vault_domain/declarations/vault_domain.did.js").VaultFileWithFolder[] = [];
  let offset = 0n;
  let revision: [] | [bigint] = [];
  for (;;) {
    let page;
    try {
      page = await unwrapCandid(actor.read_vault_file_page(clubId, candidOpt(teamId), candidOpt(leagueId), candidOpt(competitionId), candidOpt(folderId), trash, offset, revision), "Read Vault page");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Older deployed modules retain their existing authorized read paths.
      // Never fall back on permission, timeout or partial-page failures.
      if (offset !== 0n || !/has no (?:query |update |)method|method not found|IC0536|is not a function/i.test(message)) throw error;
      if (competitionId) return unwrapCandid(actor.list_competition_files_with_folder(folderId ?? "", competitionId), "Read legacy competition Vault");
      if (trash) return unwrapCandid(actor.list_trashed_files_with_folder(clubId), "Read legacy Vault trash");
      if (folderId) return unwrapCandid(actor.list_files_with_folder(folderId), "Read legacy Vault folder");
      return unwrapCandid(actor.list_club_files_with_folder(clubId, candidOpt(teamId), candidOpt(leagueId)), "Read legacy Vault files");
    }
    items.push(...page.items);
    revision = [page.revision];
    const next = page.next[0];
    if (next === undefined) return items;
    if (next <= offset) throw new Error("Invalid Vault continuation");
    offset = next;
  }
}

export async function listLiveVaultFolders(
  ctx: FeatureBackendContext,
  clubId: string,
  teamId: string | null,
  miniLeagueId: string | null = null,
  competitionId: string | null = null,
) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  if (competitionId) {
    return unwrapCandid(actor.list_competition_folders(competitionId), "List competition vault folders");
  }
  return unwrapCandid(
    actor.list_folders(clubId, teamId ? [teamId] : [], miniLeagueId ? [miniLeagueId] : []),
    "List vault folders",
  );
}

export async function listLiveVaultFiles(ctx: FeatureBackendContext, folderId: string) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return (await listLiveVaultFilesWithFolder(ctx, folderId)).map(entry => entry.file);
}

/** Single file read; null when the file is missing or the caller cannot view its folder. */
export async function getLiveVaultFile(ctx: FeatureBackendContext, fileId: string) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  const row = await unwrapCandid(actor.get_file(fileId), "Get vault file");
  return row.length ? row[0] : null;
}

/** Single folder read; null when the folder is missing or the caller cannot view it. */
export async function getLiveVaultFolder(ctx: FeatureBackendContext, folderId: string, competitionId: string | null = null) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  const row = competitionId
    ? await unwrapCandid(actor.get_competition_folder(folderId), "Get competition vault folder")
    : await unwrapCandid(actor.get_folder(folderId), "Get vault folder");
  if (row[0]) return row[0];
  if (competitionId) return null;
  const competitionRow = await unwrapCandid(actor.get_competition_folder(folderId), "Get competition vault folder");
  return competitionRow[0] ?? null;
}

export async function listLiveVaultClubFiles(
  ctx: FeatureBackendContext,
  clubId: string,
  teamId: string | null,
  miniLeagueId: string | null = null,
) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return (await readVaultPages(ctx, clubId, teamId, miniLeagueId, null, null, false)).map(entry => entry.file);
}

/**
 * Folder-joined variants of the list reads above. The canister denormalizes
 * `folder_name`/`folder_path` onto each file so the UI can show folder
 * context without a client-side folder-id join (VaultFileWithFolder).
 */
export async function listLiveVaultFilesWithFolder(
  ctx: FeatureBackendContext,
  folderId: string,
  competitionId: string | null = null,
) {
  const folder = await getLiveVaultFolder(ctx, folderId, competitionId);
  if (!folder) throw new Error("Vault folder not found or access denied");
  return readVaultPages(ctx, folder.club, folder.team[0] ?? null, folder.mini_league_id[0] ?? null, folder.competition_id[0] ?? null, folderId, false);
}

export async function listLiveVaultClubFilesWithFolder(
  ctx: FeatureBackendContext,
  clubId: string,
  teamId: string | null,
  miniLeagueId: string | null = null,
  competitionId: string | null = null,
) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return readVaultPages(ctx, clubId, teamId, miniLeagueId, competitionId, null, false);
}

export async function listLiveVaultTrashWithFolder(
  ctx: FeatureBackendContext,
  clubId: string,
) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return readVaultPages(ctx, clubId, null, null, null, null, true);
}

export async function listLiveVaultTrash(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return (await readVaultPages(ctx, clubId, null, null, null, null, true)).map(entry => entry.file);
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
  competitionId: string | null = null,
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
      candidOpt(competitionId),
      0,
      [],
      [],
    ),
    "Create vault folder",
  );
}

export async function updateLiveVaultFolder(
  ctx: FeatureBackendContext,
  folderId: string,
  name: string,
  restrictedRoles?: string[],
) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  // update_folder overwrites sort_order/description/color wholesale, so
  // fetch the current row first and preserve the fields this wrapper
  // doesn't expose (rename/role changes must not clobber ordering).
  const existing = await getLiveVaultFolder(ctx, folderId);
  if (!existing) throw new Error("Update vault folder failed: folder not found");
  return unwrapCandid(
    actor.update_folder(
      folderId,
      name,
      restrictedRoles ?? existing.restricted_roles,
      existing.sort_order,
      existing.description,
      existing.color,
    ),
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
  competitionId: string | null = null,
) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.register_file(
      id,
      folderId,
      clubId,
      candidOpt(teamId),
      // Canister limits: name 160, mime 128 chars, both non-empty.
      (name.trim() || "Untitled").slice(0, 160),
      fileUrl,
      toNat64(size),
      (mime || "application/octet-stream").slice(0, 128),
      isExternalLink,
      candidOpt(blobRef),
      candidOpt(miniLeagueId),
      candidOpt(competitionId),
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
  targetTeamId?: string | null,
) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  if (!folderId && targetTeamId !== undefined) return unwrapCandid(actor.move_file_to_root(fileId, candidOpt(targetTeamId)), "Move Vault root");
  return unwrapCandid(actor.move_file(fileId, folderId), "Move vault file");
}

/**
 * Hard delete of the metadata row. File bytes live outside the canister
 * (Supabase storage today, the blob store later), so byte cleanup stays
 * with the storage layer.
 */
export async function permanentlyDeleteLiveVaultFile(ctx: FeatureBackendContext, fileId: string) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  const { listBlobStoreKeys } = await import("../mediaStorage");
  const { connectLiveBlobStore, deleteBlobFromStore } = await import("../blobStoreUpload");
  // The canister retains source-bound intent until confirmed byte absence.
  // A second begin refuses ambiguous cleanup instead of repeating deletion.
  const file = await getLiveVaultFile(ctx, fileId);
  if (file?.is_external_link) return unwrapCandid(actor.delete_file_permanent(fileId), "Delete external link");
  // Reconcile already-finished bytes without repeating a physical delete.
  try { return await unwrapCandid(actor.delete_file_permanent(fileId), "Reconcile Vault cleanup"); }
  catch (error) { if (!(error instanceof Error) || !error.message.includes("File cleanup required")) throw error; }
  const pinned = await unwrapCandid(actor.begin_file_cleanup(fileId), "Begin Vault cleanup");
  const ref = pinned.blob_ref[0];
  if (!ref) throw new Error("Vault file provenance unavailable");
  const key = listBlobStoreKeys(ctx.target).find(key => ctx.target.canisterIds[key] === ref.canister);
  if (!key) throw new Error("Original Vault file store is not configured");
  const { actor: store } = await connectLiveBlobStore(ctx.target, ctx.identity, key);
  const hash = await store.get_content_hash(ref.path);
  if (hash[0] !== ref.content_hash) throw new Error("Vault bytes changed; cleanup requires reconciliation");
  await deleteBlobFromStore(ctx.target, ctx.identity, key, ref.path);
  return unwrapCandid(actor.delete_file_permanent(fileId), "Confirm Vault cleanup");
}

/**
 * Pinned vault per chat — canister counterpart of the Supabase
 * chat_pinned_vault table. One pin per (chatType, chatId).
 */
export interface LivePinnedVault {
  chat_type: string;
  chat_id: string;
  club: string;
  vault_file_id: [] | [string];
  vault_folder_id: [] | [string];
  root_scope: [] | [string];
  root_id: [] | [string];
  enabled: boolean;
  set_by: Principal;
  updated_at_ms: bigint;
}

export interface LivePinnedVaultTarget {
  clubId: string;
  vaultFileId?: string | null;
  vaultFolderId?: string | null;
  rootScope?: "team" | "club" | null;
  rootId?: string | null;
  enabled: boolean;
}

export async function getLivePinnedVault(
  ctx: FeatureBackendContext,
  chatType: string,
  chatId: string,
): Promise<LivePinnedVault | null> {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  const row = await unwrapCandid(actor.get_pinned_vault(chatType, chatId), "Get pinned vault");
  return row.length ? row[0] : null;
}

export async function setLivePinnedVault(
  ctx: FeatureBackendContext,
  chatType: string,
  chatId: string,
  target: LivePinnedVaultTarget,
): Promise<LivePinnedVault> {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_pinned_vault(
      chatType,
      chatId,
      target.clubId,
      candidOpt(target.vaultFileId),
      candidOpt(target.vaultFolderId),
      candidOpt(target.rootScope),
      candidOpt(target.rootId),
      target.enabled,
    ),
    "Pin vault",
  );
}

export async function clearLivePinnedVault(
  ctx: FeatureBackendContext,
  chatType: string,
  chatId: string,
) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.clear_pinned_vault(chatType, chatId), "Unpin vault");
}

// ---- On-chain vault metadata backups (app admin only; blob refs, never plaintext) ----
export async function createLiveVaultBackup(ctx: FeatureBackendContext, label: string) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.create_backup(label), "Create backup");
}
export async function listLiveVaultBackups(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.read_account_list_backups(), "List backups");
}
export async function getLiveVaultBackup(ctx: FeatureBackendContext, id: string) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.read_account_get_backup(id), "Get backup");
}
export async function restoreLiveVaultBackup(ctx: FeatureBackendContext, id: string) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  let cursor = 0n;
  for (;;) {
    let receipt;
    try {
      receipt = await unwrapCandid(actor.restore_backup_page(id, cursor), "Restore backup page");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (cursor !== 0n || !/has no (?:query |update |)method|method not found|IC0536|is not a function/i.test(message)) throw error;
      return unwrapCandid(actor.restore_backup(id), "Restore legacy backup");
    }
    if (receipt.complete) return receipt.restored;
    if (receipt.next <= cursor) throw new Error("Invalid backup restore continuation");
    cursor = receipt.next;
  }
}
export async function deleteLiveVaultBackup(ctx: FeatureBackendContext, id: string) {
  const { actor } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_backup(id), "Delete backup");
}

export type LiveVaultBackupRestoreReport = {
  restoredRows: number;
  grantsRepaired: number;
  grantFailures: number;
  /** Blob paths whose encrypted bytes no longer load from the blob store. */
  missingBytes: string[];
};

/**
 * Restores metadata through durable bounded receipts and checks physical
 * availability. This never widens decryption grants or recreates missing bytes.
 */
export async function restoreLiveVaultBackupWithMedia(
  ctx: FeatureBackendContext,
  id: string,
): Promise<LiveVaultBackupRestoreReport> {
  const backup = await getLiveVaultBackup(ctx, id);
  const restoredRows = Number(await restoreLiveVaultBackup(ctx, id));
  const { blobAssetUrl } = await import("../mediaStorage");
  const report: LiveVaultBackupRestoreReport = { restoredRows, grantsRepaired: 0, grantFailures: 0, missingBytes: [] };
  for (const file of backup.files) {
    const ref = file.blob_ref?.[0];
    if (!ref) continue;
    try {
      const res = await fetch(blobAssetUrl(ref.canister, ref.path), { method: "GET", headers: { Range: "bytes=0-7" } });
      if (!res.ok) report.missingBytes.push(ref.path);
    } catch {
      report.missingBytes.push(ref.path);
    }
  }
  return report;
}
