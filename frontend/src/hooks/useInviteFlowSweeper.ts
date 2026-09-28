import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  getInviteFlowContext,
  clearInviteFlowContext,
} from "@/components/InviteFlowProgress";

/**
 * Authoritative expiry for the invite-flow banner.
 *
 * The per-page clears only fire on the happy paths (join screen, auth screen,
 * complete-profile). When the invite is accepted server-side (auto-accept
 * triggers) or the user finishes on another device / kills the app mid-flow,
 * the stored context survived and "Create Account • 2 steps remaining" haunted
 * later sessions until the TTL elapsed.
 *
 * This sweeper runs app-wide: once the signed-in user has a completed profile
 * AND at least one membership row, the invite flow is definitively over, so the
 * context is dropped immediately rather than waiting for the TTL.
 */
export function useInviteFlowSweeper(
  userId: string | undefined,
  hasDisplayName: boolean,
) {
  const shouldCheck = !!userId && hasDisplayName && !!getInviteFlowContext();

  const { data: hasMembership } = useQuery({
    queryKey: ["invite-flow-sweep-membership", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", userId!)
        .limit(1);
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
    enabled: shouldCheck,
    staleTime: 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (!shouldCheck || !hasMembership) return;
    clearInviteFlowContext();
    try {
      localStorage.removeItem("pwa_pending_invite");
      sessionStorage.removeItem("autoJoinAfterAuth");
      sessionStorage.removeItem("inviteLabel");
    } catch {
      /* storage blocked */
    }
  }, [shouldCheck, hasMembership]);
}
