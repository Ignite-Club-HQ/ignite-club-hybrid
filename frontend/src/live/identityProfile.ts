import type { Identity } from "@icp-sdk/core/agent";
import type { Profile as CanisterProfile } from "../lab/bindings/identity_access/declarations/identity_access.did.js";
import { connectLiveIdentityAccessClientWithIdentity, isLiveIdentityAccessConfigured } from "./identityAccess";
import { getActiveIcpTarget, type IcpTargetConfig } from "./targetRegistry";
import { cacheIcpIdentityProfile, type IcpIdentityProfile } from "./identityProfileCache";

/**
 * Resolves the "current user" profile for an Internet Identity session from
 * the identity_access canister — the ICP-only replacement for the Supabase
 * `profiles` row. No Supabase access happens here: name, avatar reference and
 * role grants all come from the canister, keyed by the caller's principal.
 *
 * Results are cached via identityProfileCache so the auth provider can render
 * instantly on repeat visits and refresh in the background, mirroring the
 * Supabase auth provider's cached-profile behaviour. This module pulls in the
 * ICP agent SDK — import it dynamically, never statically.
 */

export type { IcpIdentityProfile } from "./identityProfileCache";

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
    cacheIcpIdentityProfile(principal, resolved);
    return resolved;
  } finally {
    client.dispose();
  }
}
