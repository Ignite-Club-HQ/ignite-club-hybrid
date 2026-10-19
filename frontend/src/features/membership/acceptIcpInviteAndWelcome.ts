import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";

/**
 * Accepts an ICP pending invite, then asks the server to send the team's
 * welcome email. The server re-verifies acceptance on the canister, so this
 * request carries only the invite id; a failed send never fails the accept.
 */
export async function acceptIcpInviteAndWelcome(inviteId: string): Promise<void> {
  await withFeatureBackend("membership", {
    supabase: async () => {},
    icp: async (ctx) => {
      const { acceptPendingLiveInvite } = await import("@/live/features/club");
      await acceptPendingLiveInvite(ctx, inviteId);
      try {
        const { error } = await supabase.functions.invoke("send-welcome-email-icp", { body: { inviteId } });
        if (error) console.error("[welcome-email] ICP delivery request failed", error);
      } catch (error) {
        console.error("[welcome-email] ICP delivery request failed", error);
      }
    },
  }, { inviteToken: inviteId });
}
