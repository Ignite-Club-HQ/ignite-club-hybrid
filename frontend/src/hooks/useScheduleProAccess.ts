import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { useUserHasAnyClubPro } from "@/hooks/useUserHasAnyClubPro";
import type { ScheduleTarget } from "@/hooks/useScheduledMessages";

/**
 * Resolves whether the user has Pro access for the exact chat scope being
 * scheduled into.
 *
 * Fail-closed rules (see cross-club scheduled-message entitlement spec):
 *   - Club-scoped target (`club_id`): only that club's entitlement grants
 *     access. Never falls back to any-club Pro.
 *   - Team-scoped target (`team_id`): resolves the team's owning club and
 *     uses that club's entitlement.
 *       * While the team→club lookup is loading: `{ hasAccess: false,
 *         isLoading: true }` — never returns an any-club fallback.
 *       * If the team resolves to no club (missing/orphan): `{ hasAccess:
 *         false, isLoading: false }` — fail closed.
 *       * If the team lookup errors: same fail-closed shape.
 *   - Genuinely clubless targets (DM, broadcast, group with no owning
 *     club/team): fall back to any-club Pro per existing product rules.
 */
export function useScheduleProAccess(target: ScheduleTarget | null | undefined) {
  const hasExplicitClub = !!target?.club_id;
  const hasTeam = !!target?.team_id;
  const teamId = target?.team_id ?? null;

  // Only resolve team → club when the target is team-scoped AND the caller
  // did not already provide a trusted club_id.
  const teamLookupEnabled = hasTeam && !hasExplicitClub;
  const teamLookup = useQuery({
    queryKey: ["team-club-id", teamId],
    enabled: teamLookupEnabled,
    staleTime: 5 * 60_000,
    // Propagate errors so callers can distinguish "no club" from "lookup
    // failed" — both fail closed, but we must not swallow the error into a
    // silently-null clubId.
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("club_id")
        .eq("id", teamId!)
        .maybeSingle();
      if (error) throw error;
      return (data?.club_id as string) ?? null;
    },
  });

  const resolvedClubId = hasExplicitClub
    ? target!.club_id!
    : teamLookupEnabled
      ? (teamLookup.data ?? null)
      : null;

  // Always call the entitlement hooks (Rules of Hooks); their `enabled` flags
  // gate the actual queries so we don't fetch what we don't need.
  const club = useClubProAccess(resolvedClubId, { enabled: !!resolvedClubId });
  const any = useUserHasAnyClubPro();

  // ---- Explicit classification ---------------------------------------------

  // 1. Club-scoped target — exact club entitlement only.
  if (hasExplicitClub) {
    return { hasAccess: club.hasPro, isLoading: club.isLoading };
  }

  // 2. Team-scoped target — resolve owning club, then use its entitlement.
  //    Never borrow any-club Pro while loading or after a lookup failure.
  if (hasTeam) {
    if (teamLookup.isLoading || teamLookup.isFetching) {
      return { hasAccess: false, isLoading: true };
    }
    if (teamLookup.isError) {
      return { hasAccess: false, isLoading: false };
    }
    if (!resolvedClubId) {
      // Team resolved to no club (orphan/missing). Fail closed.
      return { hasAccess: false, isLoading: false };
    }
    return { hasAccess: club.hasPro, isLoading: club.isLoading };
  }

  // 3. Genuinely clubless target (DM, broadcast, standalone group) — the
  //    existing product rule allows any-club Pro to unlock scheduling.
  return { hasAccess: any.hasAnyClubPro, isLoading: any.isLoading };
}
