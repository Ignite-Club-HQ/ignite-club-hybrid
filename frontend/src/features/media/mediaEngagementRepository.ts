import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { withFeatureBackend } from "@/live/featureRouter";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { recordLivePhotoEngagement } from "@/live/features/insights";
import { getCurrentInternetIdentity } from "@/live/internetIdentityAuth";
import { getActiveIcpTarget } from "@/live/targetRegistry";
import {
  addLiveComment,
  addLiveReaction,
  listLiveReactions,
  removeLiveReaction,
} from "@/live/features/media";

type IgniteSupabaseClient = SupabaseClient<Database>;

// Best-effort dual-write of a photo engagement counter to insights_domain
// when the "analytics" feature is ICP-routed. Independent of the "media"
// feature routing above (which fully replaces the Supabase reaction/comment
// rows) — this only feeds the engagement dashboards and must never block or
// fail the primary write.
async function recordAnalyticsPhotoEngagement(photoId: string, kind: "Reaction" | "Comment") {
  if (!isFeatureRoutedToIcp("analytics")) return;
  try {
    const identity = await getCurrentInternetIdentity();
    if (!identity) return;
    await recordLivePhotoEngagement({ identity, target: getActiveIcpTarget() }, photoId, kind);
  } catch {
    // instrumentation only
  }
}

/**
 * Media engagement writes (reactions, comments).
 *
 * Hybrid routing mirrors the reads in mediaReadRepository: when the media
 * feature resolves to ICP the canister's add/remove calls are used with the
 * photo id doubling as the canister asset id (the same provisional mapping
 * the feed read uses). Until the canister ID is configured every caller
 * stays on Supabase. NOTE: untested against a live canister until
 * deployment.
 */
export async function replaceMediaReaction(
  input: { photoId: string; userId: string; reactionType: string },
  client: IgniteSupabaseClient = supabase,
): Promise<void> {
  return withFeatureBackend("media", {
    supabase: async () => {
      const { error: deleteError } = await client.from("photo_reactions").delete()
        .eq("photo_id", input.photoId).eq("user_id", input.userId);
      if (deleteError) throw deleteError;

      const { error: insertError } = await client.from("photo_reactions").insert({
        photo_id: input.photoId,
        user_id: input.userId,
        reaction_type: input.reactionType,
      });
      if (insertError) throw insertError;
      await recordAnalyticsPhotoEngagement(input.photoId, "Reaction");
    },
    icp: async (ctx) => {
      // The canister keys reactions by (asset, user), so add_reaction already
      // replaces any existing reaction from this caller — no delete needed.
      await addLiveReaction(ctx, input.photoId, input.reactionType, Date.now());
    },
  });
}

export async function removeMediaReaction(
  input: { photoId: string; userId: string },
  client: IgniteSupabaseClient = supabase,
): Promise<void> {
  return withFeatureBackend("media", {
    supabase: async () => {
      const { error } = await client.from("photo_reactions").delete()
        .eq("photo_id", input.photoId).eq("user_id", input.userId);
      if (error) throw error;
    },
    icp: async (ctx) => {
      // remove_reaction takes the reaction id; resolve the caller's reaction
      // on this asset first. A missing reaction is a no-op, matching the
      // Supabase delete.
      const reactions = await listLiveReactions(ctx, input.photoId);
      const mine = (reactions as any[]).find(
        (reaction) => reaction.user.toText() === ctx.identity.getPrincipal().toText(),
      );
      if (mine) await removeLiveReaction(ctx, mine.id);
    },
  });
}

export async function createMediaComment(
  input: { photoId: string; userId: string; text: string; replyToId?: string },
  client: IgniteSupabaseClient = supabase,
): Promise<void> {
  return withFeatureBackend("media", {
    supabase: async () => {
      const { error } = await client.from("photo_comments").insert({
        photo_id: input.photoId,
        user_id: input.userId,
        text: input.text,
        reply_to_id: input.replyToId || null,
      });
      if (error) throw error;
      await recordAnalyticsPhotoEngagement(input.photoId, "Comment");
    },
    icp: async (ctx) => {
      // The canister comment shape has no reply threading; replyToId is
      // dropped on the ICP branch until the canister model covers it.
      await addLiveComment(ctx, input.photoId, input.text, Date.now());
    },
  });
}
