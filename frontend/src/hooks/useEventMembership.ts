import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Whether the current user (or any of their children) is a member of the
 * audience this event was actually sent to. Used to gate "RSVP Required"
 * prompts — non-members should never be nagged to RSVP for an event that isn't
 * theirs.
 *
 * Membership rules:
 *  - Team events: user has a `user_roles` row for that team_id, OR has a
 *    child assigned to that team via `child_team_assignments`.
 *  - Club events WITH `target_team_ids`: only members (or guardians of children)
 *    of one of the targeted teams count. A club role on a non-targeted team,
 *    or a club-level role, is NOT membership — those users can see the event
 *    (admins/committee) but must not be prompted to RSVP.
 *  - Club events WITHOUT targets: user has any `user_roles` row for the club_id.
 *
 * Returns `true` while loading so we don't briefly hide content for members.
 * The caller can check `isFetched` if it needs to wait.
 */
export function useEventMembership(event: {
  id?: string;
  team_id: string | null;
  club_id: string;
  /** Pass through when known; otherwise the hook loads it for club-wide events. */
  target_team_ids?: string[] | null;
}) {
  const { user } = useAuth();

  return useQuery({
    queryKey: [
      "event-membership",
      event.id ?? null,
      event.team_id,
      event.club_id,
      user?.id,
    ],
    queryFn: async (): Promise<boolean> => {
      if (!user) return false;

      /** Membership against a concrete set of team ids. */
      const isMemberOfAnyTeam = async (teamIds: string[]): Promise<boolean> => {
        if (teamIds.length === 0) return false;

        const { data: roleRows } = await supabase
          .from("user_roles")
          .select("id")
          .eq("user_id", user.id)
          .in("team_id", teamIds)
          .limit(1);
        if ((roleRows?.length ?? 0) > 0) return true;

        // Child on one of the teams — own children
        const { data: ownChildren } = await supabase
          .from("children")
          .select("id, child_team_assignments!inner(team_id)")
          .eq("parent_id", user.id)
          .in("child_team_assignments.team_id", teamIds)
          .limit(1);
        if ((ownChildren?.length ?? 0) > 0) return true;

        // Child on one of the teams — guardian links
        const { data: guardianLinks } = await supabase
          .from("child_guardians")
          .select("child_id")
          .eq("guardian_id", user.id);
        const guardianChildIds = (guardianLinks ?? []).map((g) => g.child_id);
        if (guardianChildIds.length > 0) {
          const { data: assignments } = await supabase
            .from("child_team_assignments")
            .select("child_id")
            .in("team_id", teamIds)
            .in("child_id", guardianChildIds)
            .limit(1);
          if ((assignments?.length ?? 0) > 0) return true;
        }

        return false;
      };

      if (event.team_id) return isMemberOfAnyTeam([event.team_id]);

      // Club-wide event: resolve the invited teams, if any.
      let targets: string[] | null =
        event.target_team_ids === undefined
          ? null
          : (event.target_team_ids ?? null);

      if (event.target_team_ids === undefined && event.id) {
        const { data: row } = await supabase
          .from("events")
          .select("target_team_ids")
          .eq("id", event.id)
          .maybeSingle();
        targets = (row?.target_team_ids as string[] | null) ?? null;
      }

      const targetTeamIds = (targets ?? []).filter(Boolean);
      if (targetTeamIds.length > 0) {
        // Targeted club-wide event — only the invited teams' people qualify.
        return isMemberOfAnyTeam(targetTeamIds);
      }

      // Untargeted club-wide event — any club role qualifies.
      const { data: clubRole } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user.id)
        .eq("club_id", event.club_id)
        .limit(1)
        .maybeSingle();
      return !!clubRole;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}
