import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type IgniteSupabaseClient = SupabaseClient<Database>;
type Entitlement = {
  is_pro?: boolean | null;
  is_pro_football?: boolean | null;
  admin_pro_override?: boolean | null;
  admin_pro_football_override?: boolean | null;
};

const hasPro = (row: Entitlement) => Boolean(
  row.is_pro || row.is_pro_football || row.admin_pro_override || row.admin_pro_football_override,
);

export async function fetchMediaUserRoles(
  userId: string,
  client: IgniteSupabaseClient = supabase,
) {
  const { data, error } = await client
    .from("user_roles")
    .select("role, club_id, team_id")
    .eq("user_id", userId);
  if (error) throw error;
  return data ?? [];
}

export async function fetchMediaProAccess(
  options: {
    roleClubIds: readonly string[];
    roleTeamIds: readonly string[];
    activeClubId: string | null;
  },
  client: IgniteSupabaseClient = supabase,
): Promise<boolean> {
  const candidateClubIds = options.activeClubId
    ? [...new Set([...options.roleClubIds, options.activeClubId])]
    : [...options.roleClubIds];
  if (candidateClubIds.length === 0 && options.roleTeamIds.length === 0) return false;

  const [clubSubscriptions, teamInfo] = await Promise.all([
    candidateClubIds.length > 0
      ? client
          .from("club_subscriptions")
          .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .in("club_id", candidateClubIds)
      : Promise.resolve({ data: [], error: null }),
    options.roleTeamIds.length > 0
      ? client.from("teams").select("id, club_id").in("id", [...options.roleTeamIds])
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (clubSubscriptions.error) throw clubSubscriptions.error;
  if (teamInfo.error) throw teamInfo.error;
  if ((clubSubscriptions.data ?? []).some(hasPro)) return true;

  const parentClubIds = [...new Set(
    (teamInfo.data ?? []).flatMap((team) => team.club_id ? [team.club_id] : []),
  )];
  const missingParentClubIds = parentClubIds.filter((clubId) => !candidateClubIds.includes(clubId));
  if (missingParentClubIds.length > 0) {
    const { data, error } = await client
      .from("club_subscriptions")
      .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
      .in("club_id", missingParentClubIds);
    if (error) throw error;
    if ((data ?? []).some(hasPro)) return true;
  }

  if (options.roleTeamIds.length > 0) {
    const { data, error } = await client
      .from("team_subscriptions")
      .select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
      .in("team_id", [...options.roleTeamIds]);
    if (error) throw error;
    if ((data ?? []).some(hasPro)) return true;
  }

  const resolvedClubIds = [...new Set([...candidateClubIds, ...parentClubIds])];
  if (resolvedClubIds.length === 0) return false;
  const { data: legacyProClubs, error } = await client
    .from("clubs")
    .select("id")
    .in("id", resolvedClubIds)
    .eq("is_pro", true);
  if (error) throw error;
  return Boolean(legacyProClubs?.length);
}

export async function fetchMediaFilterClubs(
  clubIds: readonly string[],
  client: IgniteSupabaseClient = supabase,
) {
  const uniqueIds = [...new Set(clubIds)];
  if (uniqueIds.length === 0) return [];
  const { data } = await client
    .from("clubs")
    .select("id, name")
    .in("id", uniqueIds)
    .order("name");
  return data ?? [];
}

export async function fetchMediaFilterTeams(
  teamIds: readonly string[],
  client: IgniteSupabaseClient = supabase,
) {
  const uniqueIds = [...new Set(teamIds)];
  if (uniqueIds.length === 0) return [];
  const { data } = await client
    .from("teams")
    .select("id, name, club_id, clubs!club_id(name)")
    .in("id", uniqueIds)
    .is("deleted_at", null)
    .order("name");
  return data ?? [];
}
