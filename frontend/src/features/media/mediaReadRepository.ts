import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { withFeatureBackend } from "@/live/featureRouter";
import {
  listLiveAssets,
  listLiveComments,
  listLiveReactions,
} from "@/live/features/media";

type IgniteSupabaseClient = SupabaseClient<Database>;

const MEDIA_PHOTO_SELECT = "id, file_url, image_url, title, caption, created_at, club_id, team_id, event_id, mini_league_id, uploader_id, album_id, clubs!club_id(name, is_pro), teams(name, club_id, clubs!club_id(name)), mini_leagues(name, club_id, clubs!club_id(name))";
const HIGHLIGHTED_PHOTO_SELECT = "id, file_url, image_url, title, caption, created_at, club_id, team_id, event_id, mini_league_id, uploader_id, clubs!club_id(name, is_pro), teams(name, club_id, clubs!club_id(name)), mini_leagues(name, club_id, clubs!club_id(name))";

export type MediaFeedFilters = {
  clubId: string | null;
  teamId: string | null;
  eventId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  cardId: string | null;
  cardPhotoIds: readonly string[] | undefined;
};

export async function fetchGalleryCardPhotoIds(
  cardId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<string[]> {
  const { data } = await client
    .from("gallery_chat_cards")
    .select("photo_ids")
    .eq("id", cardId)
    .maybeSingle();
  return (data?.photo_ids as string[] | null) ?? [];
}

export async function fetchMediaFeedPage(
  options: MediaFeedFilters & { offset: number; pageSize: number },
  client: IgniteSupabaseClient = supabase,
): Promise<{ photos: any[]; nextCursor: number | undefined }> {
  if (options.cardId && (options.cardPhotoIds?.length ?? 0) === 0) {
    return { photos: [], nextCursor: undefined };
  }

  return withFeatureBackend("media", {
    supabase: async () => {
      let query: any = client
        .from("photos")
        .select(MEDIA_PHOTO_SELECT)
        .eq("show_in_feed", true)
        .is("deleted_at", null);
      if (options.cardId && options.cardPhotoIds?.length) query = query.in("id", [...options.cardPhotoIds]);
      if (options.clubId) query = query.eq("club_id", options.clubId);
      if (options.teamId) query = query.eq("team_id", options.teamId);
      if (options.eventId) query = query.eq("event_id", options.eventId);
      if (options.dateFrom) query = query.gte("created_at", options.dateFrom);
      if (options.dateTo) query = query.lte("created_at", options.dateTo);

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .range(options.offset, options.offset + options.pageSize - 1);
      if (error) throw error;
      return {
        photos: data ?? [],
        nextCursor: data?.length === options.pageSize ? options.offset + options.pageSize : undefined,
      };
    },
    icp: async (ctx) => {
      // The media_metadata canister lists assets per club only; feeds without
      // a club scope (cross-club views, gallery-card subsets, team/event
      // filters) have no canister query yet and return empty until parity
      // lands. Provisional until verified against a deployed canister.
      if (!options.clubId || options.cardId) {
        return { photos: [] as any[], nextCursor: undefined };
      }
      const assets = await listLiveAssets(ctx, options.clubId);
      const photos = assets
        .filter((asset) => !asset.deleted)
        .map((asset) => ({
          id: asset.id,
          file_url: asset.storage_path,
          image_url: asset.storage_path,
          title: asset.kind,
          caption: null,
          // The canister asset carries retention/expiry timestamps but no
          // creation timestamp — date display and ordering are provisional.
          created_at: null,
          club_id: asset.club_id,
          team_id: null,
          event_id: null,
          mini_league_id: null,
          uploader_id: asset.owner.toText(),
          album_id: null,
          clubs: null,
          teams: null,
          mini_leagues: null,
        }));
      const page = photos.slice(options.offset, options.offset + options.pageSize);
      return {
        photos: page,
        nextCursor: page.length === options.pageSize ? options.offset + options.pageSize : undefined,
      };
    },
  });
}

export async function fetchHighlightedMediaPhoto(
  photoId: string,
  client: IgniteSupabaseClient = supabase,
  sleep: (milliseconds: number) => Promise<unknown> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
) {
  for (const delay of [0, 500, 1000, 2000]) {
    if (delay > 0) await sleep(delay);
    const { data, error } = await client
      .from("photos")
      .select(HIGHLIGHTED_PHOTO_SELECT)
      .eq("id", photoId)
      .eq("show_in_feed", true)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  return null;
}

export async function fetchMediaReactions(
  photoIds: readonly string[],
  client: IgniteSupabaseClient = supabase,
) {
  if (photoIds.length === 0) return [];

  return withFeatureBackend("media", {
    supabase: async () => {
      const { data, error } = await client
        .from("photo_reactions")
        .select("photo_id, user_id, reaction_type, profiles:user_id(display_name, avatar_url)")
        .in("photo_id", [...photoIds]);
      if (error) {
        console.error("Error fetching reactions:", error);
        return [];
      }
      return data ?? [];
    },
    icp: async (ctx) => {
      // Provisional mapping: canister reaction (asset_id, user, kind) onto the
      // photo_reactions row shape; profile enrichment stays Supabase-side and
      // resolves to null for principal ids.
      const results = await Promise.all(
        photoIds.map((photoId) => listLiveReactions(ctx, photoId).catch(() => [])),
      );
      return results.flat().map((reaction: any) => ({
        photo_id: reaction.asset_id,
        user_id: reaction.user.toText(),
        reaction_type: reaction.kind,
        profiles: null,
      }));
    },
  });
}

export async function fetchMediaComments(
  photoIds: readonly string[],
  client: IgniteSupabaseClient = supabase,
) {
  if (photoIds.length === 0) return [];

  return withFeatureBackend("media", {
    supabase: async () => {
      const { data, error } = await client
        .from("photo_comments")
        .select("*, profiles:user_id(display_name, avatar_url)")
        .in("photo_id", [...photoIds])
        .order("created_at", { ascending: true });
      if (error) {
        console.error("Error fetching comments:", error);
        return [];
      }
      return data ?? [];
    },
    icp: async (ctx) => {
      // Provisional mapping: canister comment (asset_id, author, body) onto
      // the photo_comments row shape.
      const results = await Promise.all(
        photoIds.map((photoId) => listLiveComments(ctx, photoId).catch(() => [])),
      );
      return results
        .flat()
        .filter((comment: any) => !comment.deleted)
        .sort((a: any, b: any) => Number(a.created_at_ms - b.created_at_ms))
        .map((comment: any) => ({
          id: comment.id,
          photo_id: comment.asset_id,
          user_id: comment.author.toText(),
          text: comment.body,
          reply_to_id: null,
          reply_to: null,
          created_at: new Date(Number(comment.created_at_ms)).toISOString(),
          profiles: null,
        })) as any[];
    },
  });
}
