import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type EoiTeamSuggestion = {
  age_group: string;
  player_count: number;
  avg_skill: number;
  submission_ids: string[];
};

export function useEoiTeamSuggestions(seasonId?: string | null) {
  return useQuery({
    queryKey: ["eoi-team-suggestions", seasonId],
    queryFn: async (): Promise<EoiTeamSuggestion[]> => {
      if (!seasonId) return [];
      const { data, error } = await supabase.rpc("suggest_eoi_teams", {
        _season_id: seasonId,
      });
      if (error) throw error;
      return (data as any[])?.map((r) => ({
        age_group: r.age_group,
        player_count: Number(r.player_count),
        avg_skill: Number(r.avg_skill),
        submission_ids: r.submission_ids ?? [],
      })) ?? [];
    },
    enabled: !!seasonId,
  });
}

export function useAllocateEoiToTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      submissionId,
      teamId,
    }: {
      submissionId: string;
      teamId: string | null;
    }) => {
      const { error } = await supabase.rpc("allocate_eoi_to_team", {
        _submission_id: submissionId,
        _team_id: teamId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eoi-submissions"] });
      qc.invalidateQueries({ queryKey: ["eoi-stats"] });
      qc.invalidateQueries({ queryKey: ["eoi-team-suggestions"] });
    },
  });
}

export function useAllocateEoisBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      submissionIds,
      teamId,
    }: {
      submissionIds: string[];
      teamId: string;
    }) => {
      for (const id of submissionIds) {
        const { error } = await supabase.rpc("allocate_eoi_to_team", {
          _submission_id: id,
          _team_id: teamId,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eoi-submissions"] });
      qc.invalidateQueries({ queryKey: ["eoi-stats"] });
      qc.invalidateQueries({ queryKey: ["eoi-team-suggestions"] });
    },
  });
}
