import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { withFeatureBackend } from "@/live/featureRouter";

/**
 * Competitions the current user can organise a competition-wide event for
 * (owners/admins, league admins of the organising club). Empty when none.
 * ICP: the canister's account-scoped "my news competitions" read returns
 * exactly the competitions the caller may administer/publish to.
 */
export function useOrganisableCompetitions(enabled = true) {
  const { user } = useAuth();
  const isIcp = resolveAuthBackend() === "icp";
  return useQuery({
    queryKey: ["organisable-competitions", user?.id, isIcp],
    enabled: enabled && (isIcp || !!user),
    queryFn: async () => {
      if (isIcp) {
        return withFeatureBackend("competitions", {
          supabase: async () => [] as { id: string; name: string }[],
          icp: async (ctx) => {
            const { listLiveMyNewsCompetitions } = await import("@/live/features/competitions");
            const rows = (await listLiveMyNewsCompetitions(ctx)) as any[];
            return rows
              .filter((c) => (c.status ? c.status !== "archived" : true))
              .map((c) => ({ id: c.id as string, name: c.name as string }))
              .sort((a, b) => a.name.localeCompare(b.name));
          },
        }, { shared: "app" });
      }
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
  const isIcp = resolveAuthBackend() === "icp";
  return useQuery({
    queryKey: ["competition-accepted-count", competitionId, isIcp],
    enabled: !!competitionId,
    queryFn: async () => {
      if (isIcp) {
        return withFeatureBackend("competitions", {
          supabase: async () => 0,
          icp: async (ctx) => {
            const { listLiveCompetitionEntries } = await import("@/live/features/competitions");
            const entries = (await listLiveCompetitionEntries(ctx, competitionId)) as any[];
            return entries.filter((e) => e.status === "accepted" || e.status === "registered").length;
          },
        }, { competitionId });
      }
      const { count } = await (supabase as any)
        .from("competition_entries")
        .select("id", { count: "exact", head: true })
        .eq("competition_id", competitionId)
        .eq("status", "accepted");
      return count ?? 0;
    },
  });
}
