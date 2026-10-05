import { connectLiveMediaMetadata } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import {
  resolveMediaSource,
  type LiveAssetLocation,
  type LiveBlobRef,
  type LiveMediaSource,
} from "../mediaStorage";
import { candidOpt, toNat64, unwrapCandid, unwrapCandidOpt } from "./candid";

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
  const hasScope =
    input.teamId || input.miniLeagueId || input.competitionId || input.eventId || input.caption || input.albumId;
  if (hasScope) {
    asset = await setLiveAssetScopeWithActor(actor, asset.id, input);
  }
  return asset;
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

export async function getLiveAsset(ctx: FeatureBackendContext, assetId: string) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  return unwrapCandidOpt(await actor.get_asset(assetId), "Get asset");
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
) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.add_comment(assetId, body, toNat64(createdAtMs)),
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
