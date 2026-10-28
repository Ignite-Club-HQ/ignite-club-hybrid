import type { Identity } from "@icp-sdk/core/agent";
import type { Profile as CanisterProfile } from "../lab/bindings/identity_access/declarations/identity_access.did.js";
import { connectLiveIdentityAccessClientWithIdentity, isLiveIdentityAccessConfigured } from "./identityAccess";
import { getActiveIcpTarget, type IcpTargetConfig } from "./targetRegistry";
import { cacheIcpIdentityProfile, getCachedIcpIdentityProfile, type IcpIdentityProfile } from "./identityProfileCache";
import { privateProfileSearchRehearsalEnabled } from './privateProfileSearchMode';
import { isLoopbackRehearsalHost } from './accountReadAdapter.mjs';
import { capturePrivateProfileSession } from './privateProfileSession';

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
): Promise<IcpIdentityProfile & { privateNameMaintained?: true }> {
  if (!isLiveIdentityAccessConfigured(target)) {
    throw new Error(`Identity access canister is not configured for ICP target ${target.alias}.`);
  }
  const { client } = await connectLiveIdentityAccessClientWithIdentity(target, identity);
  try {
    let nameToSave = input.displayName;
    let privateNameMaintained = false;
    const sessionActive = capturePrivateProfileSession();
    const savedTarget = JSON.stringify(target);
    const caller = identity.getPrincipal().toText();
    if (principal !== caller) throw Error('Profile save account does not match the signed-in identity.');
    const active = () => {
      sessionActive();
      if (identity.getPrincipal().toText() !== caller || JSON.stringify(target) !== savedTarget) throw Error('Profile save identity or target changed.');
    };
    // Production requires the authenticated canister capability. Missing or
    // unreleased capabilities fail closed, never restore plaintext saving.
    if (!privateProfileSearchRehearsalEnabled()) {
      active();
      const authority = (await client.readSecureNameAuthority()).toText();
      active();
      if (authority !== target.canisterIds.pii_access_control) throw Error('The original secure name authority is not configured in this app; no name was changed.');
      const { preparePrivateOwnProfileName } = await import('./privateProfileNames');
      nameToSave = await preparePrivateOwnProfileName({ identity, target }, input.displayName);
      active();
      const { refreshPrivateOwnClubNames } = await import('./privateProfileNames');
      const { privateClubNameDisplaysEnabled } = await import('./privateClubNameDisplayMode');
      if (privateClubNameDisplaysEnabled()) await refreshPrivateOwnClubNames({ identity, target }, input.displayName, async () => {
        const { getLiveMyRoleGrants } = await import('./features/membership');
        const grants = await getLiveMyRoleGrants({ identity, target });
        active();
        return grants.flatMap(grant => grant.club ?? []);
      }, active);
      active();
      privateNameMaintained = true;
    } else {
      if (!isLoopbackRehearsalHost(target.host)) throw Error('Private profile save requires a loopback rehearsal target.');
      active();
      const current = await client.getProfile();
      active();
      if (current?.display_name?.startsWith('pii-display-name:')) {
        const { preparePrivateOwnProfileName, refreshPrivateOwnClubNames, privateProfileNameReference, hydratePrivateProfileNames } = await import('./privateProfileNames');
        const parts = current.display_name.split(':');
        const originalAuthority = parts.length === 4 ? parts[2] : '';
        const expected = privateProfileNameReference(originalAuthority, caller);
        if (current.display_name !== expected) throw Error('Original private name authority must be verified before saving.');
        let context = { identity, target };
        let confirm = async () => { active(); };
        if (originalAuthority !== target.canisterIds.pii_access_control) {
          const [{ readPrivateProfileEvidence }, { createLivePrivateProfileAuthorityResolver }] = await Promise.all([
            import('./privateProfileEvidence'), import('./privateProfileAuthority'),
          ]);
          const evidence = await readPrivateProfileEvidence(context);
          active();
          if (!evidence) throw Error('Verified original private name authority evidence is required.');
          const lease = await createLivePrivateProfileAuthorityResolver(context, evidence)(originalAuthority);
          active();
          context = lease.context;
          if (context.identity !== identity || context.target.host !== target.host || context.target.canisterIds.pii_access_control !== originalAuthority) throw Error('Original private name route changed.');
          confirm = async () => { active(); await lease.confirm(); active(); };
        }
        const [previousName] = await hydratePrivateProfileNames(context, [current]);
        active();
        await confirm();
        if (!previousName?.display_name) throw Error('Original private name could not be verified.');
        if (previousName.display_name !== input.displayName.trim()) {
          nameToSave = await preparePrivateOwnProfileName(context, input.displayName);
          active();
          await confirm();
          await refreshPrivateOwnClubNames(context, input.displayName, async () => {
            const { getLiveMyRoleGrants } = await import('./features/membership');
            const grants = await getLiveMyRoleGrants(context);
            active();
            return grants.flatMap(grant => grant.club ?? []);
          }, active);
          active();
        } else nameToSave = expected;
        await confirm();
        privateNameMaintained = true;
      }
    }
    const canisterProfile = await client.setProfile(nameToSave, input.avatarRef ?? undefined);
    active();
    if (privateNameMaintained && canisterProfile?.display_name !== nameToSave) throw Error('Secure profile publication was not confirmed; check before retrying.');
    const previous = getCachedIcpIdentityProfile(principal);
    const resolved: IcpIdentityProfile = {
      accountId: principal,
      displayName: privateNameMaintained ? input.displayName.trim() : canisterProfile?.display_name ?? input.displayName,
      avatarRef: canisterProfile?.avatar_ref?.[0] ?? input.avatarRef ?? null,
      roles: previous?.roles ?? [],
      profileMissing: false,
    };
    // Cache the unlocked own name on this device (per account, wiped on
    // sign-out) so returning to the app shows the name immediately instead
    // of a placeholder while the guarded unlock replays in the background.
    cacheIcpIdentityProfile(principal, resolved);
    if (privateNameMaintained) (await import('./ownPrivateName')).rememberOwnPrivateName(caller, input.displayName);
    return privateNameMaintained ? { ...resolved, privateNameMaintained: true } : resolved;
  } finally {
    client.dispose();
  }
}

export async function fetchIcpIdentityProfile(
  identity: Identity,
  principal: string,
  target: IcpTargetConfig = getActiveIcpTarget(),
): Promise<IcpIdentityProfile> {
  if (identity.getPrincipal().toText() !== principal) throw new Error('Profile read account does not match the signed-in identity.');
  if (!isLiveIdentityAccessConfigured(target)) {
    throw new Error(`Identity access canister is not configured for ICP target ${target.alias}.`);
  }
  // Sign-in speed: when this device already knows the account's saved
  // private-name reference (a pointer, not the name), start the required
  // guarded name read alongside the profile read instead of after it. The
  // result is used only if the profile confirms the exact same reference.
  const refHintKey = `${PRIVATE_NAME_REF_HINT_PREFIX}${target.host}|${principal}`;
  let hintedRef: string | null = null;
  try { hintedRef = localStorage.getItem(refHintKey); } catch { /* ignore */ }
  const namesModule = hintedRef?.startsWith("pii-display-name:") ? import("./privateProfileNames") : null;
  const speculative = namesModule
    ? namesModule.then(({ readPrivateOwnProfileName }) => readPrivateOwnProfileName({ identity, target }, hintedRef as string))
    : null;
  speculative?.catch(() => {});
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
    let displayName: string | null = canisterProfile?.display_name ?? null;
    const savedRef = canisterProfile?.display_name?.startsWith("pii-display-name:") ? canisterProfile.display_name : null;
    try {
      if (savedRef) localStorage.setItem(refHintKey, savedRef);
      else localStorage.removeItem(refHintKey);
    } catch { /* ignore */ }
    if (savedRef) {
      const { readPrivateOwnProfileName } = await (namesModule ?? import("./privateProfileNames"));
      displayName = speculative && hintedRef === savedRef
        ? await speculative
        : await readPrivateOwnProfileName({ identity, target }, savedRef);
    }
    const resolved: IcpIdentityProfile = {
      accountId: principal,
      displayName,
      avatarRef: canisterProfile?.avatar_ref?.[0] ?? null,
      roles: roles.value,
      profileMissing: !canisterProfile,
    };
    // Cache the unlocked own name on this device (per account, wiped on
    // sign-out) so returning to the app shows the name immediately.
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

/** Device hint holding the account's saved private-name REFERENCE (never the
 * name), so the next sign-in can start the name read in parallel. Kept across
 * sign-out like the retained own-name key; it opens nothing by itself. */
const PRIVATE_NAME_REF_HINT_PREFIX = "ignite_icp_private_name_ref:";
