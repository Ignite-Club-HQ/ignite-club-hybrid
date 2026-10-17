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
 * erasure. Shared club records and children remain; vault/events/messaging
 * content is not purged, and the returned note discloses that limitation.
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
    // Revoke the independent club authorization source before erasing the
    // identity profile. Partial failure is surfaced and safe to retry.
    const { connectLiveClubDomain } = await import("./domains");
    const { actor } = await connectLiveClubDomain(target, identity);
    const revoked = await actor.erase_my_membership();
    if ("Err" in revoked) throw new Error(revoked.Err);
    await client.eraseAccount(account.id);
    return {
      note:
        "Your identity_access account has been erased and club/team role access revoked. " +
        "Shared club records and parent-owned children are retained. Vault, events and messaging records are not yet covered by an automated " +
        "per-user purge and may require a manual request to your club.",
    };
  } finally {
    client.dispose();
  }
}
