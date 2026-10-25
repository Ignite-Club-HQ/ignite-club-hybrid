import { withFeatureBackend } from "@/live/featureRouter";

/** Consent belongs to the caller's shared identity, never a club mirror. */
export async function icpInvitePhotoConsent(granted?: boolean): Promise<boolean> {
  return withFeatureBackend("membership", {
    supabase: async () => { throw new Error("Internet Identity required"); },
    icp: async ctx => {
      const { connectLiveIdentityAccessClientWithIdentity } = await import("@/live/identityAccess");
      const { client } = await connectLiveIdentityAccessClientWithIdentity(ctx.target, ctx.identity);
      try {
        const account = await client.whoami();
        if (granted !== undefined) {
          await client.setPrivacyConsent(account.id, "photo", granted);
          return granted;
        }
        return await client.getPrivacyConsent(account.id, "photo");
      } finally { client.dispose(); }
    },
  }, { shared: "person" });
}