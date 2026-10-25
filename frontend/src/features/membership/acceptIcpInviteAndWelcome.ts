import { withFeatureBackend } from "@/live/featureRouter";

/**
 * Membership acceptance is exclusively on ICP. Email delivery is deferred
 * and must never make acceptance depend on an external application service.
 */
export async function acceptIcpInviteAndWelcome(inviteId: string) {
  return withFeatureBackend("membership", {
    supabase: async () => { throw new Error("Internet Identity required"); },
    icp: async (ctx) => {
      const { acceptPendingLiveInvite, readLiveFamilyInviteReceipt } = await import("@/live/features/club");
      await acceptPendingLiveInvite(ctx, inviteId);
      const receipt = await readLiveFamilyInviteReceipt(ctx, inviteId);
      const { addLiveGuardianRelationship, grantLivePiiRead } = await import("@/live/features/vault");
      for (const id of receipt.child_ids) {
        try {
          await addLiveGuardianRelationship(ctx, ctx.identity.getPrincipal(), id);
          for (const field of ["name", "year_of_birth", "jersey_number"]) {
            try { await grantLivePiiRead(ctx, id, field, ctx.identity.getPrincipal()); }
            catch (error) { if (field === "name") throw error; }
          }
        } catch (error) {
          console.warn("Accepted invitation; encrypted child-name access needs retry", error);
        }
      }
      return receipt;
    },
  }, { inviteToken: inviteId });
}
