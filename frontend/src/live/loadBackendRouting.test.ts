/**
 * Stage A (ICP-only cutover): routing config must survive without Supabase.
 *
 * Precedence under test: stored app_settings row > build-time env >
 * localStorage cache > default. The build-time and cache fallbacks exist so
 * an ICP-routed deployment still boots on ICP when Supabase is unreachable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let queryResult: { data: { value: unknown } | null; error: unknown } = { data: null, error: null };
const maybeSingle = vi.fn(async () => queryResult);
const selectChain = {
  select: () => selectChain,
  eq: () => selectChain,
  maybeSingle,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => selectChain },
}));

import {
  BACKEND_ROUTING_CACHE_KEY,
  CLUB_BACKEND_HINT_KEY,
  applyBackendRoutingConfig,
  cacheClubBackendHint,
  getBackendRoutingConfig,
  readCachedClubBackendHint,
  resolveBackendForUser,
  resolveClubBackendOverride,
  type BackendRoutingConfig,
} from "./backendRouting";
import { loadBackendRoutingConfig } from "./loadBackendRouting";

const icpConfig: BackendRoutingConfig = {
  defaultBackend: "icp",
  countryRules: { AU: "icp" },
  targets: [
    { id: "icp/main/v1", backend: "icp", kind: "icp-mainnet", alias: "main", version: "v1", enabled: true },
  ],
  countryTargets: {},
  clubBackendOverrides: {},
};

const supabaseConfig: BackendRoutingConfig = {
  defaultBackend: "supabase",
  countryRules: {},
  targets: [],
  countryTargets: {},
  clubBackendOverrides: {},
};

beforeEach(() => {
  queryResult = { data: null, error: null };
  maybeSingle.mockClear();
  applyBackendRoutingConfig(null);
  localStorage.clear();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loadBackendRoutingConfig precedence", () => {
  it("applies the stored row and caches it", async () => {
    queryResult = { data: { value: icpConfig }, error: null };
    await loadBackendRoutingConfig();
    expect(getBackendRoutingConfig().defaultBackend).toBe("icp");
    expect(localStorage.getItem(BACKEND_ROUTING_CACHE_KEY)).toBe(JSON.stringify(icpConfig));
  });

  it("falls back to the build-time env config when the Supabase read fails", async () => {
    queryResult = { data: null, error: new Error("network down") };
    vi.stubEnv("IGNITE_LIVE_BACKEND_ROUTING_JSON", JSON.stringify(icpConfig));
    await loadBackendRoutingConfig();
    expect(getBackendRoutingConfig().defaultBackend).toBe("icp");
  });

  it("falls back to the build-time env config when no stored row exists", async () => {
    queryResult = { data: null, error: null };
    vi.stubEnv("IGNITE_LIVE_BACKEND_ROUTING_JSON", JSON.stringify(icpConfig));
    await loadBackendRoutingConfig();
    expect(getBackendRoutingConfig().defaultBackend).toBe("icp");
  });

  it("prefers the stored row over the build-time env config", async () => {
    queryResult = { data: { value: supabaseConfig }, error: null };
    vi.stubEnv("IGNITE_LIVE_BACKEND_ROUTING_JSON", JSON.stringify(icpConfig));
    await loadBackendRoutingConfig();
    expect(getBackendRoutingConfig().defaultBackend).toBe("supabase");
  });

  it("uses the cached config when Supabase fails and no build-time config exists", async () => {
    localStorage.setItem(BACKEND_ROUTING_CACHE_KEY, JSON.stringify(icpConfig));
    queryResult = { data: null, error: new Error("network down") };
    await loadBackendRoutingConfig();
    expect(getBackendRoutingConfig().defaultBackend).toBe("icp");
  });

  it("prefers build-time config over a stale cache", async () => {
    localStorage.setItem(BACKEND_ROUTING_CACHE_KEY, JSON.stringify(supabaseConfig));
    vi.stubEnv("IGNITE_LIVE_BACKEND_ROUTING_JSON", JSON.stringify(icpConfig));
    queryResult = { data: null, error: new Error("network down") };
    await loadBackendRoutingConfig();
    expect(getBackendRoutingConfig().defaultBackend).toBe("icp");
  });

  it("ignores an invalid build-time config and falls through to the cache", async () => {
    localStorage.setItem(BACKEND_ROUTING_CACHE_KEY, JSON.stringify(icpConfig));
    vi.stubEnv("IGNITE_LIVE_BACKEND_ROUTING_JSON", "{not json");
    queryResult = { data: null, error: new Error("network down") };
    await loadBackendRoutingConfig();
    expect(getBackendRoutingConfig().defaultBackend).toBe("icp");
  });

  it("ignores a corrupt cache entry and defaults to Supabase", async () => {
    localStorage.setItem(BACKEND_ROUTING_CACHE_KEY, "{corrupt");
    queryResult = { data: null, error: new Error("network down") };
    await loadBackendRoutingConfig();
    expect(getBackendRoutingConfig().defaultBackend).toBe("supabase");
  });

  it("defaults to Supabase when nothing is available", async () => {
    queryResult = { data: null, error: new Error("network down") };
    await loadBackendRoutingConfig();
    expect(getBackendRoutingConfig().defaultBackend).toBe("supabase");
  });
});
