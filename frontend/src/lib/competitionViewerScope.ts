import { supabase } from "@/integrations/supabase/client";

/**
 * Competitions whose fixture (team) games the user may VIEW without being on
 * a team: competition Owners/Admins (competition_roles) and league admins of
 * the organising club. Mirrors DB `is_league_admin_for_competition`.
 * Read-only visibility — grants no edit/RSVP/chat rights.
 */
export async function fetchViewableCompetitionIds(
  userId: string,
  roles: { role: string; club_id: string | null }[],
): Promise<string[]> {
  const scope = await fetchViewableFixtureScope(userId, roles);
  return scope;
}

/**
 * Same as above but each entry may be a competition id OR a competition
 * match id — fixture team events carry `competition_match_id` and often a
 * NULL `competition_id`, so visibility checks must match on either.
 */
async function fetchViewableFixtureScope(
  userId: string,
  roles: { role: string; club_id: string | null }[],
): Promise<string[]> {
  const leagueClubIds = roles
    .filter((r) => r.role === "league_admin" && r.club_id)
    .map((r) => r.club_id as string);
  const [crRes, compRes] = await Promise.all([
    supabase
      .from("competition_roles")
      .select("competition_id")
      .eq("user_id", userId)
      .in("role", ["owner", "admin"]),
    leagueClubIds.length > 0
      ? supabase.from("competitions").select("id").in("organizer_club_id", leagueClubIds)
      : Promise.resolve({ data: [] as { id: string }[], error: null as any }),
  ]);
  if (crRes.error) throw crRes.error;
  if (compRes.error) throw compRes.error;
  const compIds = Array.from(
    new Set([
      ...(crRes.data || []).map((r: any) => r.competition_id as string),
      ...(compRes.data || []).map((c: any) => c.id as string),
    ]),
  );
  if (compIds.length === 0) return [];
  const { data: matches, error: mErr } = await supabase
    .from("competition_matches")
    .select("id")
    .in("competition_id", compIds);
  if (mErr) throw mErr;
  return [...compIds, ...(matches || []).map((m: any) => m.id as string)];
}

type FixtureLike = {
  id: string;
  team_id?: string | null;
  competition_id?: string | null;
  competition_match_id?: string | null;
};

/**
 * Shared visibility rule for team events: own team → visible; otherwise a
 * competition fixture in a viewable competition → visible once per match
 * (the user's own team copy wins when they have one).
 */
export function makeTeamEventVisibility(teamIds: string[], viewableCompetitionIds: string[], all: FixtureLike[]) {
  const teamSet = new Set(teamIds);
  const compSet = new Set(viewableCompetitionIds);
  const seen = new Set<string>(
    all.filter((e) => e.team_id && teamSet.has(e.team_id) && e.competition_match_id).map((e) => e.competition_match_id as string),
  );
  return (e: FixtureLike): boolean => {
    if (e.team_id && teamSet.has(e.team_id)) return true;
    if (!e.team_id) return false;
    const inScope = (e.competition_id && compSet.has(e.competition_id)) || (e.competition_match_id && compSet.has(e.competition_match_id));
    if (!inScope) return false;
    const key = e.competition_match_id || e.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}
