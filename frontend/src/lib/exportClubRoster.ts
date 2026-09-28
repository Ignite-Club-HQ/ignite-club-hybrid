import { supabase } from "@/integrations/supabase/client";
import { downloadTextReport } from "@/lib/reportExport";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export interface ClubRosterRow {
  playerName: string;
  playerType: "Junior" | "Adult";
  yearOfBirth: string;
  teamName: string;
  ageGroup: string;
  parents: string;
}

/**
 * Builds a club-wide player list: junior players (children assigned to teams)
 * plus adult players (profiles holding the `player` role on a team).
 * Archived/deleted teams are excluded.
 */
export async function fetchClubRosterRows(clubId: string): Promise<ClubRosterRow[]> {
  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id, name, level_age, lifecycle_status, deleted_at")
    .eq("club_id", clubId);
  if (teamsError) throw teamsError;

  const teamRows = (teams || []) as {
    id: string;
    name: string | null;
    level_age: string | null;
    lifecycle_status: string | null;
    deleted_at: string | null;
  }[];

  const activeTeams = teamRows.filter(
    (t) => !t.deleted_at && t.lifecycle_status !== "archived",
  );
  if (activeTeams.length === 0) return [];

  const teamById = new Map(activeTeams.map((t) => [t.id, t]));
  const teamIds = activeTeams.map((t) => t.id);

  const [childRes, adultRes] = await Promise.all([
    supabase
      .from("child_team_assignments")
      .select("team_id, children (id, name, year_of_birth, parent_id)")
      .in("team_id", teamIds),
    supabase
      .from("user_roles")
      .select("team_id, user_id, profiles (id, display_name)")
      .in("team_id", teamIds)
      .eq("role", "player"),
  ]);
  if (childRes.error) throw childRes.error;
  if (adultRes.error) throw adultRes.error;

  const childRows = (childRes.data || []) as {
    team_id: string;
    children: { id: string; name: string | null; year_of_birth: number | null; parent_id: string | null } | null;
  }[];

  // Club-scoped guardian names so we never surface a parent from another club.
  const childIds = [...new Set(childRows.map((r) => r.children?.id).filter(Boolean) as string[])];
  const guardiansByChild = new Map<string, string[]>();
  if (childIds.length > 0) {
    const { data: links } = await supabase.rpc("club_scoped_child_guardians", {
      p_child_ids: childIds,
      p_club_id: clubId,
    });
    const guardianIds = [
      ...new Set([
        ...((links || []) as { child_id: string; guardian_id: string }[]).map((l) => l.guardian_id),
        ...(childRows.map((r) => r.children?.parent_id).filter(Boolean) as string[]),
      ]),
    ];
    const nameById = new Map<string, string>();
    if (guardianIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", guardianIds);
      for (const p of profiles || []) if (p.display_name) nameById.set(p.id, p.display_name);
    }
    for (const row of childRows) {
      const child = row.children;
      if (!child) continue;
      const ids = [
        ...(child.parent_id ? [child.parent_id] : []),
        ...((links || []) as { child_id: string; guardian_id: string }[])
          .filter((l) => l.child_id === child.id)
          .map((l) => l.guardian_id),
      ];
      const names = [...new Set(ids.map((gid) => nameById.get(gid)).filter(Boolean) as string[])];
      guardiansByChild.set(child.id, names);
    }
  }

  const rows: ClubRosterRow[] = [];

  for (const row of childRows) {
    const child = row.children;
    const team = teamById.get(row.team_id);
    if (!child || !team) continue;
    rows.push({
      playerName: child.name ?? "",
      playerType: "Junior",
      yearOfBirth: child.year_of_birth ? String(child.year_of_birth) : "",
      teamName: team.name ?? "",
      ageGroup: team.level_age ?? "",
      parents: (guardiansByChild.get(child.id) || []).join("; "),
    });
  }

  for (const row of (adultRes.data || []) as {
    team_id: string | null;
    user_id: string | null;
    profiles: { id: string; display_name: string | null } | null;
  }[]) {
    const team = row.team_id ? teamById.get(row.team_id) : null;
    if (!team) continue;
    rows.push({
      playerName: row.profiles?.display_name ?? "Unnamed member",
      playerType: "Adult",
      yearOfBirth: "",
      teamName: team.name ?? "",
      ageGroup: team.level_age ?? "",
      parents: "",
    });
  }

  return rows.sort(
    (a, b) =>
      a.teamName.localeCompare(b.teamName) || a.playerName.localeCompare(b.playerName),
  );
}

export function clubRosterToCsv(rows: ClubRosterRow[]): string {
  const header = ["Player", "Team", "Age group", "Type", "Year of birth", "Parent/Guardian"].join(",");
  const lines = rows.map((r) =>
    [r.playerName, r.teamName, r.ageGroup, r.playerType, r.yearOfBirth, r.parents]
      .map(csvEscape)
      .join(","),
  );
  return [header, ...lines].join("\n");
}

/** Fetches, formats and downloads the club player list. Returns the row count. */
export async function exportClubRosterCsv(clubId: string, clubName: string): Promise<number> {
  const rows = await fetchClubRosterRows(clubId);
  const csv = clubRosterToCsv(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = (clubName || "club").replace(/\s+/g, "-").toLowerCase();
  await downloadTextReport(csv, `players-${slug}-${stamp}.csv`, "text/csv;charset=utf-8;");
  return rows.length;
}
