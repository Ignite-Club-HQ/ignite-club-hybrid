import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type EoiSubmission = Database["public"]["Tables"]["eoi_submissions"]["Row"];

/**
 * EOIs belonging to the signed-in user that still need action
 * (submitted, preferences_completed, allocated).
 */
export function useMyPendingEois(enabled = true) {
  return useQuery({
    queryKey: ["my-pending-eois"],
    queryFn: async (): Promise<EoiSubmission[]> => {
      const { data, error } = await supabase.rpc("get_my_pending_eois");
      if (error) throw error;
      return (data as EoiSubmission[]) ?? [];
    },
    enabled,
  });
}

export function useConfirmEoi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (submissionId: string) => {
      const { data, error } = await supabase.rpc("confirm_eoi_placement", {
        _submission_id: submissionId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-pending-eois"] });
      qc.invalidateQueries({ queryKey: ["eoi-by-token"] });
    },
  });
}

/**
 * Links an EOI submission to the current signed-in user by its claim token.
 * Uses a direct update — RLS (auto-claim trigger also catches this on signup).
 */
export function useClaimEoi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => {
      const { data, error } = await supabase.rpc("claim_eoi_by_token", { _token: token });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-pending-eois"] });
      qc.invalidateQueries({ queryKey: ["eoi-by-token"] });
    },
  });
}

export function useUpdateMyEoi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<EoiSubmission>;
    }) => {
      const { error } = await supabase
        .from("eoi_submissions")
        .update({
          ...patch,
          status: "preferences_completed",
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-pending-eois"] });
      qc.invalidateQueries({ queryKey: ["eoi-by-token"] });
    },
  });
}
