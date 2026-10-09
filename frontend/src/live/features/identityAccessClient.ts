import type { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "../featureRouter";
import { connectLiveIdentityAccessClientWithIdentity } from "../identityAccess";

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
): Promise<Array<{ id: string; display_name: string | null; avatar_url: string | null }>> {
  const { client } = await connectLiveIdentityAccessClientWithIdentity(ctx.target, ctx.identity);
  try {
    const rows = await client.searchProfiles(query, limit);
    return rows.map((row) => ({
      id: row.account_id,
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
): Promise<Array<{ accountId: string; principal: Principal; displayName: string | null }>> {
  const { client } = await connectLiveIdentityAccessClientWithIdentity(ctx.target, ctx.identity);
  try {
    const rows = await client.searchProfiles(query, limit);
    return rows.map((row) => ({
      accountId: row.account_id,
      principal: row.principal,
      displayName: row.display_name,
    }));
  } finally {
    client.dispose();
  }
}
