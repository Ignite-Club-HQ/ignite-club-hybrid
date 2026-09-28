import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Returns whether the current user has active Pro (or Pro Football) access
 * on AT LEAST ONE club they belong to (directly or via a team in user_roles).
 * Used to gate user-level Pro features (e.g. scheduled messages).
 *
 * Fail-safe contract:
 * - Every Supabase error is thrown so React Query can retry it and callers
 *   observe `isError`.
 * - Errors are NEVER cached as a definitive Free result. While the lookup
 *   is unknown (loading OR errored), `isLoading` remains true so gating UI
 *   stays in its neutral state — no misleading "Free" banner, no accidental
 *   Pro grant.
 * - Successful Free and Pro answers behave exactly as before.
 */
export function useUserHasAnyClubPro() {
  const { user } = useAuth();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["user-has-any-club-pro", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    // React Query default retry (3x with exponential backoff) covers
    // transient network / RLS blips.
    queryFn: async (): Promise<boolean> => {
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user!.id);
      if (rolesError) throw rolesError;

      if (!roles?.length) return false;

      const directClubIds = roles.filter((r) => r.club_id).map((r) => r.club_id!);
      const teamIds = roles.filter((r) => r.team_id).map((r) => r.team_id!);

      let teamClubIds: string[] = [];
      if (teamIds.length > 0) {
        const { data: teams, error: teamsError } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);
        if (teamsError) throw teamsError;
        teamClubIds = (teams ?? []).map((t: any) => t.club_id).filter(Boolean);
      }

      const allClubIds = Array.from(new Set([...directClubIds, ...teamClubIds]));
      if (allClubIds.length === 0) return false;

      const { data: subs, error: subsError } = await supabase
        .from("club_subscriptions")
        .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
        .in("club_id", allClubIds);
      if (subsError) throw subsError;

      return (subs ?? []).some(
        (s: any) =>
          (s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override) &&
          (!s.expires_at || new Date(s.expires_at) > new Date()),
      );
    },
  });

  // Represent the "unknown" state (loading OR errored) as `isLoading` so all
  // existing `!isLoading && !hasAnyClubPro` gates continue to fail closed
  // during errors — the user won't see a definitive Free banner while the
  // entitlement is truly unknown.
  const isUnknown = isLoading || isError;

  return {
    hasAnyClubPro: data === true,
    isLoading: isUnknown,
    isError,
    error: (error as Error | null) ?? null,
  };
}
