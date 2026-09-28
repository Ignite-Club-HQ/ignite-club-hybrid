import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { hasGameBoardSupport } from "@/lib/sportDetection";



const VAULT_ROLES = [
  "app_admin",
  "club_admin",
  "league_admin",
  "team_admin",
  "coach",
  "committee_member",
];
const PITCH_ROLES = ["app_admin", "club_admin", "team_admin", "coach"];

/**
 * Permission snapshot used by the desktop-only nav rail / action bar so items
 * the user cannot use are never rendered. Mobile surfaces are untouched.
 */
export function useDesktopNavAccess() {
  const { user } = useAuth();
  const { activeClubFilter } = useClubTheme();

  const { data } = useQuery({
    queryKey: ["desktop-nav-access", user?.id, activeClubFilter],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: roles, error } = await supabase
        .from("user_roles")
        .select("role, club_id, team_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      const rows = (roles || []) as Array<{ role: string; club_id: string | null; team_id: string | null }>;

      const teamIds = Array.from(new Set(rows.map((r) => r.team_id).filter(Boolean) as string[]));

      // Resolve the club behind every team role so a football club membership
      // can never light up the board for a non-football club (or vice versa).
      let teamClubMap = new Map<string, string>();
      let teamNameMap = new Map<string, string>();
      if (teamIds.length > 0) {
        const { data: teams } = await supabase.from("teams").select("id, name, club_id").in("id", teamIds);
        teamClubMap = new Map(
          (teams || []).filter((t) => !!t.club_id).map((t) => [t.id as string, t.club_id as string]),
        );
        teamNameMap = new Map((teams || []).map((t) => [t.id as string, (t.name as string) ?? "Team"]));
      }

      const clubIds = Array.from(
        new Set([
          ...(rows.map((r) => r.club_id).filter(Boolean) as string[]),
          ...Array.from(teamClubMap.values()),
        ]),
      );

      // The pitch board only exists for football/soccer in this build — never
      // surface it for other sports.
      const boardClubIds = new Set<string>();
      if (clubIds.length > 0) {
        const { data: clubs } = await supabase.from("clubs").select("id, sport").in("id", clubIds);
        (clubs || []).forEach((c) => {
          if (hasGameBoardSupport(c.sport)) boardClubIds.add(c.id as string);
        });
      }

      // Respect the active club filter: the rail reflects the club the user is
      // currently looking at, not the union of every club they belong to.
      const inScope = (clubId: string | null | undefined) =>
        !!clubId && boardClubIds.has(clubId) && (!activeClubFilter || clubId === activeClubFilter);

      const boardRoleRows = rows.filter((r) => {
        if (!PITCH_ROLES.includes(r.role)) return false;
        const clubId = r.club_id ?? (r.team_id ? teamClubMap.get(r.team_id) ?? null : null);
        return inScope(clubId);
      });

      const allBoardTeamIds = teamIds.filter((id) => inScope(teamClubMap.get(id)));

      // Club-level coach/admin roles cover every team in that club; otherwise
      // only offer the teams the user actually coaches/admins.
      const hasClubWideBoardRole = boardRoleRows.some((r) => !r.team_id && !!r.club_id);
      const directBoardTeamIds = boardRoleRows
        .map((r) => r.team_id)
        .filter((id): id is string => !!id && allBoardTeamIds.includes(id));

      const boardTeamIds = hasClubWideBoardRole
        ? allBoardTeamIds
        : Array.from(new Set(directBoardTeamIds));

      return {
        hasTeams: rows.some((r) => !!r.team_id),
        hasClubs: rows.some((r) => !!r.club_id),
        canAccessVault: rows.some((r) => VAULT_ROLES.includes(r.role)),
        canPitchBoard: boardRoleRows.length > 0 && boardTeamIds.length > 0,
        canCreateEvent: rows.some((r) =>
          ["app_admin", "club_admin", "team_admin", "coach", "committee_member"].includes(r.role),
        ),
        canCreateTeam: rows.some((r) => r.role === "club_admin" || r.role === "app_admin"),
        teamIds: boardTeamIds,
        boardTeams: boardTeamIds.map((id) => ({ id, name: teamNameMap.get(id) ?? "Team" })),
      };
    },

  });


  return {
    hasTeams: !!data?.hasTeams,
    hasClubs: !!data?.hasClubs,
    canAccessVault: !!data?.canAccessVault,
    canPitchBoard: !!data?.canPitchBoard,
    canCreateEvent: !!data?.canCreateEvent,
    canCreateTeam: !!data?.canCreateTeam,
    teamIds: data?.teamIds ?? [],
    boardTeams: data?.boardTeams ?? [],
  };
}

/**
 * Resolves the team whose Pitch Board should open from the desktop rail.
 * Prefer the team with the next upcoming game, but always fall back to the
 * first in-scope football team. The team page owns the canonical standalone
 * board modal; event/group routes add extra event-day and roster gates and are
 * therefore not suitable as the desktop navigation destination.
 */
export function useNextPitchBoardTarget(teamIds: string[], enabled: boolean) {
  const { data } = useQuery({
    queryKey: ["desktop-next-pitch-board", [...teamIds].sort().join(",")],
    enabled: enabled && teamIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<string | null> => {
      const { data: events, error } = await supabase
        .from("events")
        .select("team_id, event_date")
        .in("team_id", teamIds)
        .eq("type", "game")
        .eq("is_cancelled", false)
        .gte("event_date", new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString())
        .order("event_date", { ascending: true })
        .limit(1);
      if (error) throw error;
      const preferredTeamId = events?.[0]?.team_id ?? teamIds[0];
      return preferredTeamId ? `/teams/${preferredTeamId}?openPitchBoard=1` : null;
    },
  });

  // The access query has already scoped these IDs to the active football club.
  // Supplying this synchronously removes the second-query race where a quick
  // click previously saw `null` and navigated to the Schedule page.
  const fallbackTeamId = enabled ? teamIds[0] : undefined;
  return data ?? (fallbackTeamId ? `/teams/${fallbackTeamId}?openPitchBoard=1` : null);
}
