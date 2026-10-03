import { AnonymousIdentity } from "@icp-sdk/core/agent";
import { connectLiveClubDomain } from "./domains";
import { getActiveIcpTarget } from "./targetRegistry";

/**
 * Pre-auth global config read from club_domain.get_app_config — the canister
 * counterpart of the public.app_settings key/value rows that must be
 * fetchable before sign-in (e.g. the backend routing config) so an ICP-only
 * deployment can boot without Supabase. Reads are anonymous by design (the
 * canister method is a public query); values are non-secret by contract.
 *
 * Returns null when no ICP target / club_domain canister is configured, when
 * the key is unset, or on any fetch error — callers always have a further
 * fallback (localStorage cache, then the built-in default), so this never
 * blocks boot.
 */
export async function readLiveAppConfig(key: string): Promise<string | null> {
  try {
    const target = getActiveIcpTarget();
    const { actor } = await connectLiveClubDomain(target, new AnonymousIdentity());
    const value = await actor.get_app_config(key);
    return value.length ? value[0] : null;
  } catch {
    return null;
  }
}
