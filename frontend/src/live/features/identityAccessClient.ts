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
