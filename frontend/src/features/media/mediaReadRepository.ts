import { readContentInScope } from "@/live/contentRouting";
import { assertReadNotAborted, withReadDeadline } from "@/live/readDeadline";
import { settleAll } from "@/live/crossGroupClubs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { withFeatureBackend } from "@/live/featureRouter";
import {
  listLiveAssets,
  listLiveComments,
  listLiveReactions,
  liveAssetSource,
} from "@/live/features/media";

type IgniteSupabaseClient = SupabaseClient<Database>;

const MEDIA_PHOTO_SELECT = "id, file_url, image_url, title, caption, created_at, club_id, team_id, event_id, mini_league_id, competition_id, uploader_id, album_id, clubs!club_id(name, is_pro), teams(name, club_id, clubs!club_id(name)), mini_leagues(name, club_id, clubs!club_id(name))";
const HIGHLIGHTED_PHOTO_SELECT = "id, file_url, image_url, title, caption, created_at, club_id, team_id, event_id, mini_league_id, competition_id, uploader_id, clubs!club_id(name, is_pro), teams(name, club_id, clubs!club_id(name)), mini_leagues(name, club_id, clubs!club_id(name))";

export type MediaFeedFilters = {
  clubId: string | null;
  teamId: string | null;
  eventId: string | null;
  competitionId: string | null;
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
  options: MediaFeedFilters & { offset: number; pageSize: number; signal?: AbortSignal; onProgress?: (page: { photos: any[]; nextCursor: number | undefined; incomplete?: boolean }) => void },
  client: IgniteSupabaseClient = supabase,
): Promise<{ photos: any[]; nextCursor: number | undefined; incomplete?: boolean }> {
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
      if (options.competitionId) query = query.eq("competition_id", options.competitionId);
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
      const clubIds = options.clubId ? [options.clubId] : await (async () => {
        // Club ids from role grants (every group), not one group's club list.
        const { getLiveMyRoleGrants } = await import("@/live/features/membership");
        const { grantClubId } = await import("@/live/crossGroupClubs");
        const grants = await getLiveMyRoleGrants(ctx) as unknown as Parameters<typeof grantClubId>[0][];
        return [...new Set(grants.map(grantClubId).filter((c): c is string => !!c))];
      })();
      // Each club's photos come from its own group; one failing club never empties the feed.
      const loaded = new Map<string, Awaited<ReturnType<typeof listLiveAssets>>>();
      const mapPage = (incomplete: boolean) => {
      const assets = [...new Map([...loaded.values()].flat().map(asset => [asset.id, asset])).values()];
      const photos = assets
        .filter(asset => !asset.deleted && (!options.cardId || options.cardPhotoIds?.includes(asset.id)))
        .filter(asset => !options.teamId || asset.team_id?.[0] === options.teamId)
        .filter(asset => !options.eventId || asset.event_id?.[0] === options.eventId)
        .filter(asset => !options.competitionId || asset.competition_id?.[0] === options.competitionId)
        .map(asset => {
          const source = liveAssetSource(asset);
          const url = source.kind === "icp-blob" ? source.url : source.storagePath;
          return {
            id: asset.id, file_url: url, image_url: url, title: asset.kind,
            caption: asset.caption?.[0] ?? null,
            created_at: asset.created_at_ms ? new Date(Number(asset.created_at_ms)).toISOString() : null,
            club_id: asset.club_id, team_id: asset.team_id?.[0] ?? null,
            event_id: asset.event_id?.[0] ?? null, mini_league_id: asset.mini_league_id?.[0] ?? null,
            competition_id: asset.competition_id?.[0] ?? null, uploader_id: asset.owner.toText(),
            album_id: asset.album_id?.[0] ?? null, clubs: null, teams: null, mini_leagues: null,
          };
        })
        .filter(photo => !options.dateFrom || !!photo.created_at && photo.created_at >= options.dateFrom)
        .filter(photo => !options.dateTo || !!photo.created_at && photo.created_at <= options.dateTo)
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
      const page = photos.slice(options.offset, options.offset + options.pageSize);
      return {
        photos: page, incomplete,
        nextCursor: page.length === options.pageSize ? options.offset + options.pageSize : undefined,
      };
      };
      const settled = await settleAll(clubIds.map(clubId => withReadDeadline(readContentInScope(ctx, "media", { clubId }, scoped => listLiveAssets(scoped, clubId).then(assets => {
        // Photos to show: start this club's photo key now, in parallel with
        // rendering and downloads, instead of after the first download.
        if (assets.some(asset => !asset.deleted && liveAssetSource(asset).kind === "icp-blob")) {
          void import("@/live/piiVetKeys").then(m => m.prewarmClubMediaKey(scoped, clubId)).catch(() => {});
        }
        return assets;
      })), "Club photos", 20_000, options.signal).then(assets => {
        assertReadNotAborted(options.signal);
        loaded.set(clubId, assets);
        options.onProgress?.(mapPage(true));
        return assets;
      })));
      assertReadNotAborted(options.signal);
      return mapPage(settled.failed > 0);
    },
  }, options.clubId ? { clubId: options.clubId } : options.competitionId ? { competitionId: options.competitionId } : options.eventId ? { eventId: options.eventId } : options.teamId ? { teamId: options.teamId } : { shared: "person" });
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
        photoIds.map((photoId) => readContentInScope(ctx, "media", { photoId }, scoped => listLiveReactions(scoped, photoId))),
      );
      return results.flat().map((reaction: any) => ({
        photo_id: reaction.asset_id,
        user_id: reaction.user.toText(),
        reaction_type: reaction.kind,
        profiles: null,
      }));
    },
  }, { shared: "person" });
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
        photoIds.map((photoId) => readContentInScope(ctx, "media", { photoId }, scoped => listLiveComments(scoped, photoId))),
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
          reply_to_id: comment.reply_to_id?.[0] ?? null,
          reply_to: null,
          created_at: new Date(Number(comment.created_at_ms)).toISOString(),
          profiles: null,
        })) as any[];
    },
  }, { shared: "person" });
}
