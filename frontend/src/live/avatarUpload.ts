import { getCurrentInternetIdentity } from "./internetIdentityAuth";
import { getActiveIcpTarget } from "./targetRegistry";
import { isBlobStoreConfigured } from "./blobStoreUpload";
import { tryUploadMediaToBlobStore } from "./mediaUpload";
import { MEDIA_BLOB_PII_FIELD, parseIcpBlobUrl } from "./mediaDecrypt";
import { grantLiveClubPiiRead } from "./features/vault";
import { getLiveMyRoleGrants } from "./features/membership";
import { getCachedIcpIdentityProfile } from "./identityProfileCache";
import type { FeatureBackendContext } from "./featureRouter";

/**
 * Profile-photo upload for Internet Identity sessions — the ICP replacement
 * for the Supabase `avatars` storage bucket. Bytes are IBE-encrypted in the
 * browser and stored on the media_blob_store canister (exactly like chat /
 * media attachments); the returned on-chain URL is what callers persist as
 * the identity_access `avatar_ref`. The blob store only ever holds
 * ciphertext, and the pii_access_control record created inside
 * tryUploadMediaToBlobStore gates who may derive the decryption vetKey.
 *
 * Access model: the uploader is the record owner. Club-scoped read grants
 * (syncLiveAvatarClubGrants) let every club the member belongs to decrypt
 * the photo — has_club_staff_role treats any role grant in the club as
 * membership — so clubmates see the avatar everywhere it renders. Grants
 * are re-synced on profile save and after joining/creating a club, which
 * covers clubs joined after the photo was set.
 *
 * This module pulls in the ICP agent / vetKeys SDK chain — import it
 * dynamically, never statically.
 */
export async function uploadIcpAvatar(args: {
  file: File | Blob;
  mime: string;
  ext: string;
}): Promise<string> {
  const target = getActiveIcpTarget();
  const identity = await getCurrentInternetIdentity();
  if (!identity || !isBlobStoreConfigured(target)) {
    throw new Error("Photo storage isn't available for this account yet. Please try again in a moment.");
  }
  const storagePath = `avatars/${identity.getPrincipal().toText()}/${Date.now()}.${args.ext}`;
  const result = await tryUploadMediaToBlobStore({
    storagePath,
    file: args.file,
    mime: args.mime,
  });
  if (!result) {
    throw new Error("Photo storage isn't available for this account yet. Please try again in a moment.");
  }
  // Best-effort: let current clubs decrypt the new photo. Never fails the
  // upload — the sync re-runs on the next profile save or club join.
  void Promise.resolve(syncLiveAvatarClubGrants({ target, identity }, storagePath)).catch(() => {});
  return result.url;
}

/**
 * Best-effort re-grant of the caller's encrypted avatar blob to every club
 * they belong to. Called after avatar upload, on profile save, and after
 * join/create flows so clubmates can always decrypt the photo. Never
 * throws. `knownStoragePath` skips the profile lookup when the caller just
 * uploaded (the cache may not reflect the new ref yet).
 */
export async function syncLiveAvatarClubGrants(
  ctx: FeatureBackendContext,
  knownStoragePath?: string,
): Promise<void> {
  try {
    const storagePath = knownStoragePath ?? (await ownAvatarStoragePath(ctx));
    if (!storagePath) return;
    const grants = await getLiveMyRoleGrants(ctx);
    const clubIds = [
      ...new Set(grants.map((g) => g.club?.[0]).filter((c): c is string => !!c)),
    ];
    await Promise.all(
      clubIds.map((clubId) =>
        grantLiveClubPiiRead(ctx, storagePath, MEDIA_BLOB_PII_FIELD, clubId),
      ),
    );
  } catch (error) {
    console.error("[avatar] club read-grant sync failed", error);
  }
}

/** The caller's avatar blob-store path, or null when they have no on-chain photo. */
async function ownAvatarStoragePath(ctx: FeatureBackendContext): Promise<string | null> {
  const principal = ctx.identity.getPrincipal().toText();
  let avatarRef = getCachedIcpIdentityProfile(principal)?.avatarRef ?? null;
  if (!avatarRef) {
    try {
      const { fetchIcpIdentityProfile } = await import("./identityProfile");
      avatarRef = (await fetchIcpIdentityProfile(ctx.identity, principal, ctx.target)).avatarRef;
    } catch {
      return null;
    }
  }
  if (!avatarRef) return null;
  return parseIcpBlobUrl(avatarRef, ctx.target)?.path ?? null;
}
