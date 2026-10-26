import { beforeEach, describe, expect, it, vi } from "vitest";
import { Principal } from "@icp-sdk/core/principal";
import { GROUP_DOMAINS } from "./groupRouting";
import type { FeatureBackendContext } from "./featureRouter";
const mocks = vi.hoisted(() => ({ page: vi.fn() }));
vi.mock("./domains", () => ({ connectLiveShardRouter: async () => ({ actor: { read_group_registry_page: mocks.page } }) }));
import { createLivePrivateProfileAuthorityResolver } from "./privateProfileAuthority";
const p = (n: number) => Principal.fromUint8Array(Uint8Array.from([n, 1]));
function fixture() {
  const subnet=p(100);
  const groups=["g1","g2"].map((id,n)=>({id,target_alias:"mainnet",domains:GROUP_DOMAINS.map((domain,i)=>({domain,canister:p(1+n*20+i)}))}));
  const placements=groups.map(g=>({group_id:g.id,deployment_id:"ignite",deployment_revision:3n,host:"https://icp-api.io",network_kind:"public_mainnet",primary_subnet:subnet,approved_subnets:[subnet],additional_subnets_enabled:false,domains:g.domains.map(d=>({...d,subnet}))}));
  const binding={targetAlias:"mainnet",deploymentId:"ignite",deploymentRevision:3n,host:"https://icp-api.io",networkKind:"public_mainnet",registryRevision:8n,requiredClubAuthorities:[groups[0].domains[0].canister.toText()]};
  const ctx={identity:{getPrincipal:()=>p(90)},target:{alias:"mainnet",host:binding.host,networkKind:"public_mainnet",canisterIds:{club_domain:groups[0].domains[0].canister.toText(),pii_access_control:p(11).toText()}}} as FeatureBackendContext;
  const reply={Ok:{revision:8n,groups,placements,next_cursor:[]}};
  mocks.page.mockResolvedValue(reply);
  const authority=groups[1].domains.find(d=>d.domain==="pii_access_control")?.canister.toText() ?? "";
  return {ctx,binding,reply,authority,resolve:createLivePrivateProfileAuthorityResolver(ctx,binding)};
}
beforeEach(()=>vi.clearAllMocks());
describe("live original-PII resolver consensus composition",()=>{
  it("reads the exact approved router revision and rechecks it after foreign-group unlock",async()=>{
    const f=fixture(); const lease=await f.resolve(f.authority);
    expect(lease.context.target.canisterIds.pii_access_control).toBe(f.authority);
    expect(lease.context.target.canisterIds.club_domain).toBe(f.ctx.target.canisterIds.club_domain);
    expect(mocks.page).toHaveBeenCalledWith("mainnet",[8n],[],64);
    await lease.confirm();expect(mocks.page).toHaveBeenCalledTimes(2);
  });
  it("refuses missing production placement evidence instead of inferring approval",async()=>{
    const f=fixture();f.reply.Ok.placements.pop();
    await expect(f.resolve(f.authority)).rejects.toThrow();
  });
  it("refuses revision changes and never repins",async()=>{
    const f=fixture();const lease=await f.resolve(f.authority);
    mocks.page.mockResolvedValue({Err:"Registry revision changed"});
    await expect(lease.confirm()).rejects.toThrow("revision changed");
    expect(mocks.page.mock.calls.every(call=>call[1][0]===8n)).toBe(true);
  });
  it("rejects same-principal identity-object replacement during router read",async()=>{
    const f=fixture();mocks.page.mockImplementationOnce(async()=>{f.ctx.identity={getPrincipal:()=>p(90)} as FeatureBackendContext["identity"];return f.reply;});
    await expect(f.resolve(f.authority)).rejects.toThrow("identity or target changed");
  });
  it("rejects target substitution during router read",async()=>{
    const f=fixture();mocks.page.mockImplementationOnce(async()=>{f.ctx.target.canisterIds.club_domain=p(120).toText();return f.reply;});
    await expect(f.resolve(f.authority)).rejects.toThrow("identity or target changed");
  });
  it("keeps the runtime target alias while reading the independently pinned on-chain alias",async()=>{
    const f=fixture();f.ctx.target.alias="app-mainnet";
    const binding={...f.binding,targetAlias:"app-mainnet",registryAlias:"mainnet"};
    const lease=await createLivePrivateProfileAuthorityResolver(f.ctx,binding)(f.authority);
    expect(mocks.page).toHaveBeenCalledWith("mainnet",[8n],[],64);
    expect(lease.context.target.alias).toBe("app-mainnet");
    await lease.confirm();
  });
});