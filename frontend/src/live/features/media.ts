import { connectLiveMediaMetadata } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import {
  resolveMediaSource,
  type LiveAssetLocation,
  type LiveBlobRef,
  type LiveMediaSource,
} from "../mediaStorage";
import { toNat64, unwrapCandid, unwrapCandidOpt } from "./candid";

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
}

export async function registerLiveAsset(
  ctx: FeatureBackendContext,
  input: LiveAssetRegistration,
) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  const asset = await unwrapCandid(
    actor.register_asset(
      input.clubId,
      input.kind,
      input.mime,
      input.checksum,
      input.storagePath,
      input.visibility,
      BigInt(input.contentLength),
    ),
    "Register asset",
  );
  if (!input.blobRef) return asset;
  return unwrapCandid(
    actor.set_blob_ref(asset.id, [input.blobRef]),
    "Set blob reference",
  );
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

export async function getLiveGalleryChatCard(ctx: FeatureBackendContext, cardId: string) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  return unwrapCandidOpt(await actor.get_gallery_chat_card(cardId));
}

export async function listLiveGalleryChatCards(
  ctx: FeatureBackendContext,
  clubId: string,
  teamId: string,
) {
  const { actor } = await connectLiveMediaMetadata(ctx.target, ctx.identity);
  return actor.list_gallery_chat_cards(clubId, teamId);
}
