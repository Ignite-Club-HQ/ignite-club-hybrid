import { describe, expect, it } from "vitest";
import { DEFAULT_BACKEND_ROUTING_CONFIG, isCloudEngineUsable, normalizeApprovedTarget, parseBackendRoutingConfig, resolveIcpEngineForCountry } from "./backendRouting";

const engine = normalizeApprovedTarget({
  backend: "icp", kind: "icp-cloud-engine", alias: "eu-engine", version: "v1", region: "EU", enabled: true,
  host: "https://eu.example.com/", canisterIds: { club_domain: "rrkah-fqaaa-aaaaa-aaaaq-cai" },
});

describe("cloud engine routing", () => {
  it("round-trips engine address and canister ids", () => {
    const cfg = parseBackendRoutingConfig({ ...DEFAULT_BACKEND_ROUTING_CONFIG, targets: [engine], countryTargets: { DE: engine.id } })!;
    expect(cfg.targets[0].host).toBe("https://eu.example.com");
    expect(resolveIcpEngineForCountry(cfg, "de")?.alias).toBe("eu-engine");
    expect(resolveIcpEngineForCountry(cfg, "AU")).toBeNull();
    expect(isCloudEngineUsable(cfg.targets[0])).toBe(true);
    expect(isCloudEngineUsable({ ...cfg.targets[0], enabled: false })).toBe(false);
  });
  it("rejects bad canister ids and non-https hosts", () => {
    expect(() => normalizeApprovedTarget({ ...engine, canisterIds: { x: "nope" } })).toThrow();
    expect(() => normalizeApprovedTarget({ ...engine, host: "http://x.com" })).toThrow();
  });
});
