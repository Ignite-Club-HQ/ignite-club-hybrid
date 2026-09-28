import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type EoiSubmission = Database["public"]["Tables"]["eoi_submissions"]["Row"];
export type EoiStatus = Database["public"]["Enums"]["eoi_status"];

export function useEoiSubmissions(clubId?: string, seasonId?: string | null) {
  return useQuery({
    queryKey: ["eoi-submissions", clubId, seasonId ?? "all"],
    queryFn: async (): Promise<EoiSubmission[]> => {
      if (!clubId) return [];
      let q = supabase
        .from("eoi_submissions")
        .select("*")
        .eq("club_id", clubId)
        .order("submitted_at", { ascending: false });
      if (seasonId) q = q.eq("season_id", seasonId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!clubId,
  });
}

export function useEoiStats(clubId?: string, seasonId?: string | null) {
  return useQuery({
    queryKey: ["eoi-stats", clubId, seasonId ?? "all"],
    queryFn: async () => {
      if (!clubId) return null;
      const { data, error } = await supabase.rpc("get_eoi_stats", {
        _club_id: clubId,
        _season_id: seasonId ?? undefined,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
    enabled: !!clubId,
  });
}

export function useUpdateEoiStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: EoiStatus }) => {
      const patch: Partial<EoiSubmission> = { status };
      const now = new Date().toISOString();
      if (status === "allocated") patch.allocated_at = now;
      if (status === "confirmed") patch.confirmed_at = now;
      if (status === "registered") patch.registered_at = now;
      if (status === "withdrawn") patch.withdrawn_at = now;
      const { error } = await supabase.from("eoi_submissions").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eoi-submissions"] });
      qc.invalidateQueries({ queryKey: ["eoi-stats"] });
    },
  });
}

export function useAssignEoiTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, teamId }: { id: string; teamId: string | null }) => {
      const patch: Partial<EoiSubmission> = {
        assigned_team_id: teamId,
        status: teamId ? "allocated" : "submitted",
        allocated_at: teamId ? new Date().toISOString() : null,
      };
      const { error } = await supabase.from("eoi_submissions").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eoi-submissions"] });
      qc.invalidateQueries({ queryKey: ["eoi-stats"] });
    },
  });
}

export function useDeleteEoi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("eoi_submissions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eoi-submissions"] });
      qc.invalidateQueries({ queryKey: ["eoi-stats"] });
    },
  });
}
