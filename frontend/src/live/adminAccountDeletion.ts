import type { Identity } from "@icp-sdk/core/agent";
import type { IcpTargetConfig } from "./targetRegistry";

/** Never erase the identity record while independent club authorization remains. */
export async function eraseIcpAccountAsAdmin(identity: Identity, target: IcpTargetConfig, accountId: string) {
  const [{ connectLiveClubDomain }, { connectLiveIdentityAccessClientWithIdentity }] = await Promise.all([
    import("./domains"), import("./identityAccess"),
  ]);
  const { client } = await connectLiveIdentityAccessClientWithIdentity(target, identity);
  try {
    const { actor } = await connectLiveClubDomain(target, identity);
    const result = await actor.erase_account_membership(accountId);
    if ("Err" in result) throw new Error(result.Err);
    await client.eraseAccount(accountId);
    return { success: true, immediate: true };
  } finally { client.dispose(); }
}