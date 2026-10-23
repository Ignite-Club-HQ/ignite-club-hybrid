import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Competitions the current user can organise a competition-wide event for
 * (owners/admins, league admins of the organising club). Empty when none.
 */
export function useOrganisableCompetitions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["organisable-competitions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("competitions")
        .select("id, name, status")
        .order("name");
      const rows = ((data as any[]) || []).filter((c) => c.status !== "archived");
      const checks = await Promise.all(
        rows.map(async (c) => {
          const { data: ok } = await supabase.rpc("can_create_competition_event" as any, {
            _user_id: user!.id,
            _competition_id: c.id,
          });
          return ok === true ? c : null;
        }),
      );
      return checks.filter(Boolean) as { id: string; name: string }[];
    },
  });
}

/** Number of accepted teams entered in a competition. */
export function useCompetitionAcceptedCount(competitionId: string) {
  return useQuery({
    queryKey: ["competition-accepted-count", competitionId],
    enabled: !!competitionId,
    queryFn: async () => {
      const { count } = await (supabase as any)
        .from("competition_entries")
        .select("id", { count: "exact", head: true })
        .eq("competition_id", competitionId)
        .eq("status", "accepted");
      return count ?? 0;
    },
  });
}
