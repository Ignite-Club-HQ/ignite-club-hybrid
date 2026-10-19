import type { Identity } from "@icp-sdk/core/agent";
import type { IcpTargetConfig } from "./targetRegistry";

/** Never erase the identity record while independent club authorization remains. */
export async function eraseIcpAccountAsAdmin(identity: Identity, target: IcpTargetConfig, accountId: string) {
  const [{ connectLiveClubDomain }, { connectLiveIdentityAccessClientWithIdentity }, { openAccountDeletionInventory }] = await Promise.all([
    import("./domains"), import("./identityAccess"), import('./accountDeletionInventory'),
  ]);
  const { client } = await connectLiveIdentityAccessClientWithIdentity(target, identity);
  let inventory: Awaited<ReturnType<typeof openAccountDeletionInventory>> | undefined;
  try {
    inventory = await openAccountDeletionInventory(target, identity, ['club_domain']);
    for (const authority of inventory.targetsFor('club_domain')) {
      await inventory.validate();
      const { actor } = await connectLiveClubDomain(authority, identity);
      await inventory.validate();
      const result = await actor.erase_account_membership(accountId);
      if ("Err" in result) throw new Error(result.Err);
      await inventory.validate();
    }
    await inventory.validate();
    await client.eraseAccount(accountId);
    return { success: true, immediate: true };
  } finally { inventory?.dispose(); client.dispose(); }
}