import type { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "../featureRouter";
import { connectLiveIdentityAccessClientWithIdentity } from "../identityAccess";
import { privateProfileSearchRehearsalEnabled } from "../privateProfileSearchMode";

/**
 * Identity feature ("membership") -> identity_access canister: batch
 * profile lookup by account id, the ICP-mode counterpart of the Supabase
 * `profiles WHERE id = ANY(ids)` fanout used by the shared profile cache
 * (see src/lib/profileCache.ts / src/hooks/useProfiles.ts). Unlike most
 * identity_access methods this one is a plain query returning `vec Profile`
 * (no `Result` wrapper), so there is nothing to unwrap — unknown ids are
 * simply absent from the result, mirroring the Rust canister's own
 * "skip unknown ids" contract.
 */
/**
 * Mirror of identity_access `account_id(principal)`: the first 16 bytes of
 * SHA-256(principal bytes) formatted as a UUID. Canister records (media
 * owners, reactions, comment authors…) store principals, but profiles are
 * keyed by account id — so a principal must be translated before lookup.
 */
export async function accountIdForPrincipal(principalText: string): Promise<string | null> {
  try {
    const { Principal } = await import("@icp-sdk/core/principal");
    const bytes = Principal.fromText(principalText).toUint8Array();
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
    const hex = Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Accepts account ids and/or principal texts. Principals are translated to
 * their account id for the lookup, and each returned profile's account_id is
 * rewritten back to the id the caller asked for, so callers can keep keying
 * maps by whatever id they hold.
 */
export async function listLiveProfilesByIds(
  ctx: FeatureBackendContext,
  ids: readonly string[],
  privateOptions?: { audience?: import('../privateProfileAudience').PrivateProfileAudience; resolveAuthority?: import('../privateProfileAuthority').PrivateProfileAuthorityResolver; signal?: AbortSignal; hydratePrivateNames?: boolean; clubId?: string },
) {
  if (ids.length === 0) return [];
  const requestedByAccount = new Map<string, string[]>();
  await Promise.all(
    Array.from(new Set(ids)).map(async (id) => {
      // club_domain keys accounts without a linked identity_access row as
      // "principal:<text>" — resolve those through the principal too.
      const principalText = id.startsWith("principal:") ? id.slice("principal:".length) : id;
      const accountId = UUID_RE.test(id) ? id : (await accountIdForPrincipal(principalText)) ?? id;
      requestedByAccount.set(accountId, [...(requestedByAccount.get(accountId) ?? []), id]);
      // Keep the raw id too (legacy rows keyed by principal text).
      if (accountId !== id) requestedByAccount.set(id, [...(requestedByAccount.get(id) ?? []), id]);
      if (principalText !== id && principalText !== accountId) requestedByAccount.set(principalText, [...(requestedByAccount.get(principalText) ?? []), id]);
    }),
  );
  const { client } = await connectLiveIdentityAccessClientWithIdentity(ctx.target, ctx.identity);
  try {
    const profiles = await client.getProfilesByIds(Array.from(requestedByAccount.keys()));
    const seen = new Set<string>();
    const out: typeof profiles = [];
    for (const profile of profiles) {
      for (const requested of requestedByAccount.get(profile.account_id) ?? [profile.account_id]) {
        if (seen.has(requested)) continue;
        seen.add(requested);
        out.push({ ...profile, account_id: requested });
      }
    }
    // Linked/moved accounts may retain a UUID derived from an older principal.
    // The caller's own profile resolves that account through the canister's
    // identity mapping rather than assuming its UUID can still be derived.
    const caller = ctx.identity.getPrincipal().toText();
    const ownIds = [...new Set(ids)].filter((id) =>
      (id === caller || id === `principal:${caller}`) && !seen.has(id),
    );
    if (ownIds.length) {
      try {
        const ownProfile = await client.getProfile();
        for (const id of ownIds) out.push({ ...ownProfile, account_id: id });
      } catch {
        // A new account may not have completed its profile yet.
      }
    }
    if (out.some(profile => profile.display_name?.startsWith("pii-display-name:"))) {
      // The caller's own name is already unlocked this session; show it
      // everywhere instead of "Unknown".
      const { fillOwnPrivateName } = await import("../ownPrivateName");
      const filled = fillOwnPrivateName(out, caller);
      if (privateOptions?.clubId && !privateOptions.audience) {
        // Other people's protected names unlock through the shared club.
        const pending = filled.filter(p => p.display_name?.startsWith('pii-display-name:')).map(p => p.account_id);
        const { unlockClubScopedNames } = await import("../clubScopedNames");
        const names = pending.length ? await unlockClubScopedNames(ctx, privateOptions.clubId, pending, privateOptions.signal).catch(() => new Map<string, string>()) : new Map<string, string>();
        return filled.map(profile => profile.display_name?.startsWith('pii-display-name:')
          ? { ...profile, display_name: names.get(profile.account_id) ?? null }
          : profile);
      }
      if (privateOptions?.hydratePrivateNames === false) {
        return filled.map(profile => ({ ...profile, display_name: profile.display_name?.startsWith('pii-display-name:') ? null : profile.display_name }));
      }
      const { hydratePrivateProfileNames } = await import("../privateProfileNames");
      const refIds = new Set(filled.filter(p => p.display_name?.startsWith('pii-display-name:')).map(p => p.account_id));
      const hydrated = await (privateOptions ? hydratePrivateProfileNames(ctx, filled, privateOptions) : hydratePrivateProfileNames(ctx, filled));
      if (privateOptions?.audience) return hydrated;
      // Cross-club screens: unlock remaining names through the caller's own clubs.
      const unnamed = hydrated.filter(p => refIds.has(p.account_id) && (!p.display_name || p.display_name.startsWith('pii-display-name:'))).map(p => p.account_id);
      if (!unnamed.length) return hydrated;
      const { unlockNamesThroughMyClubs } = await import("../clubScopedNames");
      const names = await unlockNamesThroughMyClubs(ctx, unnamed, privateOptions?.signal).catch(() => new Map<string, string>());
      return hydrated.map(p => refIds.has(p.account_id) && (!p.display_name || p.display_name.startsWith('pii-display-name:'))
        ? { ...p, display_name: names.get(p.account_id) ?? null }
        : p);
    }
    return out;
  } finally {
    client.dispose();
  }
}

/**
 * Case-insensitive substring search over display names — the ICP-mode
 * counterpart of the Supabase `search_invitable_profiles` RPC. Used by the
 * invite-other-parent sheet so Internet Identity members never touch the
 * Supabase RPC. Returns rows in the Supabase shape callers already consume.
 */
export async function searchLiveProfiles(
  ctx: FeatureBackendContext,
  query: string,
  limit: number,
  scope?: { clubId: string; signal?: AbortSignal; privateAuthorityBinding?: import('../accountAuthorityRegistry').AccountRegistryBinding },
): Promise<Array<{ id: string; display_name: string | null; avatar_url: string | null }>> {
  const { searchLiveInvitableProfiles } = await import("./membership");
  const rows = await searchLiveInvitableProfiles(ctx, query, limit, scope);
  return rows.map(row => ({ id: row.account_id, display_name: row.display_name, avatar_url: row.avatar_ref }));
}

/** Full-directory lookup exclusively for linking another guardian. The
 * canister validates this group's authority and the caller's exact child
 * relationship; no client boolean or cached guardian list grants access. */
export async function searchLiveGuardianProfiles(
  ctx: FeatureBackendContext,
  childId: string,
  query: string,
  limit: number,
  signal?: AbortSignal,
  privateAuthorityBinding?: import("../accountAuthorityRegistry").AccountRegistryBinding,
): Promise<Array<{ id: string; display_name: string | null; avatar_url: string | null }>> {
  if (!childId.trim()) throw new Error("A specific child is required for guardian search.");
  if (query.trim().length < 2) return [];
  if (privateProfileSearchRehearsalEnabled()) {
    const { searchEncryptedGuardianProfiles } = await import("../guardianProfileSearch");
    const { readPrivateProfileEvidence } = await import('../privateProfileEvidence');
    const evidence = await readPrivateProfileEvidence(ctx, privateAuthorityBinding);
    if (evidence) {
      const { createLivePrivateProfileAuthorityResolver } = await import("../privateProfileAuthority");
      return searchEncryptedGuardianProfiles(ctx, childId, query, limit, { signal, resolveAuthority: createLivePrivateProfileAuthorityResolver(ctx, evidence) });
    }
    return searchEncryptedGuardianProfiles(ctx, childId, query, limit, { signal });
  }
  const authorityId = ctx.target.canisterIds.club_domain;
  if (!authorityId) throw new Error("The child's club connection is not configured.");
  const { Principal } = await import("@icp-sdk/core/principal");
  const authority = Principal.fromText(authorityId);
  const { client } = await connectLiveIdentityAccessClientWithIdentity(ctx.target, ctx.identity);
  try {
    if (signal?.aborted) throw new Error("Guardian search cancelled.");
    const rows = await client.searchGuardianProfiles(authority, childId, query.trim(), Math.min(25, Math.max(1, limit)));
    if (signal?.aborted) throw new Error("Guardian search cancelled.");
    return rows.map((row) => ({
      id: row.principal.toText(),
      display_name: row.display_name,
      avatar_url: row.avatar_ref[0] ?? null,
    }));
  } finally {
    client.dispose();
  }
}

/**
 * Same search as `searchLiveProfiles` but keeps the principal — needed by
 * admin tools that key restrictions/roles on principals rather than account
 * ids (e.g. the DM attachment restrictions page).
 */
export async function searchLiveProfilesWithPrincipals(
  ctx: FeatureBackendContext,
  query: string,
  limit: number,
): Promise<Array<{ accountId: string; principal: Principal; displayName: string | null; avatarUrl: string | null }>> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 25 || query.trim().length > 80) throw new Error("Invalid administrative search.");
  if (query.trim().length < 2) return [];
  // App-wide management is distinct from ordinary full person search. The
  // existing directory verifies governor/app-admin authority inside the service.
  const { readAdminUserDirectory } = await import("../adminUserDirectory");
  const results: Array<{ accountId: string; principal: Principal; displayName: string | null; avatarUrl: string | null }> = [];
  let cursor: string | null = null;
  const needle = query.trim().toLocaleLowerCase();
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const page = await readAdminUserDirectory(ctx, privateProfileSearchRehearsalEnabled() ? "" : query, cursor);
    const profiles = page.items.flatMap(item => item.profile[0] ? [{ ...item.profile[0], principal: item.principals[0] }] : []);
    const { hydratePrivateProfileNames } = await import("../privateProfileNames");
    const hydrated = await hydratePrivateProfileNames(ctx, profiles);
    for (const row of hydrated) {
      if (!row.principal || !row.display_name?.toLocaleLowerCase().includes(needle)) continue;
      results.push({ accountId: row.account_id, principal: row.principal, displayName: row.display_name, avatarUrl: row.avatar_ref[0] ?? null });
      if (results.length === limit) return results;
    }
    const next = page.next[0];
    if (!next) return results;
    if (cursor && next <= cursor) throw new Error("Administrative search continuation changed.");
    cursor = next;
  }
  throw new Error("Administrative search exceeded its page budget.");
}
