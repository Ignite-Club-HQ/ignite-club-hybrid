import {beforeEach,describe,expect,it,vi} from "vitest";
import {Principal} from "@icp-sdk/core/principal";
import type {FeatureBackendContext} from "../featureRouter";
const mocks=vi.hoisted(()=>({page:vi.fn(),hydrate:vi.fn(),enabled:vi.fn(),global:vi.fn()}));
vi.mock("../adminUserDirectory",()=>({readAdminUserDirectory:mocks.page}));
vi.mock("../privateProfileNames",()=>({hydratePrivateProfileNames:mocks.hydrate}));
vi.mock("../privateProfileSearchMode",()=>({privateProfileSearchRehearsalEnabled:mocks.enabled}));
vi.mock("../identityAccess",()=>({connectLiveIdentityAccessClientWithIdentity:async()=>({client:{searchProfiles:mocks.global}})}));
import {searchLiveProfilesWithPrincipals} from "./identityAccessClient";
const principal=Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
const ctx={identity:{getPrincipal:()=>principal},target:{}} as FeatureBackendContext;
const profile={account_id:"account",display_name:"Paul",avatar_ref:[]};
beforeEach(()=>{vi.clearAllMocks();mocks.enabled.mockReturnValue(false);mocks.page.mockResolvedValue({items:[{principals:[principal],profile:[profile]}],next:[]});mocks.hydrate.mockImplementation(async(_,rows)=>rows);});
describe("authorized app-admin search",()=>{
  it("uses the service-authorized administrator directory, never ordinary global search",async()=>{
    expect(await searchLiveProfilesWithPrincipals(ctx,"Paul",10)).toEqual([{accountId:"account",principal,displayName:"Paul",avatarUrl:null}]);
    expect(mocks.page).toHaveBeenCalledWith(ctx,"Paul",null);expect(mocks.global).not.toHaveBeenCalled();
  });
  it("does not turn an administrator refusal into a public search",async()=>{
    mocks.page.mockRejectedValue(new Error("App admin required"));
    await expect(searchLiveProfilesWithPrincipals(ctx,"Paul",10)).rejects.toThrow("App admin required");expect(mocks.global).not.toHaveBeenCalled();
  });
  it("matches decrypted names locally in rehearsal without transmitting a name query",async()=>{
    mocks.enabled.mockReturnValue(true);mocks.page.mockResolvedValue({items:[{principals:[principal],profile:[{...profile,display_name:"opaque"}]}],next:[]});mocks.hydrate.mockResolvedValue([{...profile,principal}]);
    expect((await searchLiveProfilesWithPrincipals(ctx,"Paul",10))[0]?.displayName).toBe("Paul");expect(mocks.page).toHaveBeenCalledWith(ctx,"",null);
  });
});