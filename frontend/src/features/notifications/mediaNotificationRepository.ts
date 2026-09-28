import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type IgniteSupabaseClient = SupabaseClient<Database>;

export type MediaNotificationTarget =
  | { status: "found"; path: string }
  | { status: "unavailable"; path: null };

export async function resolvePhotoInteractionTarget(
  photoId: string,
  showComments: boolean,
  client: IgniteSupabaseClient = supabase,
): Promise<MediaNotificationTarget> {
  const { data } = await client.from("photos").select("id, deleted_at").eq("id", photoId).maybeSingle();
  if (!data || data.deleted_at) return { status: "unavailable", path: null };
  return { status: "found", path: `/media?photo=${photoId}${showComments ? "&comments=1" : ""}` };
}

export async function resolveUploadedPhotoTarget(
  photoId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<string> {
  const { data } = await client.from("photos").select("id, team_id, club_id, deleted_at").eq("id", photoId).maybeSingle();
  if (!data || data.deleted_at) return "/media";
  if (data.team_id) return `/media?team=${data.team_id}`;
  if (data.club_id) return `/media?club=${data.club_id}`;
  return "/media";
}

export async function resolvePhotoPromptTarget(
  eventId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<string> {
  const { data } = await client.from("events").select("id, team_id").eq("id", eventId).maybeSingle();
  return data?.team_id
    ? `/media?team=${data.team_id}&event=${data.id}&upload=1`
    : "/media?upload=1";
}

export async function resolveCommentNotificationTarget(
  relatedId: string,
  relatedIdIsPhoto: boolean,
  client: IgniteSupabaseClient = supabase,
): Promise<MediaNotificationTarget> {
  let photoId: string | null = relatedIdIsPhoto ? relatedId : null;
  if (!relatedIdIsPhoto) {
    const { data } = await client.from("photo_comments").select("photo_id").eq("id", relatedId).maybeSingle();
    photoId = data?.photo_id ?? null;
  }
  if (!photoId) return { status: "unavailable", path: null };
  return resolvePhotoInteractionTarget(photoId, true, client);
}
