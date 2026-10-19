import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { withFeatureBackend } from "@/live/featureRouter";

type DutyTeamAccess = { teamIds: string[]; leagueAdminClubIds: string[] };

export function dutyTeamBadgeAudience(
  event: { duty_team_id?: string | null; club_id?: string | null },
  access: DutyTeamAccess | undefined,
): "member" | "league_admin" | null {
  const teamId = event.duty_team_id;
  if (!teamId || !access) return null;
  if (access.teamIds.includes(teamId)) return "member";
  if (event.club_id && access.leagueAdminClubIds.includes(event.club_id)) return "league_admin";
  return null;
}

export function useMyDutyTeamAccess() {
  const { user } = useAuth();
  return useQuery<DutyTeamAccess>({
    queryKey: ["my-duty-team-access", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: () => withFeatureBackend("membership", {
      supabase: async () => {
        const [roles, children, guardians] = await Promise.all([
          supabase.from("user_roles").select("team_id, club_id, role").eq("user_id", user!.id),
          supabase.from("children").select("id").eq("parent_id", user!.id),
          supabase.from("child_guardians").select("child_id").eq("guardian_id", user!.id),
        ]);
        if (roles.error) throw roles.error;
        if (children.error) throw children.error;
        if (guardians.error) throw guardians.error;
        const childIds = Array.from(new Set([
          ...(children.data ?? []).map((child) => child.id),
          ...(guardians.data ?? []).map((guardian) => guardian.child_id),
        ]));
        const assignments = childIds.length > 0
          ? await supabase.from("child_team_assignments").select("team_id").in("child_id", childIds)
          : { data: [], error: null };
        if (assignments.error) throw assignments.error;
        return {
          teamIds: Array.from(new Set([
            ...(roles.data ?? []).map((role) => role.team_id),
            ...(assignments.data ?? []).map((assignment) => assignment.team_id),
          ].filter((id): id is string => !!id))),
          leagueAdminClubIds: Array.from(new Set(
            (roles.data ?? [])
              .filter((role) => role.role === "league_admin" && role.club_id)
              .map((role) => role.club_id as string),
          )),
        };
      },
      icp: async (ctx) => {
        const [{ getLiveMyRoleGrants }, { getLiveMyChildren, getLiveMyChildTeamAssignments }] = await Promise.all([
          import("@/live/features/membership"),
          import("@/live/features/events"),
        ]);
        const grants = await getLiveMyRoleGrants(ctx);
        const children = await getLiveMyChildren(ctx);
        const assignments = await Promise.all(
          children.map((child) => getLiveMyChildTeamAssignments(ctx, child.id)),
        );
        return {
          teamIds: Array.from(new Set([
            ...grants.map((grant) => grant.team[0] ?? null),
            ...assignments.flatMap((rows) => rows.map((row) => row.team_id)),
          ].filter((id): id is string => !!id))),
          leagueAdminClubIds: Array.from(new Set(
            grants
              .filter((grant) => grant.role === "league_admin")
              .map((grant) => grant.club[0] ?? null)
              .filter((id): id is string => !!id),
          )),
        };
      },
    }, { everyGroup: true, merge: (parts) => ({
      teamIds: [...new Set(parts.flatMap(p => p.teamIds))],
      leagueAdminClubIds: [...new Set(parts.flatMap(p => p.leagueAdminClubIds))],
    }) }),
  });
}

export function MyTeamDutyTag({ event }: { event: { id: string; club_id: string; duty_team_id?: string | null; duty_team_label?: string | null } }) {
  const { data: access } = useMyDutyTeamAccess();
  const audience = dutyTeamBadgeAudience(event, access);
  const dutyTeamId = event.duty_team_id;
  const { data: dutyTeamName } = useQuery({
    queryKey: ["duty-team-name", dutyTeamId],
    enabled: !!dutyTeamId && audience === "league_admin",
    staleTime: 5 * 60 * 1000,
    queryFn: () => withFeatureBackend("membership", {
      supabase: async () => {
        const { data, error } = await supabase.from("teams").select("name").eq("id", dutyTeamId!).maybeSingle();
        if (error) throw error;
        return data?.name ?? null;
      },
      icp: async (ctx) => {
        const { getLiveTeam } = await import("@/live/features/club");
        const rows = await getLiveTeam(ctx, dutyTeamId!);
        return rows[0]?.name ?? null;
      },
    }, { teamId: dutyTeamId! }),
  });

  if (!audience) return null;
  const label = event.duty_team_label?.trim();
  const text = audience === "member"
    ? label ? `You're on ${label} duty` : "Your team is on duty"
    : `On duty: ${dutyTeamName ?? "Team"}${label ? ` — ${label}` : ""}`;

  return (
    <div className={`flex items-center gap-1.5 pt-1 text-xs font-medium ${audience === "member" ? "text-primary" : "text-muted-foreground"}`}>
      <ClipboardCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}