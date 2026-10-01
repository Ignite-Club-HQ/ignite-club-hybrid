/**
 * Cache layer for ICP Pro entitlements, split from identityEntitlements.ts
 * so callers can read/clear the cache without statically importing the ICP
 * agent/candid SDK. Mirrors identityProfileCache.ts's pattern.
 */

export interface IcpEntitlementSummary {
  isPro: boolean;
  productIds: string[];
  resolvedAtMs: number;
}

const CACHE_PREFIX = "ignite_icp_entitlements:";

function cacheKey(principal: string): string {
  return `${CACHE_PREFIX}${principal}`;
}

export function getCachedIcpEntitlements(principal: string): IcpEntitlementSummary | null {
  try {
    const raw = localStorage.getItem(cacheKey(principal));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IcpEntitlementSummary;
    if (typeof parsed?.isPro !== "boolean") return null;
    return parsed;
  } catch {
    localStorage.removeItem(cacheKey(principal));
    return null;
  }
}

export function cacheIcpEntitlements(principal: string, summary: IcpEntitlementSummary): void {
  try {
    localStorage.setItem(cacheKey(principal), JSON.stringify(summary));
  } catch {
    // Ignore storage failures — caching is best-effort.
  }
}

export function clearIcpEntitlementsCache(principal?: string): void {
  try {
    if (principal) {
      localStorage.removeItem(cacheKey(principal));
      return;
    }
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Ignore storage failures.
  }
}
