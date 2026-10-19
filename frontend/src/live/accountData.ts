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
  try {
    const account = await client.whoami();
    const [{ activationStatus, SHIPPED_GATES }, domains] = await Promise.all([
      import('./groupActivation'), import('./domains'),
    ]);
    // Capture the complete authoritative registry BEFORE removing membership.
    // Registry failure prevents any erasure; browser-supplied group IDs and
    // linked-principal lists are never accepted here.
    let targets: IcpTargetConfig[] = [target];
    if (activationStatus(SHIPPED_GATES).active) {
      const { openLiveGroupReadSession } = await import('./groupSessionLive');
      const session = await openLiveGroupReadSession({ target, identity });
      try {
        targets = [target, ...await session.readEveryGroup('club_domain', async ctx => [ctx.target], 64)];
      } finally { session.dispose(); }
    }
    const uniqueTargets = (domain: 'club_domain' | 'vault_domain' | 'events_domain' | 'messaging_domain') => {
      const seen = new Set<string>();
      return targets.filter(t => {
        const id = t.canisterIds?.[domain];
        if (!id) throw new Error(`Account erasure requires ${domain} for every registered group`);
        const key = JSON.stringify([t.host, t.networkKind, id]);
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
    };
    // Validate every required participant before the first destructive call.
    const revokeTargets = activationStatus(SHIPPED_GATES).active ? uniqueTargets('club_domain') : targets;
    const purgeTargets = new Map((['vault_domain', 'events_domain', 'messaging_domain'] as const).map(domain =>
      [domain, activationStatus(SHIPPED_GATES).active ? uniqueTargets(domain) : targets]));
    // Revoke the independent club authorization source before erasing the
    // identity profile. Partial failure is surfaced and safe to retry.
    for (const t of revokeTargets) {
      const { actor } = await domains.connectLiveClubDomain(t, identity);
      const revoked = await actor.erase_my_membership();
      if ("Err" in revoked) throw new Error(revoked.Err);
    }
    // Purge the caller's own content on each domain before erasing the
    // identity. Failures are collected and disclosed, never silently dropped.
    const purgeFailures: string[] = [];
    for (const [label, connect, domain] of [
      ["vault", "connectLiveVaultDomain", "vault_domain"],
      ["events", "connectLiveEventsDomain", "events_domain"],
      ["messaging", "connectLiveMessagingDomain", "messaging_domain"],
    ] as const) {
      for (const t of purgeTargets.get(domain) ?? []) {
      try {
        const domainActor = (await domains[connect](t, identity)).actor as { purge_my_data: () => Promise<{ Ok?: unknown; Err?: string }> };
        const purged = await domainActor.purge_my_data();
        if ("Err" in purged) throw new Error(purged.Err);
      } catch (error) {
        console.error(`[account-erase] ${label} purge failed`, error);
        if (!purgeFailures.includes(label)) purgeFailures.push(label);
      }
      }
    }
    await client.eraseAccount(account.id);
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
    client.dispose();
  }
}
