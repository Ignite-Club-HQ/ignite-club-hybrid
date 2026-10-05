import { mergeIcpTargetWithAdminOverrides } from "./icpAdminOverrides";
import { DEPLOYED_MAINNET_CANISTER_IDS } from "./generated/deployedCanisterIds";

type BackendProvider = "supabase" | "icp";

export type SupabaseTargetConfig = {
  provider: "supabase";
  alias: string;
  url: string;
  anonKey: string;
  region?: string;
  status?: "active" | "read_only" | "disabled";
};

export type IcpTargetConfig = {
  provider: "icp";
  alias: string;
  networkKind: "public_mainnet" | "cloud_engine";
  host: string;
  canisterIds: Record<string, string>;
  /** IC WebSocket gateway URL for chat realtime (e.g. wss://ws.example.com). */
  wsGatewayUrl?: string;
  supportedDomains?: string[];
  residencyProfile?: string;
  deploymentClass: "public_subnet" | "cloud_engine";
  status?: "active" | "read_only" | "disabled";
};

export type LiveBackendTargetRegistry = {
  activeSupabaseAlias: string;
  activeIcpAlias: string;
  supabaseTargets: SupabaseTargetConfig[];
  icpTargets: IcpTargetConfig[];
};

const DEFAULT_SUPABASE_ALIAS = "dev";
const DEFAULT_ICP_ALIAS = "icp-public-mainnet";
// https://icp-api.io is the dedicated IC API boundary-node endpoint. It is the
// correct default for a frontend that is NOT itself served from an IC asset
// canister (ic0.app/icp0.io/icp.net page origin) — see the icp-cli/internet-identity
// skill guidance fetched 2025 for this project. Do not default to icp0.io: that
// domain is an HTTP asset gateway, not guaranteed to proxy /api/v2 for an
// off-chain-hosted frontend.
const DEFAULT_ICP_HOST = "https://icp-api.io";

function requireEnv(name: string): string {
  const value = import.meta.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required for the live backend target registry.`);
  }
  return value.trim();
}

function optionalEnv(name: string): string | undefined {
  const value = import.meta.env[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function parseJsonArray<T>(name: string): T[] | undefined {
  const raw = optionalEnv(name);
  if (!raw) return undefined;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${name} must contain a JSON array.`);
  }
  return parsed as T[];
}

function isAllowedHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    return parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function decodeJwtPayload(value: string): Record<string, unknown> | undefined {
  const [, payload] = value.split(".");
  if (!payload) return undefined;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function validateAlias(alias: string, provider: BackendProvider): string {
  const trimmed = alias.trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,62}$/i.test(trimmed)) {
    throw new Error(`${provider} target alias must be 2-63 URL-safe characters.`);
  }
  return trimmed;
}

function validateSupabaseTarget(target: SupabaseTargetConfig): SupabaseTargetConfig {
  const alias = validateAlias(target.alias, "supabase");
  if (!isAllowedHttpUrl(target.url)) {
    throw new Error(`Supabase target ${alias} must use HTTPS, except localhost development URLs.`);
  }
  const payload = decodeJwtPayload(target.anonKey);
  if (payload?.role === "service_role") {
    throw new Error(`Supabase target ${alias} must not use a service-role key in the browser.`);
  }
  if (target.status === "disabled") {
    throw new Error(`Supabase target ${alias} is disabled.`);
  }
  return { ...target, alias };
}

function validateIcpTarget(target: IcpTargetConfig): IcpTargetConfig {
  const alias = validateAlias(target.alias, "icp");
  if (!isAllowedHttpUrl(target.host)) {
    throw new Error(`ICP target ${alias} must use HTTPS, except localhost development gateways.`);
  }
  if (target.networkKind === "cloud_engine" && target.deploymentClass !== "cloud_engine") {
    throw new Error(`ICP Cloud Engine target ${alias} must use deploymentClass=cloud_engine.`);
  }
  if (target.networkKind === "public_mainnet" && target.deploymentClass !== "public_subnet") {
    throw new Error(`ICP public mainnet target ${alias} must use deploymentClass=public_subnet.`);
  }
  if (target.status === "disabled") {
    throw new Error(`ICP target ${alias} is disabled.`);
  }
  if (target.wsGatewayUrl !== undefined && !isAllowedWsUrl(target.wsGatewayUrl)) {
    throw new Error(`ICP target ${alias} WebSocket gateway must use WSS, except localhost development URLs.`);
  }
  return { ...target, alias };
}

function isAllowedWsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "wss:") return true;
    return parsed.protocol === "ws:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function defaultSupabaseTargets(): SupabaseTargetConfig[] {
  return [
    {
      provider: "supabase",
      alias: optionalEnv("IGNITE_LIVE_SUPABASE_ALIAS") ?? DEFAULT_SUPABASE_ALIAS,
      url: requireEnv("IGNITE_LIVE_SUPABASE_URL"),
      anonKey: requireEnv("IGNITE_LIVE_SUPABASE_ANON_KEY"),
      region: optionalEnv("IGNITE_LIVE_SUPABASE_REGION"),
      status: "active",
    },
  ];
}

function defaultIcpTargets(): IcpTargetConfig[] {
  const canisterIds = optionalEnv("IGNITE_LIVE_ICP_CANISTER_IDS_JSON");
  return [
    {
      provider: "icp",
      alias: optionalEnv("IGNITE_LIVE_ICP_ALIAS") ?? DEFAULT_ICP_ALIAS,
      networkKind: optionalEnv("IGNITE_LIVE_ICP_NETWORK_KIND") === "cloud_engine" ? "cloud_engine" : "public_mainnet",
      host: optionalEnv("IGNITE_LIVE_ICP_HOST") ?? DEFAULT_ICP_HOST,
      // Env JSON wins; otherwise fall back to the deployed mainnet ID table
      // synced from deploy/mainnet/.icp/data/mappings/ic.ids.json at build time.
      canisterIds: canisterIds ? JSON.parse(canisterIds) as Record<string, string> : { ...DEPLOYED_MAINNET_CANISTER_IDS },
      wsGatewayUrl: optionalEnv("IGNITE_LIVE_ICP_WS_GATEWAY_URL"),
      supportedDomains: optionalEnv("IGNITE_LIVE_ICP_SUPPORTED_DOMAINS")?.split(",").map(item => item.trim()).filter(Boolean),
      residencyProfile: optionalEnv("IGNITE_LIVE_ICP_RESIDENCY_PROFILE"),
      deploymentClass: optionalEnv("IGNITE_LIVE_ICP_NETWORK_KIND") === "cloud_engine" ? "cloud_engine" : "public_subnet",
      status: "active",
    },
  ];
}

export function getLiveBackendTargetRegistry(): LiveBackendTargetRegistry {
  const supabaseTargets = (parseJsonArray<SupabaseTargetConfig>("IGNITE_LIVE_SUPABASE_TARGETS_JSON") ?? defaultSupabaseTargets())
    .map(validateSupabaseTarget);
  const icpTargets = (parseJsonArray<IcpTargetConfig>("IGNITE_LIVE_ICP_TARGETS_JSON") ?? defaultIcpTargets())
    .map(validateIcpTarget);
  const activeSupabaseAlias = validateAlias(optionalEnv("IGNITE_LIVE_ACTIVE_SUPABASE_ALIAS") ?? supabaseTargets[0]?.alias ?? "", "supabase");
  const activeIcpAlias = validateAlias(optionalEnv("IGNITE_LIVE_ACTIVE_ICP_ALIAS") ?? icpTargets[0]?.alias ?? "", "icp");

  if (!supabaseTargets.some(target => target.alias === activeSupabaseAlias)) {
    throw new Error(`Active Supabase target ${activeSupabaseAlias} is not in the approved target registry.`);
  }
  if (!icpTargets.some(target => target.alias === activeIcpAlias)) {
    throw new Error(`Active ICP target ${activeIcpAlias} is not in the approved target registry.`);
  }

  return {
    activeSupabaseAlias,
    activeIcpAlias,
    supabaseTargets,
    icpTargets,
  };
}

export function getActiveSupabaseTarget(): SupabaseTargetConfig {
  const registry = getLiveBackendTargetRegistry();
  return registry.supabaseTargets.find(target => target.alias === registry.activeSupabaseAlias)!;
}

/** Cloud Engine assignment for the current user, as resolved by the routing layer. */
export type IcpEngineAssignment = {
  alias: string;
  host?: string;
  canisterIds?: Record<string, string>;
  region?: string;
  usable: boolean;
};

let icpEngineResolver: (() => IcpEngineAssignment | null) | null = null;

/**
 * Registered by loadBackendRouting.ts (which may import Supabase; this module
 * must not — see icpAdminOverrides.ts). Returns the user's country-assigned
 * Cloud Engine, or null for public mainnet.
 */
export function registerIcpEngineResolver(resolver: (() => IcpEngineAssignment | null) | null): void {
  icpEngineResolver = resolver;
}

export function getActiveIcpTarget(): IcpTargetConfig {
  let engine: IcpEngineAssignment | null = null;
  try {
    engine = icpEngineResolver?.() ?? null;
  } catch {
    engine = null;
  }
  if (engine) {
    // Never fall back to mainnet for an engine-assigned country: an unusable
    // engine yields no canister IDs, so ICP reports unavailable -> Supabase.
    return {
      provider: "icp",
      alias: `engine:${engine.alias}`,
      networkKind: "cloud_engine",
      host: engine.usable && engine.host ? engine.host : DEFAULT_ICP_HOST,
      canisterIds: engine.usable ? { ...(engine.canisterIds ?? {}) } : {},
      residencyProfile: engine.region,
      deploymentClass: "cloud_engine",
      status: engine.usable ? "active" : "disabled",
    };
  }
  const registry = getLiveBackendTargetRegistry();
  const target = registry.icpTargets.find(candidate => candidate.alias === registry.activeIcpAlias)!;
  // App-admin canister overrides (stored in the `icp_canister_config` app_settings
  // row) take precedence over the build-time env values; re-validate the merged
  // target so a bad stored value can never produce an unapproved target.
  return validateIcpTarget(mergeIcpTargetWithAdminOverrides(target));
}
