import type { Identity } from "@icp-sdk/core/agent";
import type { Profile as CanisterProfile, RoleGrant } from "../lab/bindings/identity_access/declarations/identity_access.did.js";
import { connectLiveIdentityAccessClientWithIdentity, isLiveIdentityAccessConfigured } from "./identityAccess";
import { getActiveIcpTarget, type IcpTargetConfig } from "./targetRegistry";

/**
 * Resolves the "current user" profile for an Internet Identity session from
 * the identity_access canister — the ICP-only replacement for the Supabase
 * `profiles` row. No Supabase access happens here: name, avatar reference and
 * role grants all come from the canister, keyed by the caller's principal.
 *
 * Results are cached in localStorage (per principal) so the auth provider can
 * render instantly on repeat visits and refresh in the background, mirroring
 * the Supabase auth provider's cached-profile behaviour.
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

function cacheProfile(principal: string, profile: IcpIdentityProfile): void {
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

/**
 * Fetches the caller's profile and role grants from the identity_access
 * canister. A missing profile (first sign-in after account provisioning) is
 * reported via `profileMissing`, not thrown — the UI routes to profile
 * completion. Canister/network failures DO throw so the caller can surface
 * them rather than silently rendering a fabricated identity.
 */
export async function fetchIcpIdentityProfile(
  identity: Identity,
  principal: string,
  target: IcpTargetConfig = getActiveIcpTarget(),
): Promise<IcpIdentityProfile> {
  if (!isLiveIdentityAccessConfigured(target)) {
    throw new Error(`Identity access canister is not configured for ICP target ${target.alias}.`);
  }
  const { client } = await connectLiveIdentityAccessClientWithIdentity(target, identity);
  try {
    const [profileResult, roles] = await Promise.allSettled([
      client.getProfile(),
      client.myRoles(),
    ]);
    if (roles.status === "rejected") throw roles.reason;
    let canisterProfile: CanisterProfile | null = null;
    if (profileResult.status === "fulfilled") {
      canisterProfile = profileResult.value;
    } else if (!/profile not set/i.test(String(profileResult.reason?.message ?? profileResult.reason))) {
      throw profileResult.reason;
    }
    const resolved: IcpIdentityProfile = {
      accountId: principal,
      displayName: canisterProfile?.display_name ?? null,
      avatarRef: canisterProfile?.avatar_ref?.[0] ?? null,
      roles: roles.value,
      profileMissing: !canisterProfile,
    };
    cacheProfile(principal, resolved);
    return resolved;
  } finally {
    client.dispose();
  }
}
