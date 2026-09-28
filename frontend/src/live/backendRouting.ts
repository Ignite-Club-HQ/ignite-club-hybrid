import { isValidCountryCode } from "@/lib/countries";

/**
 * App-admin backend routing configuration: a global default backend
 * (Supabase or ICP) plus per-country eligibility rules.
 *
 * Stored in the `backend_routing_config` row of `public.app_settings` and
 * managed from /admin/icp-canisters. Enforcement is feature routing only:
 * the resolver decides which backend should serve data for a user, it never
 * blocks sign-in or app access.
 *
 * Like `icpAdminOverrides.ts`, this module is deliberately free of Supabase
 * imports so it can sit on the live-config import path without a module
 * cycle. Fetching/persisting lives in `loadBackendRouting.ts` and the admin
 * page; country detection lives in `userCountry.ts`.
 */

export const BACKEND_ROUTING_CONFIG_KEY = "backend_routing_config";

export type BackendProvider = "supabase" | "icp";
export type BackendEligibility = "supabase" | "icp" | "both";

export type BackendRoutingConfig = {
  defaultBackend: BackendProvider;
  /** ISO 3166-1 alpha-2 code -> which backend(s) that country may use. */
  countryRules: Record<string, BackendEligibility>;
};

export const DEFAULT_BACKEND_ROUTING_CONFIG: BackendRoutingConfig = {
  defaultBackend: "supabase",
  countryRules: {},
};

const ELIGIBILITIES: BackendEligibility[] = ["supabase", "icp", "both"];

/**
 * Parses the `value` jsonb of the `backend_routing_config` app_settings row.
 * Returns null when the row holds no usable config. Throws on malformed
 * content so callers can surface the problem instead of silently ignoring it.
 */
export function parseBackendRoutingConfig(value: unknown): BackendRoutingConfig | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${BACKEND_ROUTING_CONFIG_KEY} must be a JSON object.`);
  }
  const record = value as Record<string, unknown>;

  const rawDefault = record.defaultBackend;
  if (rawDefault !== "supabase" && rawDefault !== "icp") {
    throw new Error(`${BACKEND_ROUTING_CONFIG_KEY}.defaultBackend must be "supabase" or "icp".`);
  }

  const countryRules: Record<string, BackendEligibility> = {};
  const rawRules = record.countryRules;
  if (rawRules !== null && rawRules !== undefined) {
    if (typeof rawRules !== "object" || Array.isArray(rawRules)) {
      throw new Error(`${BACKEND_ROUTING_CONFIG_KEY}.countryRules must be a JSON object.`);
    }
    for (const [code, eligibility] of Object.entries(rawRules as Record<string, unknown>)) {
      const normalized = code.trim().toUpperCase();
      if (!isValidCountryCode(normalized)) {
        throw new Error(`"${code}" is not a valid ISO country code.`);
      }
      if (!ELIGIBILITIES.includes(eligibility as BackendEligibility)) {
        throw new Error(`Eligibility for ${normalized} must be "supabase", "icp" or "both".`);
      }
      countryRules[normalized] = eligibility as BackendEligibility;
    }
  }

  return { defaultBackend: rawDefault, countryRules };
}

let activeConfig: BackendRoutingConfig | null = null;

export function applyBackendRoutingConfig(config: BackendRoutingConfig | null): void {
  activeConfig = config
    ? { defaultBackend: config.defaultBackend, countryRules: { ...config.countryRules } }
    : null;
}

export function getBackendRoutingConfig(): BackendRoutingConfig {
  return activeConfig
    ? { defaultBackend: activeConfig.defaultBackend, countryRules: { ...activeConfig.countryRules } }
    : { ...DEFAULT_BACKEND_ROUTING_CONFIG, countryRules: {} };
}

/**
 * Pure resolver: which backend should serve a user in `country` (ISO alpha-2,
 * or null when unknown).
 *
 * - A country restricted to one backend always gets that backend.
 * - A country eligible for both (or with no rule) gets the global default.
 * - Safety net: ICP is only ever returned when `icpAvailable` is true, so a
 *   global "icp" default cannot break the app before canisters are deployed.
 */
export function resolveBackendForCountry(
  config: BackendRoutingConfig,
  country: string | null,
  icpAvailable: boolean,
): BackendProvider {
  const rule = country ? config.countryRules[country.trim().toUpperCase()] : undefined;
  const eligibility: BackendEligibility = rule ?? "both";
  if (eligibility === "supabase") return "supabase";
  if (eligibility === "icp") return icpAvailable ? "icp" : "supabase";
  if (config.defaultBackend === "icp" && !icpAvailable) return "supabase";
  return config.defaultBackend;
}
