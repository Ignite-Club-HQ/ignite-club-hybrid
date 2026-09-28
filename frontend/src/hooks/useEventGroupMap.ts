import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

export type EventGrouping = "level" | "team";

interface Params {
  clubId: string | null | undefined;
  grouping: EventGrouping | null | undefined;
  /** When set, only teams in this list are considered members of the event. */
  targetTeamIds?: string[] | null;
  /**
   * For targeted club-wide events, pass the scoped SECURITY DEFINER roster so
   * grouping does not depend on client-side RLS access to user_roles or
   * child_team_assignments.
   */
  scopedRosterRows?: ScopedRosterRow[] | null;
  /** Only run when the event is club-wide (no team_id) and grouping is set. */
  enabled: boolean;
}

interface GroupInfo {
  key: string;
  label: string;
}

interface ScopedRosterRow {
  kind: string;
  person_id: string;
  team_ids: string[] | null;
}

const OTHER_GROUP: GroupInfo = { key: "__other__", label: "Other" };
const AGE_LEVEL_RE = /u\s*(\d+)/i;

function extractAgeLevel(source: string | null | undefined): string | null {
  if (!source) return null;
  const m = source.match(AGE_LEVEL_RE);
  if (!m) return null;
  return `U${parseInt(m[1], 10)}`;
}

function sortGroupKeys<T extends GroupInfo>(groups: T[]): T[] {
  return [...groups].sort((a, b) => {
    if (a.key === OTHER_GROUP.key) return 1;
    if (b.key === OTHER_GROUP.key) return -1;
    const na = a.label.match(/^U(\d+)/i);
    const nb = b.label.match(/^U(\d+)/i);
    if (na && nb) {
      const diff = parseInt(na[1], 10) - parseInt(nb[1], 10);
      if (diff !== 0) return diff;
    }
    return a.label.localeCompare(b.label);
  });
}

/**
 * For a club-wide event with a chosen RSVP grouping (age level or team),
 * resolves every adult member / child to a display group and returns:
 *
 *  - `orderedGroups` — the list of groups to render, in display order
 *  - `groupOf({ userId, childId })` — group lookup for a specific attendee
 *
 * Adults resolve via any `user_roles` row that ties them to one of the
 * eligible teams (respecting `targetTeamIds` when set). Children resolve
 * via `child_team_assignments`. Anyone not tied to a scoped team lands in
 * an "Other" group so club admins/committee still appear somewhere.
 */
export function useEventGroupMap({ clubId, grouping, targetTeamIds, scopedRosterRows, enabled }: Params) {
  const targetKey = useMemo(
    () => (Array.isArray(targetTeamIds) && targetTeamIds.length > 0 ? [...targetTeamIds].sort().join(",") : ""),
    [targetTeamIds],
  );
  const hasScopedRoster = !!targetKey && Array.isArray(scopedRosterRows);
  const scopedRosterKey = useMemo(() => {
    if (!hasScopedRoster) return "";
    return (scopedRosterRows ?? [])
      .map((r) => `${r.kind}:${r.person_id}:${[...(r.team_ids ?? [])].sort().join("|")}`)
      .sort()
      .join(",");
  }, [hasScopedRoster, scopedRosterRows]);

  const query = useQuery({
    queryKey: ["event-group-map", clubId, grouping, targetKey, hasScopedRoster ? "scoped-roster" : "direct", scopedRosterKey],
    enabled: !!enabled && !!clubId && (grouping === "level" || grouping === "team"),
    staleTime: 60_000,
    queryFn: async () => {
      let teamsQ = supabase
        .from("teams")
        .select("id, name, level_age")
        .eq("club_id", clubId!);
      if (targetKey) teamsQ = teamsQ.in("id", targetKey.split(","));
      const { data: teams, error: teamsErr } = await teamsQ;
      if (teamsErr) throw teamsErr;

      const teamIds = (teams ?? []).map((t: any) => t.id);

      if (hasScopedRoster) {
        const scopedRows = scopedRosterRows ?? [];
        return {
          teams: teams ?? [],
          roles: scopedRows
            .filter((r) => r.kind === "adult")
            .flatMap((r) => (r.team_ids ?? []).map((teamId) => ({ user_id: r.person_id, team_id: teamId }))),
          assignments: scopedRows
            .filter((r) => r.kind === "child")
            .flatMap((r) => (r.team_ids ?? []).map((teamId) => ({ child_id: r.person_id, team_id: teamId }))),
        };
      }

      const [rolesRes, assignmentsRes] = await Promise.all([
        teamIds.length
          ? supabase
              .from("user_roles")
              .select("user_id, team_id")
              .eq("club_id", clubId!)
              .in("team_id", teamIds)
          : Promise.resolve({ data: [] as any[], error: null }),
        teamIds.length
          ? supabase
              .from("child_team_assignments")
              .select("child_id, team_id")
              .in("team_id", teamIds)
          : Promise.resolve({ data: [] as any[], error: null }),
      ]);
      if (rolesRes.error) throw rolesRes.error;
      if (assignmentsRes.error) throw assignmentsRes.error;

      return {
        teams: teams ?? [],
        roles: rolesRes.data ?? [],
        assignments: assignmentsRes.data ?? [],
      };
    },
  });

  const { orderedGroups, userToGroup, childToGroup } = useMemo(() => {
    const empty = {
      orderedGroups: [] as GroupInfo[],
      userToGroup: new Map<string, GroupInfo>(),
      childToGroup: new Map<string, GroupInfo>(),
    };
    if (!enabled || !grouping || !query.data) return empty;

    const { teams, roles, assignments } = query.data;
    const teamToGroup = new Map<string, GroupInfo>();
    const groupsByKey = new Map<string, GroupInfo>();

    const addGroup = (info: GroupInfo) => {
      if (!groupsByKey.has(info.key)) groupsByKey.set(info.key, info);
      return groupsByKey.get(info.key)!;
    };

    for (const t of teams as any[]) {
      let info: GroupInfo;
      if (grouping === "team") {
        info = addGroup({ key: `team:${t.id}`, label: t.name || "Unnamed team" });
      } else {
        const lvl = extractAgeLevel(t.level_age) || extractAgeLevel(t.name);
        info = addGroup(
          lvl
            ? { key: `level:${lvl}`, label: lvl }
            : { key: `team:${t.id}`, label: t.name || "Unnamed team" },
        );
      }
      teamToGroup.set(t.id, info);
    }

    const userToGroup = new Map<string, GroupInfo>();
    for (const r of roles as any[]) {
      const g = teamToGroup.get(r.team_id);
      if (!g) continue;
      // First-wins: an adult tied to multiple teams appears once, under the
      // first team we see. Prefer keeping them tied to an existing group.
      if (!userToGroup.has(r.user_id)) userToGroup.set(r.user_id, g);
    }

    const childToGroup = new Map<string, GroupInfo>();
    for (const a of assignments as any[]) {
      const g = teamToGroup.get(a.team_id);
      if (!g) continue;
      if (!childToGroup.has(a.child_id)) childToGroup.set(a.child_id, g);
    }

    const orderedGroups = sortGroupKeys([...groupsByKey.values()]);
    return { orderedGroups, userToGroup, childToGroup };
  }, [enabled, grouping, query.data]);

  const isActive = !!enabled && (grouping === "level" || grouping === "team");

  // "Scoped" = the event restricts its audience to a set of teams. In that
  // mode an attendee that resolves to no eligible group is OUT OF SCOPE and
  // must not be rendered — "Other" is only for genuinely in-scope attendees
  // (e.g. a club-level admin with no team).
  const isScoped = !!targetKey;

  const groupOf = ({
    userId,
    childId,
  }: {
    userId?: string | null;
    childId?: string | null;
  }): GroupInfo | null => {
    if (childId) {
      const g = childToGroup.get(childId);
      if (g) return g;
      return isScoped ? null : OTHER_GROUP;
    }
    if (userId) {
      const g = userToGroup.get(userId);
      if (g) return g;
      // Adults are scoped upstream (roster query) — club-level admins /
      // committee legitimately have no team, so they land in "Other".
      return OTHER_GROUP;
    }
    return null;
  };

  // Always include the "Other" bucket so in-scope members who don't resolve to
  // a team (club-level admins/committee) still render. Empty buckets are
  // filtered by callers.
  const displayGroups = useMemo<GroupInfo[]>(
    () => [...orderedGroups, OTHER_GROUP],
    [orderedGroups],
  );

  return {
    isActive,
    isScoped,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    orderedGroups: displayGroups,
    groupOf,
  };
}

