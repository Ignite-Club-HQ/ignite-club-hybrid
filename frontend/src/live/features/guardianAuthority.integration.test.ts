import {beforeEach,describe,expect,it,vi} from "vitest";
import type {FeatureBackendContext} from "../featureRouter";
import {Principal} from '@icp-sdk/core/principal';
const mocks=vi.hoisted(()=>({enabled:vi.fn(),search:vi.fn(),resolver:vi.fn()}));
vi.mock("../privateProfileSearchMode",()=>({privateProfileSearchRehearsalEnabled:mocks.enabled}));
vi.mock("../guardianProfileSearch",()=>({searchEncryptedGuardianProfiles:mocks.search}));
vi.mock("../privateProfileAuthority",()=>({createLivePrivateProfileAuthorityResolver:mocks.resolver}));
import {searchLiveGuardianProfiles} from "./identityAccessClient";
const ctx={target:{alias:'mainnet',host:'https://icp-api.io',networkKind:'public_mainnet'},identity:{getPrincipal:()=>Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai')}} as FeatureBackendContext;
beforeEach(()=>{vi.clearAllMocks();mocks.enabled.mockReturnValue(true);mocks.search.mockResolvedValue([]);});
describe("guardian original-authority gateway",()=>{
  it("threads exact-child context, cancellation and independently approved inventory into encrypted search",async()=>{
    const binding={targetAlias:"mainnet",deploymentId:"ignite",deploymentRevision:3n,host:"https://icp-api.io",networkKind:"public_mainnet",registryRevision:8n,requiredClubAuthorities:["original-club"]};
    const resolve=vi.fn();mocks.resolver.mockReturnValue(resolve);const controller=new AbortController();
    await searchLiveGuardianProfiles(ctx,"child-a","Paul",6,controller.signal,binding);
    expect(mocks.resolver).toHaveBeenCalledWith(ctx,binding);
    expect(mocks.search).toHaveBeenCalledWith(ctx,"child-a","Paul",6,{signal:controller.signal,resolveAuthority:resolve});
  });
  it("does not infer a cross-group pin when approved deployment evidence is absent",async()=>{
    await searchLiveGuardianProfiles(ctx,"child-a","Paul",6);
    expect(mocks.resolver).not.toHaveBeenCalled();expect(mocks.search).toHaveBeenCalledWith(ctx,"child-a","Paul",6,{signal:undefined});
  });
  it("does not fall back to readable search after a cross-group refusal",async()=>{
    mocks.search.mockRejectedValue(new Error("Original authority refused"));
    await expect(searchLiveGuardianProfiles(ctx,"child-a","Paul",6)).rejects.toThrow("Original authority refused");
  });
});