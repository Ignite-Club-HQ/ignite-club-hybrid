import type { Identity } from "@icp-sdk/core/agent";
import { connectLiveIdentityAccessClientWithIdentity, isLiveIdentityAccessConfigured } from "./identityAccess";
import { getActiveIcpTarget, type IcpTargetConfig } from "./targetRegistry";

/**
 * Caller-scoped "export my data" for Internet Identity accounts — the ICP
 * counterpart of the Supabase `export-user-data` edge function. Gathers
 * every caller-scoped identity_access record (profile, role grants, terms
 * acceptance, entitlements) into a plain JSON object for download. Other
 * domains (club/vault/events/messaging) do not expose a caller-scoped
 * "export everything I own" query yet — out of scope for this pass; noted
 * in the export payload's `note` field so the download is never silently
 * incomplete without saying so.
 */
export async function exportMyIcpAccountData(
  identity: Identity,
  target: IcpTargetConfig = getActiveIcpTarget(),
): Promise<Record<string, unknown>> {
  if (!isLiveIdentityAccessConfigured(target)) {
    throw new Error(`Identity access canister is not configured for ICP target ${target.alias}.`);
  }
  const { client } = await connectLiveIdentityAccessClientWithIdentity(target, identity);
  try {
    const [account, profile, roles, terms, entitlements] = await Promise.all([
      client.whoami(),
      client.getProfile().catch(() => null),
      client.myRoles(),
      client.myTermsAcceptance(),
      client.getMyEntitlements(),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      backend: "icp",
      account: {
        id: account.id,
        principals: account.principals.map((p) => p.toText()),
        version: account.version.toString(),
      },
      profile: profile
        ? { displayName: profile.display_name, avatarRef: profile.avatar_ref[0] ?? null }
        : null,
      roles: roles.map((r) => ({
        role: r.role,
        clubId: r.club[0] ?? null,
        teamId: r.team[0] ?? null,
        siteId: r.site_id[0] ?? null,
      })),
      termsAcceptance: terms.length
        ? { termsVersion: terms[0].terms_version, acceptedAtMs: terms[0].accepted_at_ms.toString() }
        : null,
      entitlements: entitlements.map((e) => ({
        productId: e.product_id,
        transactionId: e.transaction_id,
        expiresAtMs: e.expires_at_ms.toString(),
        source: e.source,
      })),
      note:
        "This export covers identity_access (profile, roles, terms acceptance, entitlements). " +
        "Club, vault, events and messaging data are not yet exposed through a caller-scoped export " +
        "query on their canisters and are not included.",
    };
  } finally {
    client.dispose();
  }
}

/**
 * Caller-scoped, irreversible account erasure for Internet Identity accounts
 * — calls identity_access.erase_account(account_id) for the caller's own
 * account (the canister enforces the caller must own the account or be the
 * governor; it refuses to erase the governor's own account). This removes
 * the account, profile, role grants, family links, exclusions, external
 * bindings, privacy consents and terms acceptance on identity_access.
 *
 * club_domain revokes all linked principals' role access before identity
 * erasure. The caller's own vault files, chat messages and event records
 * are then purged on their domains (purge_my_data); shared club records and
 * parent-owned children remain. A domain that fails is disclosed in the
 * returned note and is safe to retry.
 */
export async function eraseMyIcpAccount(
  identity: Identity,
  target: IcpTargetConfig = getActiveIcpTarget(),
): Promise<{ note: string }> {
  if (!isLiveIdentityAccessConfigured(target)) {
    throw new Error(`Identity access canister is not configured for ICP target ${target.alias}.`);
  }
  const { client } = await connectLiveIdentityAccessClientWithIdentity(target, identity);
  let inventory: Awaited<ReturnType<typeof import('./accountDeletionInventory').openAccountDeletionInventory>> | undefined;
  try {
    const account = await client.whoami();
    const [{ openAccountDeletionInventory }, domains] = await Promise.all([
      import('./accountDeletionInventory'), import('./domains'),
    ]);
    inventory = await openAccountDeletionInventory(target, identity,
      ['club_domain', 'vault_domain', 'events_domain', 'messaging_domain']);
    if (inventory.revision !== undefined) await client.prepareAccountDeletion(account.id, inventory.revision);
    // Revoke the independent club authorization source before erasing the
    // identity profile. Partial failure is surfaced and safe to retry.
    for (const t of inventory.targetsFor('club_domain')) {
      await inventory.validate();
      const { actor } = await domains.connectLiveClubDomain(t, identity);
      await inventory.validate();
      const revoked = await actor.erase_my_membership();
      if ("Err" in revoked) throw new Error(revoked.Err);
      await inventory.validate();
    }
    // Purge the caller's own content on each domain before erasing the
    // identity. Failures are collected and disclosed, never silently dropped.
    const purgeFailures: string[] = [];
    for (const [label, connect, domain] of [
      ["vault", "connectLiveVaultDomain", "vault_domain"],
      ["events", "connectLiveEventsDomain", "events_domain"],
      ["messaging", "connectLiveMessagingDomain", "messaging_domain"],
    ] as const) {
      for (const t of inventory.targetsFor(domain)) {
      await inventory.validate();
      try {
        const domainActor = (await domains[connect](t, identity)).actor as { purge_my_data: () => Promise<{ Ok?: unknown; Err?: string }> };
        await inventory.validate();
        const purged = await domainActor.purge_my_data();
        if ("Err" in purged) throw new Error(purged.Err);
      } catch (error) {
        console.error(`[account-erase] ${label} purge failed`, error);
        if (!purgeFailures.includes(label)) purgeFailures.push(label);
      }
      // Registry failure must propagate, never become a tolerated purge failure.
      await inventory.validate();
      }
    }
    await inventory.validate();
    if (inventory.revision !== undefined) {
      await client.commitAccountDeletion(account.id);
      await client.settleAccountDeletion(account.id);
    } else await client.eraseAccount(account.id);
    return {
      note:
        "Your identity_access account has been erased and club/team role access revoked. " +
        (purgeFailures.length === 0 ? "Your vault files, chat messages and event records have been permanently removed. " : "Some personal content could not be removed. ") +
        "Shared club records and parent-owned children are retained." +
        (purgeFailures.length > 0
          ? ` The ${purgeFailures.join(", ")} purge could not be completed — please contact support to finish removing that content.`
          : ""),
    };
  } finally {
    inventory?.dispose();
    client.dispose();
  }
}
