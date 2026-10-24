import { describe, expect, it } from "vitest";
import { publicReadTargets } from "./publicGroupReads";
import type { IcpTargetConfig } from "./targetRegistry";
import type { RoutingGatesSnapshot } from "./generalActivation";
const base = { host: "https://icp-api.io", canisterIds: { shard_router: "router", competition_domain: "g1" } } as IcpTargetConfig;
const snapshot = { host: base.host, routerCanisterId: "router", groups: [{ id: "g2", domains: [{ domain: "competition_domain", canisterId: "g2" }] }] } as RoutingGatesSnapshot;
describe("public group read inventory", () => {
  it("includes the original and pinned second group without changing the base target", () => {
    expect(publicReadTargets(base, snapshot).map(t => t.canisterIds.competition_domain)).toEqual(["g1", "g2"]);
    expect(base.canisterIds.competition_domain).toBe("g1");
  });
  it("refuses a foreign router rather than probing unrelated services", () => {
    expect(() => publicReadTargets(base, { ...snapshot, routerCanisterId: "foreign" })).toThrow("does not match");
  });
  it("keeps a checkout without grouped inventory on its configured original target", () => {
    expect(publicReadTargets(base, null)).toEqual([base]);
  });
});