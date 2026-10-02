/**
 * ICP-side Pro gate for points awarding.
 *
 * On Supabase, points are gated on the club's subscription row
 * (club_subscriptions). On ICP there is no per-club subscription concept —
 * the caller's own identity_access entitlement is the Pro signal (the same
 * simplification as useClubProAccess). Fail-closed: any error or missing
 * identity returns false.
 *
 * identityEntitlements must never be statically imported (it pulls in the
 * ICP agent SDK), hence the dynamic imports.
 */
export async function icpCallerHasProEntitlement(): Promise<boolean> {
  try {
    const { getCurrentInternetIdentity } = await import("@/live/internetIdentityAuth");
    const identity = await getCurrentInternetIdentity();
    if (!identity) return false;
    const principal = identity.getPrincipal().toText();
    const { getCachedIcpIsPro, fetchIcpEntitlements } = await import("@/live/identityEntitlements");
    return (
      getCachedIcpIsPro(principal) ||
      (await fetchIcpEntitlements(identity, principal)).isPro
    );
  } catch {
    return false;
  }
}
