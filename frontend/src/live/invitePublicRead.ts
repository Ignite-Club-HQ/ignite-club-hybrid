import type { IcpTargetConfig } from "./targetRegistry";
import type { FeatureBackendContext } from "./featureRouter";
import { readFreshPublicTargets } from "./publicGroupReads";

/** Bearer location only. Every source must respond; ambiguity never authorizes acceptance. */
export async function resolvePublicInviteCode(base: IcpTargetConfig, code: string): Promise<string | null> {
  const [{ AnonymousIdentity }, { resolveLiveInviteShortCode }] = await Promise.all([
    import("@icp-sdk/core/agent"), import("./features/club"),
  ]);
  const identity = new AnonymousIdentity();
  const targets = [...new Map((await readFreshPublicTargets(base)).map(t => [t.canisterIds.club_domain, t])).values()];
  const rows = await Promise.all(targets.map(async target => {
    try { return await resolveLiveInviteShortCode({ target, identity } as FeatureBackendContext, code); }
    catch (error) {
      if (error instanceof Error && /failed: Short code not found$/.test(error.message)) return null;
      throw error;
    }
  }));
  const found = rows.filter((r): r is string => !!r);
  if (found.length > 1) throw new Error("Invite code has multiple owners");
  return found[0] ?? null;
}