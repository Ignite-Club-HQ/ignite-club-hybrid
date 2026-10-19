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
    if (inventory.revision !== undefined) await client.prepareAccountDeletion(accountId, inventory.revision);
    for (const authority of inventory.targetsFor('club_domain')) {
      await inventory.validate();
      const { actor } = await connectLiveClubDomain(authority, identity);
      await inventory.validate();
      const result = await actor.erase_account_membership(accountId);
      if ("Err" in result) throw new Error(result.Err);
      await inventory.validate();
    }
    await inventory.validate();
    if (inventory.revision !== undefined) {
      await client.commitAccountDeletion(accountId);
      await client.settleAccountDeletion(accountId);
    } else await client.eraseAccount(accountId);
    return { success: true, immediate: true };
  } finally { inventory?.dispose(); client.dispose(); }
}

/** Recovery for an interrupted pre-commit deletion: releases the router reservation and
 *  drops the ticket, leaving the account untouched. Refuses once the commit has erased the
 *  account (use the settle path instead) and is safe to retry after a lost reply. */
export async function cancelIcpAccountDeletion(identity: Identity, target: IcpTargetConfig, accountId: string) {
  const { connectLiveIdentityAccessClientWithIdentity } = await import("./identityAccess");
  const { client } = await connectLiveIdentityAccessClientWithIdentity(target, identity);
  try {
    await client.cancelAccountDeletion(accountId);
    return { success: true };
  } finally { client.dispose(); }
}