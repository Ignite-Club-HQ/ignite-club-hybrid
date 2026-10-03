import type { Principal } from "@icp-sdk/core/principal";
import type { IcpTargetConfig } from "./targetRegistry";

/**
 * Runtime ICP canister overrides configured by an app admin.
 *
 * The build-time target registry (`targetRegistry.ts`) reads canister IDs from
 * `IGNITE_LIVE_ICP_CANISTER_IDS_JSON`. App admins can additionally manage
 * canister IDs at runtime from /admin/icp-canisters; those values are stored in
 * the `icp_canister_config` row of `public.app_settings` and applied here.
 *
 * This module is deliberately free of Supabase imports: `targetRegistry.ts`
 * imports it, and the Supabase live client imports `targetRegistry.ts`, so a
 * Supabase import here would create a module cycle. Fetching/persisting the
 * settings row lives in `loadIcpAdminOverrides.ts` and the admin page.
 */

export const ICP_CANISTER_CONFIG_KEY = "icp_canister_config";

export type IcpAdminOverrides = {
  canisterIds: Record<string, string>;
  /** IC WebSocket gateway URL for chat realtime; empty/absent keeps polling. */
  wsGatewayUrl?: string;
};

export async function validateCanisterId(domainKey: string, canisterId: string): Promise<string> {
  const trimmed = canisterId.trim();
  // Lazy @icp-sdk/core/principal import: this module is entry-reachable via
  // targetRegistry.ts, and the entry-chunk rule forbids static @icp-sdk/* pulls.
  const { Principal } = await import("@icp-sdk/core/principal");
  let principal: Principal;
  try {
    principal = Principal.fromText(trimmed);
  } catch {
    throw new Error(`"${trimmed}" is not a valid canister ID for ${domainKey}.`);
  }
  if (principal.isAnonymous() || principal.toText() === "aaaaa-aa") {
    throw new Error(`Canister ID for ${domainKey} is a reserved principal, not a deployed canister.`);
  }
  return principal.toText();
}

/**
 * Parses the `value` jsonb of the `icp_canister_config` app_settings row.
 * Returns null when the row holds no usable overrides. Throws on malformed
 * content so callers can surface the problem instead of silently ignoring it.
 */
export async function parseIcpAdminOverrides(value: unknown): Promise<IcpAdminOverrides | null> {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${ICP_CANISTER_CONFIG_KEY} must be a JSON object.`);
  }
  const rawGateway = (value as Record<string, unknown>).wsGatewayUrl;
  let wsGatewayUrl: string | undefined;
  if (rawGateway !== null && rawGateway !== undefined) {
    if (typeof rawGateway !== "string") {
      throw new Error(`${ICP_CANISTER_CONFIG_KEY}.wsGatewayUrl must be a string.`);
    }
    wsGatewayUrl = rawGateway.trim() === "" ? undefined : rawGateway.trim();
  }
  const raw = (value as Record<string, unknown>).canisterIds;
  if (raw === null || raw === undefined) {
    return wsGatewayUrl ? { canisterIds: {}, wsGatewayUrl } : null;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${ICP_CANISTER_CONFIG_KEY}.canisterIds must be a JSON object.`);
  }
  const canisterIds: Record<string, string> = {};
  for (const [key, id] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id !== "string") {
      throw new Error(`Canister ID for ${key} must be a string.`);
    }
    if (id.trim() === "") continue;
    canisterIds[key.trim()] = await validateCanisterId(key, id);
  }
  if (Object.keys(canisterIds).length === 0 && !wsGatewayUrl) return null;
  return wsGatewayUrl ? { canisterIds, wsGatewayUrl } : { canisterIds };
}

let activeOverrides: IcpAdminOverrides | null = null;

export function applyIcpAdminOverrides(overrides: IcpAdminOverrides | null): void {
  activeOverrides = overrides
    ? { canisterIds: { ...overrides.canisterIds }, ...(overrides.wsGatewayUrl ? { wsGatewayUrl: overrides.wsGatewayUrl } : {}) }
    : null;
}

export function getIcpAdminOverrides(): IcpAdminOverrides | null {
  return activeOverrides
    ? { canisterIds: { ...activeOverrides.canisterIds }, ...(activeOverrides.wsGatewayUrl ? { wsGatewayUrl: activeOverrides.wsGatewayUrl } : {}) }
    : null;
}

/**
 * Admin-configured canister IDs win over the build-time env values key-by-key;
 * env entries the admin has not overridden stay in effect.
 */
export function mergeIcpTargetWithAdminOverrides(target: IcpTargetConfig): IcpTargetConfig {
  const overrides = activeOverrides;
  if (!overrides) return target;
  return {
    ...target,
    canisterIds: { ...target.canisterIds, ...overrides.canisterIds },
    ...(overrides.wsGatewayUrl ? { wsGatewayUrl: overrides.wsGatewayUrl } : {}),
  };
}
