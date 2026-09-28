import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/** Resend the magic-link invite for a given EOI submission. */
export function useResendEoiInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (submissionId: string) => {
      const { error } = await supabase.functions.invoke("send-eoi-invite", {
        body: { submission_id: submissionId },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invite resent");
      qc.invalidateQueries({ queryKey: ["eoi-submissions"] });
    },
    onError: (e: unknown) => {
      console.error(e);
      toast.error("Could not resend invite");
    },
  });
}

/** Resend invites in bulk to all submissions whose parent has not completed yet. */
export function useBulkResendEoiInvites() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (submissionIds: string[]) => {
      let ok = 0;
      let fail = 0;
      // Sequential to avoid hammering the function; the volume is small.
      for (const id of submissionIds) {
        const { error } = await supabase.functions.invoke("send-eoi-invite", {
          body: { submission_id: id },
        });
        if (error) fail++;
        else ok++;
      }
      return { ok, fail };
    },
    onSuccess: ({ ok, fail }) => {
      if (fail === 0) toast.success(`Sent ${ok} reminder${ok === 1 ? "" : "s"}`);
      else toast.warning(`Sent ${ok}, failed ${fail}`);
      qc.invalidateQueries({ queryKey: ["eoi-submissions"] });
    },
  });
}
