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
export async function listLiveProfilesByIds(
  ctx: FeatureBackendContext,
  ids: readonly string[],
) {
  if (ids.length === 0) return [];
  const { client } = await connectLiveIdentityAccessClientWithIdentity(ctx.target, ctx.identity);
  try {
    return await client.getProfilesByIds(Array.from(ids));
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
