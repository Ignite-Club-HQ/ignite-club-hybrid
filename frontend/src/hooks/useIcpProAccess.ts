import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { getCachedIcpEntitlements, type IcpEntitlementSummary } from "@/live/identityEntitlementsCache";

/**
 * Shared ICP Pro-entitlement reader for the pro-access hooks
 * (useClubProAccess / useScheduleProAccess / useUserHasAnyClubPro /
 * proShareGate). Internet Identity users have no Supabase session, so the
 * Supabase-table-based checks those hooks use can't run for them; this reads
 * the real entitlement set from the identity_access canister instead.
 *
 * SIMPLIFICATION: the identity_access canister has no club→product mapping
 * (unlike Supabase's per-club `club_subscriptions` rows), so this treats
 * "has any active entitlement" as Pro and "any entitlement whose product id
 * contains `_pf_`" (the Pro Football SKU family, see IAP_PRODUCT_IDS) as Pro
 * Football, rather than resolving per-club. Revisit once ICP club-scoped
 * products exist.
 */
export function useIcpEntitlements(options?: { enabled?: boolean }) {
  const { user } = useAuth();
  const isIcp = resolveAuthBackend() === "icp";
  const principal = isIcp ? user?.id ?? null : null;
  const enabled = (options?.enabled ?? true) && isIcp && !!principal;

  const query = useQuery({
    queryKey: ["icp-entitlements", principal],
    enabled,
    staleTime: 60_000,
    initialData: () => (principal ? getCachedIcpEntitlements(principal) ?? undefined : undefined),
    queryFn: async (): Promise<IcpEntitlementSummary> => {
      const [{ getCurrentInternetIdentity }, { fetchIcpEntitlements }] = await Promise.all([
        import("@/live/internetIdentityAuth"),
        import("@/live/identityEntitlements"),
      ]);
      const identity = await getCurrentInternetIdentity();
      if (!identity) throw new Error("No Internet Identity session available.");
      return fetchIcpEntitlements(identity, principal!);
    },
  });

  const productIds = query.data?.productIds ?? [];
  const hasProFootball = productIds.some((id) => id.includes("_pf_"));

  return {
    isPro: query.data?.isPro ?? false,
    hasProFootball,
    productIds,
    // Unknown (not yet fetched) while enabled and no data has landed yet.
    isLoading: enabled && query.isLoading && !query.data,
    isError: query.isError,
  };
}
