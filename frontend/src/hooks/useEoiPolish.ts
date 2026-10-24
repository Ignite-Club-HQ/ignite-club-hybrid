import { writeOnce } from "@/live/clubScope";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { withFeatureBackend } from "@/live/featureRouter";
import { resendLiveEoiInvite } from "@/live/features/competitions";
import { writeEoiInScope } from "@/live/competitionRouting";
import { resolveAuthBackend } from "@/live/authBackendMode";

/** Resend the magic-link invite for a given EOI submission. */
export function useResendEoiInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (submissionId: string) =>
      withFeatureBackend("competitions", {
        supabase: async () => {
          const { error } = await supabase.functions.invoke("send-eoi-invite", {
            body: { submission_id: submissionId },
          });
          if (error) throw error;
        },
        icp: async ctx => { await resendLiveEoiInvite(ctx, submissionId); },
      }, writeOnce({ eoiId: submissionId })),
    onSuccess: () => {
      toast.success(resolveAuthBackend() === "icp" ? "Invite email queued" : "Invite resent");
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
    mutationFn: async (submissionIds: string[]) =>
      withFeatureBackend("competitions", {
        supabase: async () => {
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
        icp: async ctx => {
          let ok = 0, fail = 0;
          for (const id of submissionIds) {
            try { await writeEoiInScope(ctx, id, scoped => resendLiveEoiInvite(scoped, id)); ok++; } catch { fail++; }
          }
          return { ok, fail };
        },
      }, { shared: "person" }),
    onSuccess: ({ ok, fail }) => {
      if (fail === 0) toast.success(`${resolveAuthBackend() === "icp" ? "Queued" : "Sent"} ${ok} reminder${ok === 1 ? "" : "s"}`);
      else toast.warning(`Sent ${ok}, failed ${fail}`);
      qc.invalidateQueries({ queryKey: ["eoi-submissions"] });
    },
    onError: () => toast.error("Could not send reminders"),
  });
}
