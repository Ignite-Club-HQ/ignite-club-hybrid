import type { RoleGrant } from "../lab/bindings/identity_access/declarations/identity_access.did.js";

/**
 * Cache layer for the ICP identity profile, split from identityProfile.ts so
 * auth code can read/write the cache without statically importing the ICP
 * agent/candid SDK (which must stay out of every page's initial chunk).
 */

export interface IcpIdentityProfile {
  accountId: string;
  displayName: string | null;
  avatarRef: string | null;
  roles: RoleGrant[];
  /** True when the canister has no profile yet — the user must complete one. */
  profileMissing: boolean;
}

const CACHE_PREFIX = "ignite_icp_identity_profile:";

function cacheKey(principal: string): string {
  return `${CACHE_PREFIX}${principal}`;
}

export function getCachedIcpIdentityProfile(principal: string): IcpIdentityProfile | null {
  try {
    const raw = localStorage.getItem(cacheKey(principal));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IcpIdentityProfile;
    if (typeof parsed?.accountId !== "string") return null;
    return parsed;
  } catch {
    localStorage.removeItem(cacheKey(principal));
    return null;
  }
}

export function cacheIcpIdentityProfile(principal: string, profile: IcpIdentityProfile): void {
  try {
    localStorage.setItem(cacheKey(principal), JSON.stringify(profile));
  } catch {
    // Ignore storage failures — caching is best-effort.
  }
}

export function clearIcpIdentityProfileCache(principal?: string): void {
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
