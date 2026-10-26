import { beforeEach, describe, expect, it, vi } from "vitest";
import { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "../featureRouter";
const mocks=vi.hoisted(()=>({ enabled:vi.fn(),scoped:vi.fn(),global:vi.fn(),dispose:vi.fn(),resolver:vi.fn() }));
vi.mock("../privateProfileAuthority",()=>({createLivePrivateProfileAuthorityResolver:mocks.resolver}));
vi.mock("../privateProfileSearchMode",()=>({privateProfileSearchRehearsalEnabled:mocks.enabled}));
vi.mock("../scopedProfileSearch",()=>({searchScopedClubProfiles:mocks.scoped}));
vi.mock("../identityAccess",()=>({connectLiveIdentityAccessClientWithIdentity:async()=>({client:{searchProfiles:mocks.global,dispose:mocks.dispose}})}));
import { searchLiveInvitableProfiles } from "./membership";
const ctx={target:{alias:'mainnet',host:'https://icp-api.io',networkKind:'public_mainnet',canisterIds:{club_domain:"rrkah-fqaaa-aaaaa-aaaaq-cai"}},identity:{getPrincipal:()=>Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai")}} as FeatureBackendContext;
beforeEach(()=>{vi.clearAllMocks();mocks.enabled.mockReturnValue(true);mocks.scoped.mockResolvedValue([{id:"person",account_id:"account",display_name:"Paul",avatar_ref:null}]);});
describe("ordinary member search connection",()=>{
  it("connects approved original-authority evidence to scoped search without global discovery",async()=>{
    const resolve=vi.fn();mocks.resolver.mockReturnValue(resolve);
    const binding={targetAlias:"mainnet",deploymentId:"ignite",deploymentRevision:3n,host:"https://icp-api.io",networkKind:"public_mainnet",registryRevision:8n,requiredClubAuthorities:["original-club"]};
    await searchLiveInvitableProfiles(ctx,"Paul",8,{clubId:"club-a",privateAuthorityBinding:binding});
    expect(mocks.resolver).toHaveBeenCalledWith(ctx,binding);
    expect(mocks.scoped).toHaveBeenCalledWith(ctx,"club-a","Paul",8,undefined,resolve);
    expect(mocks.global).not.toHaveBeenCalled();
  });
  it("passes the exact club, query, limit and cancellation to the scoped reader",async()=>{
    const controller=new AbortController();
    expect(await searchLiveInvitableProfiles(ctx,"Paul",8,{clubId:"club-a",signal:controller.signal})).toEqual([{id:"person",account_id:"account",display_name:"Paul",avatar_ref:null}]);
    expect(mocks.scoped).toHaveBeenCalledWith(ctx,"club-a","Paul",8,controller.signal);
    expect(mocks.global).not.toHaveBeenCalled();
  });
  it("never falls back to full search after a scoped refusal",async()=>{
    mocks.scoped.mockRejectedValue(new Error("Membership refused"));
    await expect(searchLiveInvitableProfiles(ctx,"Paul",8,{clubId:"club-a"})).rejects.toThrow("Membership refused");
    expect(mocks.global).not.toHaveBeenCalled();
  });
  it("refuses missing club context before either search",async()=>{
    await expect(searchLiveInvitableProfiles(ctx,"Paul",8)).rejects.toThrow("specific club");
    expect(mocks.scoped).not.toHaveBeenCalled();expect(mocks.global).not.toHaveBeenCalled();
  });
  it("preserves explicit transitional production search without silently activating cutover",async()=>{
    mocks.enabled.mockReturnValue(false);
    mocks.global.mockResolvedValue([{principal:ctx.identity.getPrincipal(),account_id:"account",display_name:"Paul",avatar_ref:[]}]);
    expect((await searchLiveInvitableProfiles(ctx," Paul ",8,{clubId:"club-a"}))[0]?.display_name).toBe("Paul");
    expect(mocks.global).toHaveBeenCalledWith("Paul",8);expect(mocks.scoped).not.toHaveBeenCalled();
  });
});