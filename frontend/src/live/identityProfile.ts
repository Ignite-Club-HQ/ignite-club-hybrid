import type { Identity } from "@icp-sdk/core/agent";
import type { Profile as CanisterProfile } from "../lab/bindings/identity_access/declarations/identity_access.did.js";
import { connectLiveIdentityAccessClientWithIdentity, isLiveIdentityAccessConfigured } from "./identityAccess";
import { getActiveIcpTarget, type IcpTargetConfig } from "./targetRegistry";
import { cacheIcpIdentityProfile, getCachedIcpIdentityProfile, type IcpIdentityProfile } from "./identityProfileCache";

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
export interface SaveIcpIdentityProfileInput {
  displayName: string;
  avatarRef?: string | null;
}

/**
 * Saves display name / avatar to the identity_access canister via
 * `set_profile`, then updates the local identity profile cache (preserving
 * previously known role grants) so the UI reflects the change immediately.
 */
export async function saveIcpIdentityProfile(
  identity: Identity,
  principal: string,
  input: SaveIcpIdentityProfileInput,
  target: IcpTargetConfig = getActiveIcpTarget(),
): Promise<IcpIdentityProfile> {
  if (!isLiveIdentityAccessConfigured(target)) {
    throw new Error(`Identity access canister is not configured for ICP target ${target.alias}.`);
  }
  const { client } = await connectLiveIdentityAccessClientWithIdentity(target, identity);
  try {
    const canisterProfile = await client.setProfile(input.displayName, input.avatarRef ?? undefined);
    const previous = getCachedIcpIdentityProfile(principal);
    const resolved: IcpIdentityProfile = {
      accountId: principal,
      displayName: canisterProfile?.display_name ?? input.displayName,
      avatarRef: canisterProfile?.avatar_ref?.[0] ?? input.avatarRef ?? null,
      roles: previous?.roles ?? [],
      profileMissing: false,
    };
    cacheIcpIdentityProfile(principal, resolved);
    return resolved;
  } finally {
    client.dispose();
  }
}

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

/**
 * Persists the caller's theme preference ("light" | "dark") on the
 * identity_access canister so it follows the Internet Identity account
 * across devices, mirroring the Supabase `profiles.theme_preference` column.
 */
export async function setIcpThemePreference(
  identity: Identity,
  theme: "light" | "dark" | null,
  target: IcpTargetConfig = getActiveIcpTarget(),
): Promise<void> {
  if (!isLiveIdentityAccessConfigured(target)) return;
  const { client } = await connectLiveIdentityAccessClientWithIdentity(target, identity);
  try {
    await client.setThemePreference(theme);
  } finally {
    client.dispose();
  }
}

/** Reads the caller's canister-stored theme preference, if any. */
export async function getIcpThemePreference(
  identity: Identity,
  target: IcpTargetConfig = getActiveIcpTarget(),
): Promise<"light" | "dark" | null> {
  if (!isLiveIdentityAccessConfigured(target)) return null;
  const { client } = await connectLiveIdentityAccessClientWithIdentity(target, identity);
  try {
    const profile = await client.getProfile();
    const raw = profile?.theme_preference?.[0];
    return raw === "dark" || raw === "light" ? raw : null;
  } catch {
    return null;
  } finally {
    client.dispose();
  }
}

/** Marks the club-switcher coach-mark seen on the identity_access canister. */
export async function setIcpClubSwitcherHintSeen(
  identity: Identity,
  target: IcpTargetConfig = getActiveIcpTarget(),
): Promise<void> {
  if (!isLiveIdentityAccessConfigured(target)) return;
  const { client } = await connectLiveIdentityAccessClientWithIdentity(target, identity);
  try {
    await client.setClubSwitcherHintSeen();
  } finally {
    client.dispose();
  }
}

/** Reads whether the club-switcher coach-mark has already been dismissed. */
export async function getIcpClubSwitcherHintSeen(
  identity: Identity,
  target: IcpTargetConfig = getActiveIcpTarget(),
): Promise<boolean> {
  if (!isLiveIdentityAccessConfigured(target)) return true; // fail closed — never nag on an unknown state
  const { client } = await connectLiveIdentityAccessClientWithIdentity(target, identity);
  try {
    const profile = await client.getProfile();
    return (profile?.club_switcher_hint_seen_at?.length ?? 0) > 0;
  } catch {
    return true;
  } finally {
    client.dispose();
  }
}
