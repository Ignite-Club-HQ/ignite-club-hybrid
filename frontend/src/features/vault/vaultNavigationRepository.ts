import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { hasVaultProEntitlement } from "./vaultAccess";
import type { VaultFolderView } from "./types";

type IgniteSupabaseClient = SupabaseClient<Database>;

export type VaultTeamSummary = Pick<
  Database["public"]["Tables"]["teams"]["Row"],
  "id" | "name" | "folder_id"
>;

type VaultNavigationClub = { id: string; name: string };

export type VaultFolderDeepLink = {
  path: Array<{ id: string; name: string }>;
  view: Exclude<VaultFolderView, { type: "root" }> | null;
};

export async function resolveVaultFolderDeepLink(
  folderId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<VaultFolderDeepLink | null> {
  const { data: rawFolder, error } = await client
    .from("vault_folders")
    .select("*, teams!vault_folders_team_id_fkey(id, name, club_id), clubs!club_id(id, name)")
    .eq("id", folderId)
    .maybeSingle();
  if (error || !rawFolder) return null;

  const folder = rawFolder as typeof rawFolder & {
    teams: { id: string; name: string; club_id: string } | null;
    clubs: { id: string; name: string } | null;
  };
  const path: Array<{ id: string; name: string }> = [];
  let parentId = folder.parent_id;
  while (parentId) {
    const { data: parent } = await client
      .from("vault_folders")
      .select("id, name, parent_id")
      .eq("id", parentId)
      .maybeSingle();
    if (!parent) break;
    path.unshift({ id: parent.id, name: parent.name });
    parentId = parent.parent_id;
  }
  path.push({ id: folder.id, name: folder.name });

  if (folder.team_id && folder.teams) {
    const { data: club } = await client
      .from("clubs")
      .select("name")
      .eq("id", folder.teams.club_id)
      .maybeSingle();
    return {
      path,
      view: {
        type: "team",
        clubId: folder.teams.club_id,
        clubName: club?.name || "Unknown Club",
        teamId: folder.team_id,
        teamName: folder.teams.name,
        folderId: folder.id,
        folderName: folder.name,
      },
    };
  }
  return {
    path,
    view: folder.club_id && folder.clubs ? {
      type: "club",
      clubId: folder.club_id,
      clubName: folder.clubs.name,
      folderId: folder.id,
      folderName: folder.name,
    } : null,
  };
}

export async function resolveVaultScopeDeepLink(
  options: {
    clubId: string | null;
    teamId: string | null;
    miniLeagueId: string | null;
    accessibleClubs: readonly VaultNavigationClub[];
  },
  client: IgniteSupabaseClient = supabase,
): Promise<Exclude<VaultFolderView, { type: "root" }> | null> {
  if (options.miniLeagueId) {
    const { data: league } = await client
      .from("mini_leagues")
      .select("id, name, club_id")
      .eq("id", options.miniLeagueId)
      .maybeSingle();
    if (!league?.club_id) return null;
    const club = options.accessibleClubs.find((item) => item.id === league.club_id);
    return club ? {
      type: "mini-league",
      clubId: league.club_id,
      clubName: club.name,
      miniLeagueId: league.id,
      miniLeagueName: league.name,
    } : null;
  }
  if (options.teamId) {
    const { data: team } = await client
      .from("teams")
      .select("id, name, club_id")
      .eq("id", options.teamId)
      .maybeSingle();
    if (!team?.club_id) return null;
    const club = options.accessibleClubs.find((item) => item.id === team.club_id);
    return club ? {
      type: "team",
      clubId: team.club_id,
      clubName: club.name,
      teamId: team.id,
      teamName: team.name,
    } : null;
  }
  const club = options.accessibleClubs.find((item) => item.id === options.clubId);
  return club ? { type: "club", clubId: club.id, clubName: club.name } : null;
}

export async function fetchVaultClubTeams(
  options: {
    clubId: string;
    isClubAdmin: boolean;
    userTeamIds: readonly string[];
    clubHasPro: boolean;
  },
  client: IgniteSupabaseClient = supabase,
): Promise<VaultTeamSummary[]> {
  if (!options.isClubAdmin && options.userTeamIds.length === 0) return [];

  let query = client
    .from("teams")
    .select("id, name, folder_id")
    .eq("club_id", options.clubId);
  if (!options.isClubAdmin) query = query.in("id", [...options.userTeamIds]);

  const { data } = await query.is("deleted_at", null).order("name");
  const teams = data ?? [];
  if (options.clubHasPro || teams.length === 0) return teams;

  const { data: subscriptions } = await client
    .from("team_subscriptions")
    .select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
    .in("team_id", teams.map((team) => team.id));
  const proTeamIds = new Set(
    (subscriptions ?? []).filter(hasVaultProEntitlement).map((subscription) => subscription.team_id),
  );
  return teams.filter((team) => proTeamIds.has(team.id));
}

export async function fetchVaultTeamFolders(
  clubId: string,
  client: IgniteSupabaseClient = supabase,
) {
  const { data } = await client
    .from("team_folders")
    .select("*")
    .eq("club_id", clubId)
    .order("sort_order", { ascending: true });
  return data ?? [];
}

export async function fetchVaultMiniLeagues(
  options: { clubId: string; userId: string; isAppAdmin: boolean },
  client: IgniteSupabaseClient = supabase,
): Promise<Array<{ id: string; name: string }>> {
  const { data: roles } = await client
    .from("user_roles")
    .select("role, club_id, team_id")
    .eq("user_id", options.userId);

  const { data: subscription } = await client
    .from("club_subscriptions")
    .select("is_pro_football, admin_pro_football_override")
    .eq("club_id", options.clubId)
    .maybeSingle();
  const hasProFootball = Boolean(
    subscription?.is_pro_football || subscription?.admin_pro_football_override,
  );
  if (!hasProFootball && !options.isAppAdmin) return [];

  const canSeeAll = options.isAppAdmin || (roles ?? []).some((role) =>
    role.club_id === options.clubId && [
      "club_admin",
      "league_admin",
      "coach",
      "committee_member",
    ].includes(role.role),
  );
  if (canSeeAll) {
    const { data } = await client
      .from("mini_leagues")
      .select("id, name")
      .eq("club_id", options.clubId)
      .order("name");
    return data ?? [];
  }

  const { data } = await client
    .from("mini_league_players")
    .select("mini_league_id, mini_leagues!inner(id, name, club_id)")
    .eq("parent_user_id", options.userId);
  return (data ?? []).flatMap((playerLeague) => {
    const league = playerLeague.mini_leagues as unknown as {
      id: string;
      name: string;
      club_id: string;
    } | null;
    return league?.club_id === options.clubId ? [{ id: league.id, name: league.name }] : [];
  });
}
