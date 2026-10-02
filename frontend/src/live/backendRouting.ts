import { isValidCountryCode } from "@/lib/countries";

/**
 * App-admin backend routing configuration: a global default backend
 * (Supabase or ICP), per-country eligibility rules, and the approved
 * deployment targets each backend may use.
 *
 * Stored in the `backend_routing_config` row of `public.app_settings` and
 * managed from /admin/placement-settings. Enforcement is feature routing
 * only: the resolver decides which backend (and which approved target)
 * should serve data for a user, it never blocks sign-in or app access.
 *
 * Like `icpAdminOverrides.ts`, this module is deliberately free of Supabase
 * imports so it can sit on the live-config import path without a module
 * cycle. Fetching/persisting lives in `loadBackendRouting.ts` and the admin
 * page; country detection lives in `userCountry.ts`.
 */

export const BACKEND_ROUTING_CONFIG_KEY = "backend_routing_config";

export type BackendProvider = "supabase" | "icp";
export type BackendEligibility = "supabase" | "icp" | "both";
export type BackendTargetKind = "supabase-region" | "icp-cloud-engine" | "icp-mainnet";

/**
 * An approved deployment target for a backend: which region/cloud-engine
 * and which version is sanctioned to serve data. A target only takes effect
 * while `enabled` is true.
 */
export type ApprovedBackendTarget = {
  /** Stable identifier: `${backend}/${alias}/${version}`. */
  id: string;
  backend: BackendProvider;
  kind: BackendTargetKind;
  alias: string;
  version: string;
  region?: string;
  enabled: boolean;
};

export type BackendRoutingConfig = {
  defaultBackend: BackendProvider;
  /** ISO 3166-1 alpha-2 code -> which backend(s) that country may use. */
  countryRules: Record<string, BackendEligibility>;
  /** Approved deployment targets per backend. */
  targets: ApprovedBackendTarget[];
  /** ISO alpha-2 code -> approved target id pinned for that country. */
  countryTargets: Record<string, string>;
  /**
   * Club id -> backend pinned for every member of that club. A pin wins over
   * the country rules for that member's whole app (features AND the sign-in
   * screen); used to test ICP with one club at a time.
   */
  clubBackendOverrides: Record<string, BackendProvider>;
};

export const DEFAULT_BACKEND_ROUTING_CONFIG: BackendRoutingConfig = {
  defaultBackend: "supabase",
  countryRules: {},
  targets: [],
  countryTargets: {},
  clubBackendOverrides: {},
};

const ELIGIBILITIES: BackendEligibility[] = ["supabase", "icp", "both"];
const TARGET_KINDS: BackendTargetKind[] = ["supabase-region", "icp-cloud-engine", "icp-mainnet"];

export function targetId(backend: BackendProvider, alias: string, version: string): string {
  return `${backend}/${alias}/${version}`;
}

/** Validates one approved target, mirroring the lab placement rules. */
export function validateApprovedTarget(target: Omit<ApprovedBackendTarget, "id">): void {
  if (target.backend === "supabase" && target.kind !== "supabase-region") {
    throw new Error("Supabase targets must use the Supabase region target type.");
  }
  if (target.backend === "icp" && target.kind === "supabase-region") {
    throw new Error("ICP targets must use an ICP target type (cloud engine or mainnet).");
  }
  const alias = target.alias.trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,62}$/i.test(alias)) {
    throw new Error(`Target alias "${alias || "(empty)"}" must be 2-63 URL-safe characters.`);
  }
  if (alias.includes("://") || /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(alias)) {
    throw new Error(`Target alias "${alias}" must not contain URLs or credential-shaped values.`);
  }
  const version = target.version.trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,31}$/i.test(version)) {
    throw new Error(`Target version for "${alias}" must be 1-32 URL-safe characters.`);
  }
}

export function normalizeApprovedTarget(
  raw: Omit<ApprovedBackendTarget, "id"> & { id?: string },
): ApprovedBackendTarget {
  const target = {
    backend: raw.backend,
    kind: raw.kind,
    alias: raw.alias.trim(),
    version: raw.version.trim(),
    region: raw.region?.trim() || undefined,
    enabled: raw.enabled,
  };
  validateApprovedTarget(target);
  return { id: targetId(target.backend, target.alias, target.version), ...target };
}

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

  const targets: ApprovedBackendTarget[] = [];
  const rawTargets = record.targets;
  if (rawTargets !== null && rawTargets !== undefined) {
    if (!Array.isArray(rawTargets)) {
      throw new Error(`${BACKEND_ROUTING_CONFIG_KEY}.targets must be an array.`);
    }
    for (const raw of rawTargets) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error(`${BACKEND_ROUTING_CONFIG_KEY}.targets entries must be objects.`);
      }
      const entry = raw as Record<string, unknown>;
      if (entry.backend !== "supabase" && entry.backend !== "icp") {
        throw new Error('Target backend must be "supabase" or "icp".');
      }
      if (!TARGET_KINDS.includes(entry.kind as BackendTargetKind)) {
        throw new Error(`Target kind must be one of: ${TARGET_KINDS.join(", ")}.`);
      }
      if (typeof entry.alias !== "string" || typeof entry.version !== "string") {
        throw new Error("Target alias and version are required.");
      }
      if (typeof entry.enabled !== "boolean") {
        throw new Error("Target enabled must be true or false.");
      }
      targets.push(
        normalizeApprovedTarget({
          backend: entry.backend,
          kind: entry.kind as BackendTargetKind,
          alias: entry.alias,
          version: entry.version,
          region: typeof entry.region === "string" ? entry.region : undefined,
          enabled: entry.enabled,
        }),
      );
    }
  }

  const countryTargets: Record<string, string> = {};
  const rawCountryTargets = record.countryTargets;
  if (rawCountryTargets !== null && rawCountryTargets !== undefined) {
    if (typeof rawCountryTargets !== "object" || Array.isArray(rawCountryTargets)) {
      throw new Error(`${BACKEND_ROUTING_CONFIG_KEY}.countryTargets must be a JSON object.`);
    }
    for (const [code, id] of Object.entries(rawCountryTargets as Record<string, unknown>)) {
      const normalized = code.trim().toUpperCase();
      if (!isValidCountryCode(normalized)) {
        throw new Error(`"${code}" is not a valid ISO country code.`);
      }
      if (typeof id !== "string" || !targets.some(t => t.id === id)) {
        throw new Error(`Pinned target for ${normalized} must reference an approved target.`);
      }
      countryTargets[normalized] = id;
    }
  }

  const clubBackendOverrides: Record<string, BackendProvider> = {};
  const rawClubOverrides = record.clubBackendOverrides;
  if (rawClubOverrides !== null && rawClubOverrides !== undefined) {
    if (typeof rawClubOverrides !== "object" || Array.isArray(rawClubOverrides)) {
      throw new Error(`${BACKEND_ROUTING_CONFIG_KEY}.clubBackendOverrides must be a JSON object.`);
    }
    for (const [clubId, backend] of Object.entries(rawClubOverrides as Record<string, unknown>)) {
      const id = clubId.trim();
      if (!id || id.length > 128) {
        throw new Error(`Club override key "${clubId || "(empty)"}" must be a non-empty club id.`);
      }
      if (backend !== "supabase" && backend !== "icp") {
        throw new Error(`Backend pinned for club ${id} must be "supabase" or "icp".`);
      }
      clubBackendOverrides[id] = backend;
    }
  }

  return { defaultBackend: rawDefault, countryRules, targets, countryTargets, clubBackendOverrides };
}

/** localStorage key holding the last successfully loaded routing config. */
export const BACKEND_ROUTING_CACHE_KEY = "ignite.backendRoutingConfig";

/**
 * Build-time routing config from `IGNITE_LIVE_BACKEND_ROUTING_JSON` (same
 * schema as the `backend_routing_config` app_settings row). This is the boot
 * path that lets an ICP-routed deployment start up without Supabase: the
 * stored row still overrides it when reachable. Returns null when unset.
 * Throws on malformed content, mirroring the target registry's env handling.
 */
export function getBuildTimeBackendRoutingConfig(): BackendRoutingConfig | null {
  const raw = import.meta.env["IGNITE_LIVE_BACKEND_ROUTING_JSON"];
  if (typeof raw !== "string" || raw.trim() === "") return null;
  return parseBackendRoutingConfig(JSON.parse(raw));
}

/** Persists the last good config so a transient Supabase outage cannot flip a configured deployment back to defaults. */
export function cacheBackendRoutingConfig(config: BackendRoutingConfig): void {
  try {
    globalThis.localStorage?.setItem(BACKEND_ROUTING_CACHE_KEY, JSON.stringify(config));
  } catch {
    // Storage unavailable (private mode, quota) — caching is best-effort.
  }
}

/** Reads the cached config, returning null when absent or no longer parseable. */
export function readCachedBackendRoutingConfig(): BackendRoutingConfig | null {
  try {
    const raw = globalThis.localStorage?.getItem(BACKEND_ROUTING_CACHE_KEY);
    if (!raw) return null;
    return parseBackendRoutingConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

let activeConfig: BackendRoutingConfig | null = null;

function copyConfig(config: BackendRoutingConfig): BackendRoutingConfig {
  return {
    defaultBackend: config.defaultBackend,
    countryRules: { ...config.countryRules },
    targets: config.targets.map(t => ({ ...t })),
    countryTargets: { ...config.countryTargets },
    clubBackendOverrides: { ...config.clubBackendOverrides },
  };
}

export function applyBackendRoutingConfig(config: BackendRoutingConfig | null): void {
  activeConfig = config ? copyConfig(config) : null;
}

export function getBackendRoutingConfig(): BackendRoutingConfig {
  return activeConfig ? copyConfig(activeConfig) : copyConfig(DEFAULT_BACKEND_ROUTING_CONFIG);
}

/**
 * Pure resolver: the backend pinned for the given club memberships, or null
 * when no member club has an override. When a member belongs to clubs pinned
 * both ways, a Supabase pin wins — Supabase is the safe rescue path.
 */
export function resolveClubBackendOverride(
  config: BackendRoutingConfig,
  clubIds: readonly string[],
): BackendProvider | null {
  let sawIcp = false;
  for (const id of clubIds) {
    const pin = config.clubBackendOverrides[id];
    if (pin === "supabase") return "supabase";
    if (pin === "icp") sawIcp = true;
  }
  return sawIcp ? "icp" : null;
}

/**
 * Pure resolver: which backend should serve a user, combining per-club
 * overrides with the country rules. A club pin wins over country rules; the
 * ICP safety net still applies (ICP is never returned before canisters are
 * configured).
 */
export function resolveBackendForUser(
  config: BackendRoutingConfig,
  country: string | null,
  clubIds: readonly string[],
  icpAvailable: boolean,
): BackendProvider {
  const pin = resolveClubBackendOverride(config, clubIds);
  if (pin === "supabase") return "supabase";
  if (pin === "icp") return icpAvailable ? "icp" : "supabase";
  return resolveBackendForCountry(config, country, icpAvailable);
}

/**
 * localStorage key holding the last per-club backend pin that applied to the
 * signed-in user. The pre-auth boot (which sign-in screen /auth shows)
 * cannot know club memberships yet, so it reads this hint; the post-auth
 * enforcement check rewrites it from live membership data.
 */
export const CLUB_BACKEND_HINT_KEY = "ignite.clubBackendHint";

/** Persists the last per-club backend pin (null clears it). Best-effort. */
export function cacheClubBackendHint(backend: BackendProvider | null): void {
  try {
    if (backend === null) {
      globalThis.localStorage?.removeItem(CLUB_BACKEND_HINT_KEY);
    } else {
      globalThis.localStorage?.setItem(CLUB_BACKEND_HINT_KEY, backend);
    }
  } catch {
    // Storage unavailable (private mode, quota) — caching is best-effort.
  }
}

/** Reads the cached per-club backend pin, or null when absent/invalid. */
export function readCachedClubBackendHint(): BackendProvider | null {
  try {
    const raw = globalThis.localStorage?.getItem(CLUB_BACKEND_HINT_KEY);
    return raw === "supabase" || raw === "icp" ? raw : null;
  } catch {
    return null;
  }
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

/**
 * Pure resolver: which approved target should serve a user in `country`.
 *
 * - Resolves the backend first (same rules as resolveBackendForCountry).
 * - A country pinned to an approved target uses that target when it is
 *   enabled and belongs to the resolved backend.
 * - Otherwise the first enabled target for the resolved backend wins.
 * - Returns undefined when no enabled target exists for the backend; callers
 *   then use the backend's built-in default.
 */
export function resolveTargetForCountry(
  config: BackendRoutingConfig,
  country: string | null,
  icpAvailable: boolean,
): ApprovedBackendTarget | undefined {
  const backend = resolveBackendForCountry(config, country, icpAvailable);
  const code = country?.trim().toUpperCase();
  const enabledForBackend = config.targets.filter(t => t.enabled && t.backend === backend);
  const pinnedId = code ? config.countryTargets[code] : undefined;
  if (pinnedId) {
    const pinned = enabledForBackend.find(t => t.id === pinnedId);
    if (pinned) return pinned;
  }
  return enabledForBackend[0];
}
