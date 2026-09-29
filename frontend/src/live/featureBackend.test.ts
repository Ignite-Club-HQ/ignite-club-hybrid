import { describe, expect, it } from "vitest";
import {
  DEFAULT_BACKEND_ROUTING_CONFIG,
  type BackendRoutingConfig,
} from "./backendRouting";
import {
  FEATURE_AREAS,
  FEATURE_CANISTER_KEYS,
  isFeatureCanisterConfigured,
  resolveFeatureBackend,
} from "./featureBackend";
import type { IcpTargetConfig } from "./targetRegistry";

function icpTarget(canisterIds: Record<string, string>): IcpTargetConfig {
  return {
    provider: "icp",
    alias: "icp-public-mainnet",
    networkKind: "public_mainnet",
    host: "https://icp-api.io",
    canisterIds,
    deploymentClass: "public_subnet",
    status: "active",
  };
}

function config(partial: Partial<BackendRoutingConfig>): BackendRoutingConfig {
  return { ...DEFAULT_BACKEND_ROUTING_CONFIG, ...partial };
}

describe("resolveFeatureBackend", () => {
  it("routes every feature to Supabase by default (no config, no canisters)", () => {
    for (const feature of FEATURE_AREAS) {
      expect(
        resolveFeatureBackend(DEFAULT_BACKEND_ROUTING_CONFIG, null, null, feature),
      ).toBe("supabase");
    }
  });

  it("routes to ICP only when the feature's own canister is configured", () => {
    const cfg = config({ defaultBackend: "icp" });
    const target = icpTarget({ events_domain: "aaaaa-bb" });
    expect(resolveFeatureBackend(cfg, null, target, "events")).toBe("icp");
    // home shares the events_domain canister
    expect(resolveFeatureBackend(cfg, null, target, "home")).toBe("icp");
    // messaging canister not configured -> Supabase fallback
    expect(resolveFeatureBackend(cfg, null, target, "messaging")).toBe("supabase");
  });

  it("falls back to Supabase for an ICP-only country when the canister is missing", () => {
    const cfg = config({ countryRules: { AU: "icp" } });
    expect(resolveFeatureBackend(cfg, "AU", icpTarget({}), "media")).toBe("supabase");
    expect(
      resolveFeatureBackend(cfg, "AU", icpTarget({ media_metadata: "aaaaa-cc" }), "media"),
    ).toBe("icp");
  });

  it("keeps Supabase-only countries on Supabase even with canisters configured", () => {
    const cfg = config({
      defaultBackend: "icp",
      countryRules: { GB: "supabase" },
    });
    const target = icpTarget({ events_domain: "aaaaa-bb" });
    expect(resolveFeatureBackend(cfg, "GB", target, "events")).toBe("supabase");
  });

  it("treats a null target (unresolvable ICP config) as Supabase", () => {
    const cfg = config({ defaultBackend: "icp", countryRules: { AU: "icp" } });
    expect(resolveFeatureBackend(cfg, "AU", null, "events")).toBe("supabase");
  });
});

describe("feature canister mapping", () => {
  it("maps every feature area to a known canister key", () => {
    for (const feature of FEATURE_AREAS) {
      expect(FEATURE_CANISTER_KEYS[feature]).toMatch(/^[a-z_]+$/);
    }
  });

  it("detects configured canisters, ignoring blank IDs", () => {
    expect(
      isFeatureCanisterConfigured(icpTarget({ vault: "  " }), "vault"),
    ).toBe(false);
    expect(
      isFeatureCanisterConfigured(
        icpTarget({ vault_domain: "aaaaa-dd" }),
        "vault",
      ),
    ).toBe(true);
  });
});
