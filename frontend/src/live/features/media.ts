import { connectLiveMediaMetadata } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import {
  resolveMediaSource,
  type LiveAssetLocation,
  type LiveBlobRef,
  type LiveMediaSource,
} from "../mediaStorage";
import { candidOpt, toNat64, unwrapCandid } from "./candid";
import { readCompatibleMediaPage, type MediaPageCursor } from '../mediaPaging';

/**
 * Media feature -> media_metadata canister.
 *
 * Canister-side counterpart of the Supabase media repositories in
 * `features/media/`. The canister stores asset *metadata* (checksum, storage
 * path, visibility) plus reactions and comments; the bytes themselves live
 * wherever `resolveMediaSource` points — Supabase object storage via
 * `storage_path` today, an ICP blob-store canister via `blob_ref` once one
 * is deployed.
 *
 * NOTE: untested against a live canister until deployment.
 */

export interface LiveAssetRegistration {
  clubId: string;
  kind: string;
  mime: string;
  checksum: string;
  storagePath: string;
  visibility: string;
  contentLength: number;
  /** Set when the bytes were uploaded to an ICP blob-store canister. */
  blobRef?: LiveBlobRef;
  /** Optional audience scope/tags (schema 4). */
  teamId?: string | null;
  miniLeagueId?: string | null;
  competitionId?: string | null;
  eventId?: string | null;
  caption?: string | null;
  /** Shared id grouping a multi-photo upload into one album post. */
  albumId?: string | null;
}

// Club media does not expire; the canister only requires a future timestamp.
const FAR_FUTURE_EXPIRY_MS = 4_102_444_800_000; // 2100-01-01

export async function registerLiveAsset(
  ctx: FeatureBackendContext,
  input: LiveAssetRegistration,
) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  let asset = await unwrapCandid(
    actor.register_asset(
      input.clubId,
      input.kind,
      input.mime,
      input.checksum,
      input.storagePath,
      input.visibility,
      BigInt(FAR_FUTURE_EXPIRY_MS),
    ),
    "Register asset",
  );
  if (input.blobRef) {
    asset = await unwrapCandid(
      actor.set_blob_ref(asset.id, [input.blobRef]),
      "Set blob reference",
    );
  }
  // Scope/tags are applied by the caller via setLiveAssetScope: the deployed
  // canister only gains set_asset_scope after the media_metadata redeploy,
  // and tag application must not fail the whole upload until then.
  return asset;
}

/** register_asset only — lets callers run it alongside the byte upload. */
export async function registerLiveAssetRecord(ctx: FeatureBackendContext, input: LiveAssetRegistration) {
  return registerLiveAsset(ctx, { ...input, blobRef: undefined });
}

/** Attaches uploaded on-chain bytes to an already-registered asset. */
export async function attachLiveAssetBlob(ctx: FeatureBackendContext, assetId: string, blobRef: LiveBlobRef) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  return unwrapCandid(actor.set_blob_ref(assetId, [blobRef]), "Set blob reference");
}

type MediaMetadataActor = Awaited<ReturnType<typeof connectLiveMediaMetadata>>["actor"];

async function setLiveAssetScopeWithActor(
  actor: MediaMetadataActor,
  assetId: string,
  scope: {
    teamId?: string | null;
    miniLeagueId?: string | null;
    competitionId?: string | null;
    eventId?: string | null;
    caption?: string | null;
    albumId?: string | null;
  },
) {
  return unwrapCandid(
    actor.set_asset_scope(
      assetId,
      candidOpt(scope.teamId),
      candidOpt(scope.miniLeagueId),
      candidOpt(scope.competitionId),
      candidOpt(scope.eventId),
      candidOpt(scope.caption),
      candidOpt(scope.albumId),
    ),
    "Set asset scope",
  );
}

/** Re-tag an existing asset (owner or club staff). */
export async function setLiveAssetScope(
  ctx: FeatureBackendContext,
  assetId: string,
  scope: {
    teamId?: string | null;
    miniLeagueId?: string | null;
    competitionId?: string | null;
    eventId?: string | null;
    caption?: string | null;
    albumId?: string | null;
  },
) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  return setLiveAssetScopeWithActor(actor, assetId, scope);
}

/** Where an asset's bytes are served from (Supabase storage or ICP blob store). */
export function liveAssetSource(asset: LiveAssetLocation): LiveMediaSource {
  return resolveMediaSource(asset);
}

export async function listLiveAssets(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  return actor.list_assets(clubId);
}

/** One genuinely bounded owning-canister page; never silently drain a gallery. */
export async function listLiveAssetsPage(ctx: FeatureBackendContext, clubId: string, cursor: MediaPageCursor | null = null) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  if (typeof actor.list_assets_page !== 'function') {
    if (cursor) throw new Error('Media paging method unavailable during continuation');
    return { assets: await actor.list_assets(clubId), next: null, bounded: false };
  }
  return readCompatibleMediaPage(
    () => actor.list_assets_page(clubId, cursor ? [cursor] : [], 60n),
    () => actor.list_assets(clubId),
    cursor === null,
  );
}

export async function getLiveAsset(ctx: FeatureBackendContext, assetId: string) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  // Ownership discovery asks multiple groups: absence in a non-owning group
  // is expected, not a transport failure. Preserve actual rejected calls.
  return (await actor.get_asset(assetId))[0] ?? null;
}

export async function deleteLiveAsset(ctx: FeatureBackendContext, assetId: string) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_asset(assetId), "Delete asset");
}

export async function addLiveReaction(
  ctx: FeatureBackendContext,
  assetId: string,
  kind: string,
  createdAtMs: number | Date,
) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.add_reaction(assetId, kind, toNat64(createdAtMs)),
    "Add reaction",
  );
}

export async function removeLiveReaction(ctx: FeatureBackendContext, reactionId: string) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  return unwrapCandid(actor.remove_reaction(reactionId), "Remove reaction");
}

export async function listLiveReactions(ctx: FeatureBackendContext, assetId: string) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  return actor.list_reactions(assetId);
}

export async function addLiveComment(
  ctx: FeatureBackendContext,
  assetId: string,
  body: string,
  createdAtMs: number | Date,
  replyToId?: string | null,
) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.add_comment_reply(assetId, body, candidOpt(replyToId)),
    "Add comment",
  );
}

export async function listLiveComments(ctx: FeatureBackendContext, assetId: string) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  return actor.list_comments(assetId);
}

export async function deleteLiveComment(ctx: FeatureBackendContext, commentId: string) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_comment(commentId), "Delete comment");
}

// ---------------------------------------------------------------------------
// Gallery chat cards (photo-share prompt cards embedded in chat)
// ---------------------------------------------------------------------------

/** Single gallery chat card; null when missing or the caller cannot view it. */
export async function getLiveGalleryChatCard(ctx: FeatureBackendContext, cardId: string) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  const row = await actor.get_gallery_chat_card(cardId);
  return row.length ? row[0] : null;
}

export async function listLiveGalleryChatCards(
  ctx: FeatureBackendContext,
  clubId: string,
  teamId: string,
) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  return actor.list_gallery_chat_cards(clubId, teamId);
}

// ---------------------------------------------------------------------------
// Publish a chat image to the club media gallery (MessageActionSheet)
// ---------------------------------------------------------------------------


/** Feed-only hides metadata without deleting the Vault copy or source bytes. */
export async function removeLiveGalleryAsset(ctx: FeatureBackendContext, assetId: string, mode: 'feed_only' | 'feed_and_vault') {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  return unwrapCandid(actor.remove_gallery_asset(assetId, mode), 'Remove gallery photo');
}
export async function announceLiveGalleryAsset(ctx: FeatureBackendContext, assetId: string) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  return unwrapCandid(actor.announce_gallery_asset(assetId), 'Queue gallery notification');
}

export async function recordLiveGalleryView(ctx: FeatureBackendContext, assetId: string) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  return unwrapCandid(actor.record_gallery_view(assetId), 'Record gallery view');
}
export async function readLiveGalleryViewCounts(ctx: FeatureBackendContext, ids: string[]) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  return unwrapCandid(actor.read_gallery_view_counts(ids), 'Read gallery views');
}

export async function publishLiveGalleryChatCard(ctx: FeatureBackendContext, input: {
  clubId: string; teamId: string; eventId?: string | null; assetIds: string[]; heroUrl: string; receipt: string;
}) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  const card = await unwrapCandid(actor.save_gallery_chat_card([], input.clubId, input.teamId,
    candidOpt(input.eventId), input.receipt, candidOpt(input.assetIds[0]), [input.heroUrl], input.assetIds.length, input.assetIds, false, false), 'Save gallery chat card');
  const { sendLiveMessage, isLiveConversationAbsent, ensureLiveClubConversations } = await import('./messaging');
  const { readContentInScope } = await import('../contentRouting');
  const { writeOnce } = await import('../clubScope');
  // Uploading does not open the team thread, so older teams may never have
  // provisioned their deterministic conversation. Only confirmed absence
  // authorizes repair; denied/unknown reads must stop before any write.
  const absent = await readContentInScope(ctx, 'messaging', { clubId: input.clubId }, scoped =>
    isLiveConversationAbsent(scoped, input.teamId));
  if (absent) {
    await readContentInScope(ctx, 'membership', writeOnce({ clubId: input.clubId }), scoped =>
      ensureLiveClubConversations(scoped, input.clubId));
    const stillAbsent = await readContentInScope(ctx, 'messaging', { clubId: input.clubId }, scoped =>
      isLiveConversationAbsent(scoped, input.teamId));
    if (stillAbsent) throw new Error('Team chat could not be prepared');
  }
  await readContentInScope(ctx, 'messaging', writeOnce({ clubId: input.clubId }), scoped =>
    sendLiveMessage(scoped, input.teamId, `[gallery:${card.id}]`, input.receipt));
  return card;
}
