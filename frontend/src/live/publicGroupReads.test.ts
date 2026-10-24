import { describe, expect, it,vi } from "vitest";
import { publicReadTargets,readFreshPublicTargets } from "./publicGroupReads";
const read=vi.hoisted(()=>vi.fn());
vi.mock("./domains",()=>({connectLiveShardRouter:async()=>({actor:{read_public_group_targets:read}})}));
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
  it("discovers a newly registered group absent from the build snapshot",async()=>{
    const domains=["club_domain","events_domain","messaging_domain","vault_domain","competition_domain","club_points_domain","mini_league_domain","media_metadata","insights_domain","notification_queue","pii_access_control","timer_jobs","secret_workload_identity"].map(domain=>({domain,canister:{toText:()=>domain==="competition_domain"?"g3":domain}}));
    read.mockResolvedValue({Ok:{configuration_revision:2n,groups:[{id:"g3",domains}],next_cursor:[]}});
    expect((await readFreshPublicTargets(base,snapshot)).map(t=>t.canisterIds.competition_domain)).toEqual(["g1","g3"]);
  });
  it("refuses configuration drift between registry pages",async()=>{
    read.mockResolvedValueOnce({Ok:{configuration_revision:2n,groups:[],next_cursor:["g1"]}}).mockResolvedValueOnce({Ok:{configuration_revision:3n,groups:[],next_cursor:[]}});
    await expect(readFreshPublicTargets(base,snapshot)).rejects.toThrow("revision changed");
  });
});