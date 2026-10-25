import { withFeatureBackend } from "@/live/featureRouter";

/**
 * Membership acceptance is exclusively on ICP. Email delivery is deferred
 * and must never make acceptance depend on an external application service.
 */
export async function acceptIcpInviteAndWelcome(inviteId: string): Promise<void> {
  await withFeatureBackend("membership", {
    supabase: async () => {},
    icp: async (ctx) => {
      const { acceptPendingLiveInvite } = await import("@/live/features/club");
      await acceptPendingLiveInvite(ctx, inviteId);
    },
  }, { inviteToken: inviteId });
}
