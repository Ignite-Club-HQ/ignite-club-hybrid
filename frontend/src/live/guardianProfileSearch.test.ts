import { beforeEach,describe,expect,it,vi } from "vitest";
import { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "./featureRouter";
const mocks=vi.hoisted(()=>({page:vi.fn(),confirm:vi.fn(),hydrate:vi.fn(),dispose:vi.fn(),global:vi.fn()}));
vi.mock("./identityAccess",()=>({connectLiveIdentityAccessClientWithIdentity:async()=>({client:{readGuardianProfileCandidates:mocks.page,readGuardianProfiles:mocks.confirm,searchProfiles:mocks.global,dispose:mocks.dispose}})}));
vi.mock("./privateProfileNames",()=>({hydratePrivateProfileNames:mocks.hydrate}));
import { searchEncryptedGuardianProfiles } from "./guardianProfileSearch";
const authority="rrkah-fqaaa-aaaaa-aaaaq-cai";
const principal=Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
const caller=Principal.fromText("r7inp-6aaaa-aaaaa-aaabq-cai");
const ctx={target:{canisterIds:{club_domain:authority}},identity:{getPrincipal:()=>caller}} as FeatureBackendContext;
const row={principal,account_id:"account",display_name:"Paul Cranwell",avatar_ref:[]};
const next={after:"account",revision:7n,binding:new Uint8Array([1]),expires_at_ns:100n};
beforeEach(()=>{vi.clearAllMocks();mocks.page.mockResolvedValue({revision:7n,rows:[row],scanned:1,next:[]});mocks.confirm.mockResolvedValue([row]);mocks.hydrate.mockImplementation(async(_,rows)=>rows);});
describe("encrypted guardian search integration",()=>{
  it("enumerates exact-child candidates without transmitting the name query",async()=>{
    expect(await searchEncryptedGuardianProfiles(ctx,"child-1","Paul",6)).toEqual([{id:principal.toText(),display_name:"Paul Cranwell",avatar_url:null}]);
    expect(mocks.page).toHaveBeenCalledWith(Principal.fromText(authority),"child-1",[]);
    expect(mocks.confirm).toHaveBeenCalledWith(Principal.fromText(authority),"child-1",[principal],7n);
    expect(mocks.hydrate).toHaveBeenCalledWith(ctx,[row],{audience:{kind:'guardian_search',authority:Principal.fromText(authority),resource:'child-1',profile_revision:7n}});
    expect(mocks.global).not.toHaveBeenCalled();expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it("matches only decrypted names and never displays opaque references",async()=>{
    const encrypted={...row,display_name:`pii-display-name:v1:${authority}:${principal.toText()}`};
    mocks.page.mockResolvedValue({revision:7n,rows:[encrypted],scanned:1,next:[]});mocks.confirm.mockResolvedValue([encrypted]);mocks.hydrate.mockResolvedValue([row]);
    expect((await searchEncryptedGuardianProfiles(ctx,"child-1","cranwell"))[0]?.display_name).toBe("Paul Cranwell");
  });
  it("continues through nonmatching pages to find a later match",async()=>{
    mocks.page.mockResolvedValueOnce({revision:7n,rows:[],scanned:100,next:[next]}).mockResolvedValueOnce({revision:7n,rows:[row],scanned:1,next:[]});
    mocks.confirm.mockImplementation(async(_,__,subjects)=>subjects.length?[row]:[]);
    expect((await searchEncryptedGuardianProfiles(ctx,"child-1","Paul"))[0]?.id).toBe(principal.toText());
    expect(mocks.page).toHaveBeenNthCalledWith(2,Principal.fromText(authority),"child-1",[next]);
  });
  it("rejects guardian refusal without using historical global search",async()=>{
    mocks.page.mockRejectedValue(new Error("Guardian refused"));
    await expect(searchEncryptedGuardianProfiles(ctx,"child-1","Paul")).rejects.toThrow("Guardian refused");
    expect(mocks.hydrate).not.toHaveBeenCalled();expect(mocks.global).not.toHaveBeenCalled();
  });
  it("withholds names after guardian removal during unlock",async()=>{
    mocks.confirm.mockRejectedValue(new Error("Guardian removed"));
    await expect(searchEncryptedGuardianProfiles(ctx,"child-1","Paul")).rejects.toThrow("Guardian removed");
  });
  it("withholds names after a profile account or reference changes",async()=>{
    mocks.confirm.mockResolvedValue([{...row,account_id:"relinked"}]);
    await expect(searchEncryptedGuardianProfiles(ctx,"child-1","Paul")).rejects.toThrow("binding changed");
  });
  it("rechecks earlier retained matches after later-page decryption",async()=>{
    mocks.page.mockResolvedValueOnce({revision:7n,rows:[row],scanned:1,next:[next]}).mockResolvedValueOnce({revision:7n,rows:[],scanned:1,next:[]});
    mocks.confirm.mockResolvedValueOnce([row]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(searchEncryptedGuardianProfiles(ctx,"child-1","Paul",6)).rejects.toThrow("binding changed");
  });
  it("rejects stale/nonadvancing pages",async()=>{
    mocks.page.mockResolvedValueOnce({revision:7n,rows:[],scanned:1,next:[next]}).mockResolvedValueOnce({revision:8n,rows:[],scanned:1,next:[]});mocks.confirm.mockResolvedValue([]);
    await expect(searchEncryptedGuardianProfiles(ctx,"child-1","Paul")).rejects.toThrow("directory changed");
  });
  it("rejects oversize pages before unlocking names",async()=>{
    mocks.page.mockResolvedValue({revision:7n,rows:[],scanned:101,next:[]});
    await expect(searchEncryptedGuardianProfiles(ctx,"child-1","Paul")).rejects.toThrow("directory changed");expect(mocks.hydrate).not.toHaveBeenCalled();
  });
  it("discards cancelled search results after name decryption",async()=>{
    const controller=new AbortController();mocks.hydrate.mockImplementation(async()=>{controller.abort();return[row];});
    await expect(searchEncryptedGuardianProfiles(ctx,"child-1","Paul",6,{signal:controller.signal})).rejects.toThrow("cancelled");expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("reports budget exhaustion as incomplete, not an empty completed search",async()=>{
    let n=0;mocks.page.mockImplementation(async()=>({revision:7n,rows:[],scanned:100,next:[{...next,after:`account-${String(++n).padStart(4,"0")}`}]}));mocks.confirm.mockResolvedValue([]);
    await expect(searchEncryptedGuardianProfiles(ctx,"child-1","Paul")).rejects.toThrow("bounded page budget");expect(mocks.page).toHaveBeenCalledTimes(100);
  });
});