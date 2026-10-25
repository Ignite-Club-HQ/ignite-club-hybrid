import type { FeatureBackendContext, FeatureBackendProviders } from "./featureRouter";
import { withFeatureBackend } from "./featureRouter";
import { resolveAuthBackend } from "./authBackendMode";
import { readFreshPublicTargets } from "./publicGroupReads";
import { getActiveIcpTarget } from "./targetRegistry";

/** Public bearer previews are independent of sign-in and Supabase. */
export async function readInvitePreview<T>(token: string, providers: FeatureBackendProviders<T>): Promise<T | null> {
  if (resolveAuthBackend() !== "icp") return withFeatureBackend("membership", providers, { inviteToken: token });
  const { AnonymousIdentity } = await import("@icp-sdk/core/agent");
  const identity = new AnonymousIdentity();
  const targets = [...new Map((await readFreshPublicTargets(getActiveIcpTarget())).map(t => [t.canisterIds.club_domain, t])).values()];
  const rows = await Promise.all(targets.map(async target => {
    try { return await providers.icp({ identity, target } as FeatureBackendContext); }
    catch (error) {
      if (error instanceof Error && /failed: (Invite not found|Invite link not found|Join link not found)$/.test(error.message)) return null;
      throw error;
    }
  }));
  const found = rows.filter(r => r != null);
  if (found.length > 1) throw new Error("Invitation has multiple owners");
  return found[0] ?? null;
}