import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

type IgniteSupabaseClient = SupabaseClient<Database>;

function miniLeagueId(metadata: Json | null): string | null {
  if (!metadata || Array.isArray(metadata) || typeof metadata !== "object") return null;
  const value = metadata.mini_league_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function resolveInviteNotificationPath(
  inviteId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<string | null> {
  const { data } = await client
    .from("pending_invites")
    .select("invite_token, team_id, club_id, status, metadata")
    .eq("id", inviteId)
    .maybeSingle();
  if (!data) return null;

  if (data.status === "accepted" || data.status === "auto_accepted") {
    const leagueId = miniLeagueId(data.metadata);
    if (leagueId) return `/mini-leagues/${leagueId}`;
    if (data.team_id) return `/teams/${data.team_id}`;
    if (data.club_id) return `/clubs/${data.club_id}`;
    return null;
  }
  if (!data.invite_token) return null;
  return data.team_id ? `/join/${data.invite_token}` : `/join/p/${data.invite_token}`;
}

export async function resolveJoinedMemberPath(
  relatedId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<string> {
  const { data: league } = await client.from("mini_leagues").select("id").eq("id", relatedId).maybeSingle();
  if (league) return `/mini-leagues/${relatedId}`;
  const { data: club } = await client.from("clubs").select("id").eq("id", relatedId).maybeSingle();
  return club ? `/clubs/${relatedId}` : `/teams/${relatedId}`;
}

export async function resolveProcessedJoinRequestPath(
  relatedId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<string> {
  const { data: club } = await client.from("clubs").select("id").eq("id", relatedId).maybeSingle();
  return club ? `/clubs/${relatedId}` : `/teams/${relatedId}`;
}
