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
 *
 * The ICP agent + candid bindings are imported lazily so this module can sit
 * on the boot path (loadBackendRouting) without pulling the ICP SDK into the
 * entry chunk — until canister IDs are configured the call below returns
 * null from the target check without ever loading the SDK.
 */
export async function readLiveAppConfig(key: string): Promise<string | null> {
  try {
    const target = getActiveIcpTarget();
    const [{ AnonymousIdentity }, { connectLiveClubDomain }] = await Promise.all([
      import("@icp-sdk/core/agent"),
      import("./domains"),
    ]);
    const { actor } = await connectLiveClubDomain(target, new AnonymousIdentity());
    const value = await actor.get_app_config(key);
    return value.length ? value[0] : null;
  } catch {
    return null;
  }
}

/** app_config key holding the GIPHY API key used by the chat GIF picker.
 * GIPHY keys are client-side keys by design (GIPHY's own SDKs ship them in
 * apps), so replica visibility in canister state is acceptable — the key
 * ends up in the browser either way (user decision 2026-10-05, reversing
 * the earlier keep-it-server-side call). */
export const GIPHY_API_KEY_CONFIG_KEY = "giphy_api_key";

/** app_config / app_settings values may be JSON-encoded (setLiveAppSetting
 * stringifies) or plain text (jsonb mirror). Decode either shape. */
export function decodeStoredConfigText(raw: string | null): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const text = typeof parsed === "string" ? parsed : parsed == null ? "" : String(parsed);
    return text.trim() || null;
  } catch {
    return trimmed;
  }
}
