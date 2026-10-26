import { beforeEach, describe, expect, it, vi } from "vitest";
import { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "./featureRouter";
const mocks = vi.hoisted(() => ({ read: vi.fn(), hydrate: vi.fn(), dispose: vi.fn(), connect: vi.fn(), page: vi.fn() }));
vi.mock("./identityAccess", () => ({ connectLiveIdentityAccessClientWithIdentity: mocks.connect }));
vi.mock("./privateProfileNames", () => ({ hydratePrivateProfileNames: mocks.hydrate }));
vi.mock("./domains", () => ({ connectLiveClubDomain: vi.fn(async () => ({ actor: { read_profile_candidates: mocks.page } })) }));
import { searchScopedProfileCandidates, searchScopedClubProfiles } from "./scopedProfileSearch";
const subject = "mbrvi-lvde7-gdspi-hamp3-nxj43-p4tt6-at6q5-jlbit-eehve-7xqwc-wqe";
const authority = "rrkah-fqaaa-aaaaa-aaaaq-cai";
const ctx = { identity: { getPrincipal: () => Principal.fromText(subject) }, target: { canisterIds: { club_domain: authority } } } as FeatureBackendContext;
const row = { principal: Principal.fromText(subject), account_id: "account-id", display_name: "Paul Cranwell", avatar_ref: ["avatar"] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue({ client: { readClubProfiles: mocks.read, dispose: mocks.dispose } });
  mocks.read.mockResolvedValue([row]);
  mocks.hydrate.mockImplementation(async (_, rows) => rows);
  mocks.page.mockResolvedValue({ Ok: { revision: 7n, subjects: [row.principal], next: [], scanned: 1n } });
});
describe("scoped decrypted person matching", () => {
  it("sends exact club authority and deduplicated principal candidates, not a search term", async () => {
    expect(await searchScopedProfileCandidates(ctx, "club-a", [subject, `principal:${subject}`], "Paul")).toEqual([{ id: subject, account_id: "account-id", display_name: "Paul Cranwell", avatar_ref: "avatar" }]);
    expect(mocks.read).toHaveBeenCalledWith(Principal.fromText(authority), "club-a", [Principal.fromText(subject)]);
  });
  it("matches private names only after authorized decryption", async () => {
    mocks.read.mockResolvedValue([{ ...row, display_name: "pii-display-name:v1:authority:subject" }]);
    mocks.hydrate.mockResolvedValue([row]);
    expect((await searchScopedProfileCandidates(ctx, "club-a", [subject], "CRANWELL"))[0]?.id).toBe(subject);
    expect(mocks.hydrate).toHaveBeenCalledWith(ctx, expect.any(Array), {signal:undefined,resolveAuthority:undefined,audience:{kind:'club',authority:Principal.fromText(authority),resource:'club-a',profile_revision:0n}});
  });
  it("cannot disclose candidates after a membership refusal", async () => {
    mocks.read.mockRejectedValue(new Error("Club membership changed"));
    await expect(searchScopedProfileCandidates(ctx, "club-a", [subject], "Paul")).rejects.toThrow("membership");
    expect(mocks.hydrate).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it("has no global fallback when scope or connection is missing", async () => {
    await expect(searchScopedProfileCandidates(ctx, "", [subject], "Paul")).rejects.toThrow("specific club");
    await expect(searchScopedProfileCandidates({ ...ctx, target: { canisterIds: {} } } as FeatureBackendContext, "club-a", [subject], "Paul")).rejects.toThrow("connection");
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it("refuses unbounded and anonymous candidate lists", async () => {
    await expect(searchScopedProfileCandidates(ctx, "club-a", ["2vxsx-fae"], "Paul")).rejects.toThrow("Active person");
    const ids = Array.from({length: 26}, (_, i) => Principal.fromUint8Array(new Uint8Array([i,1])).toText());
    await expect(searchScopedProfileCandidates(ctx, "club-a", ids, "Paul")).rejects.toThrow("25");
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it("rejects a response that extends the requested audience", async () => {
    mocks.read.mockResolvedValue([{ ...row, principal: Principal.fromText(authority) }]);
    await expect(searchScopedProfileCandidates(ctx, "club-a", [subject], "Paul")).rejects.toThrow("unexpected identity");
    expect(mocks.hydrate).not.toHaveBeenCalled();
  });
  it("discards name results when cancellation occurs during decryption", async () => {
    const controller = new AbortController();
    mocks.hydrate.mockImplementation(async () => { controller.abort(); return [row]; });
    await expect(searchScopedProfileCandidates(ctx,"club-a",[subject],"Paul",10,controller.signal)).rejects.toThrow("cancelled");
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it("refuses retained decrypted names when caller membership is revoked during unlock", async () => {
    mocks.hydrate.mockImplementation(async () => {
      mocks.read.mockRejectedValueOnce(new Error("Club membership changed"));
      return [row];
    });
    await expect(searchScopedProfileCandidates(ctx,"club-a",[subject],"Paul")).rejects.toThrow("membership changed");
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it.each([
    ["removed subject", []],
    ["relinked account", [{ ...row, account_id: "replacement-account" }]],
    ["changed original name reference", [{ ...row, display_name: "different-reference" }]],
    ["duplicate final subjects", [row, row]],
    ["foreign final subject", [{ ...row, principal: Principal.fromText(authority) }]],
  ])("discards decrypted matches after %s during unlock", async (_, confirmed) => {
    mocks.read.mockResolvedValueOnce([row]).mockResolvedValueOnce(confirmed);
    await expect(searchScopedProfileCandidates(ctx,"club-a",[subject],"Paul")).rejects.toThrow("authority changed");
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it("confirms the same principal/account/reference after unlocking a private name", async () => {
    const privateRow = { ...row, display_name: "pii-display-name:v1:original:subject" };
    mocks.read.mockResolvedValue([privateRow]);
    mocks.hydrate.mockResolvedValue([row]);
    expect((await searchScopedProfileCandidates(ctx,"club-a",[subject],"Paul"))[0]?.account_id).toBe("account-id");
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.read.mock.calls[1]).toEqual(mocks.read.mock.calls[0]);
  });
});

describe("authority-owned paged club search", () => {
  it("carries the original-authority resolver through paging into private hydration", async () => {
    const resolve = vi.fn();
    expect((await searchScopedClubProfiles(ctx,"club-a","Paul",10,undefined,resolve))[0]?.id).toBe(subject);
    expect(mocks.hydrate).toHaveBeenCalledWith(ctx,[row],{signal:undefined,resolveAuthority:resolve,audience:{kind:'club',authority:Principal.fromText(authority),resource:'club-a',profile_revision:0n}});
  });
  it("retires the whole traversal when the identity changes during a candidate page", async () => {
    const changing = { ...ctx };
    mocks.page.mockImplementationOnce(async () => {
      changing.identity = { getPrincipal: () => Principal.fromText(authority) } as FeatureBackendContext["identity"];
      return { Ok: { revision: 7n, subjects: [row.principal], next: [], scanned: 1n } };
    });
    await expect(searchScopedClubProfiles(changing,"club-a","Paul")).rejects.toThrow("identity or authority changed");
    expect(mocks.hydrate).not.toHaveBeenCalled();
  });
  it("retires decrypted results when a pinned target changes during unlock", async () => {
    const changing = { ...ctx, target: { ...ctx.target, canisterIds: { ...ctx.target.canisterIds } } };
    mocks.hydrate.mockImplementationOnce(async () => { changing.target.canisterIds.club_domain = subject; return [row]; });
    await expect(searchScopedClubProfiles(changing,"club-a","Paul")).rejects.toThrow("identity or authority changed");
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
  it("uses authorized candidates and confirms the opening revision after names", async () => {
    expect((await searchScopedClubProfiles(ctx,"club-a","Paul"))[0]?.id).toBe(subject);
    expect(mocks.page).toHaveBeenNthCalledWith(1,"club-a",[]);
    expect(mocks.page).toHaveBeenNthCalledWith(2,"club-a",[{revision:7n,phase:0n,offset:0n}]);
    expect(mocks.hydrate).toHaveBeenCalledOnce();
    expect(mocks.read).toHaveBeenCalledTimes(3);
  });
  it("checks the original opaque reference without deriving a matched private-name key twice", async()=>{
    const privateRow={...row,display_name:"pii-display-name:v1:original:subject"};
    mocks.read.mockResolvedValue([privateRow]);
    mocks.hydrate.mockResolvedValue([row]);
    expect((await searchScopedClubProfiles(ctx,"club-a","Paul"))[0]?.display_name).toBe("Paul Cranwell");
    expect(mocks.hydrate).toHaveBeenCalledOnce();
    mocks.read.mockResolvedValueOnce([privateRow]).mockResolvedValueOnce([privateRow]).mockResolvedValueOnce([{...privateRow,display_name:"replacement-reference"}]);
    await expect(searchScopedClubProfiles(ctx,"club-a","Paul")).rejects.toThrow("authority changed");
  });
  it("discards earlier matches if membership changes before final confirmation", async () => {
    mocks.page.mockResolvedValueOnce({ Ok: { revision:7n,subjects:[row.principal],next:[],scanned:1n } }).mockResolvedValueOnce({Err:"revision changed"});
    await expect(searchScopedClubProfiles(ctx,"club-a","Paul")).rejects.toThrow("revision changed");
  });
  it("rejects mixed-revision pages without reading names for the changed page", async () => {
    mocks.page.mockResolvedValueOnce({Ok:{revision:7n,subjects:[],next:[{revision:7n,phase:0n,offset:100n}],scanned:100n}}).mockResolvedValueOnce({Ok:{revision:8n,subjects:[row.principal],next:[],scanned:1n}});
    await expect(searchScopedClubProfiles(ctx,"club-a","Paul")).rejects.toThrow("changed");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("refuses non-advancing continuations", async () => {
    mocks.page.mockResolvedValue({Ok:{revision:7n,subjects:[],next:[{revision:7n,phase:0n,offset:100n}],scanned:100n}});
    await expect(searchScopedClubProfiles(ctx,"club-a","Paul")).rejects.toThrow("continuation");
    expect(mocks.page).toHaveBeenCalledTimes(2);
  });
  it("deduplicates repeated identities across candidate pages", async () => {
    mocks.read.mockResolvedValue([]);
    mocks.page.mockResolvedValueOnce({Ok:{revision:7n,subjects:[row.principal],next:[{revision:7n,phase:1n,offset:0n}],scanned:1n}}).mockResolvedValue({Ok:{revision:7n,subjects:[row.principal],next:[],scanned:1n}});
    expect(await searchScopedClubProfiles(ctx,"club-a","Paul")).toEqual([]);
    expect(mocks.read).toHaveBeenCalledOnce();
  });
  it("refuses an earlier match suspended while a later page unlocks despite unchanged club revision", async () => {
    const other = { ...row, principal: Principal.fromText(authority), account_id: "other-account" };
    mocks.page.mockResolvedValueOnce({Ok:{revision:7n,subjects:[row.principal],next:[{revision:7n,phase:1n,offset:0n}],scanned:1n}}).mockResolvedValue({Ok:{revision:7n,subjects:[other.principal],next:[],scanned:1n}});
    mocks.read.mockResolvedValueOnce([row]).mockResolvedValueOnce([row]).mockResolvedValueOnce([other]).mockResolvedValueOnce([other]).mockResolvedValue([other]);
    await expect(searchScopedClubProfiles(ctx,"club-a","Paul")).rejects.toThrow("authority changed");
  });
  it("refuses an earlier account relink while later candidates unlock", async () => {
    const other = { ...row, principal: Principal.fromText(authority), account_id: "other-account" };
    mocks.page.mockResolvedValueOnce({Ok:{revision:7n,subjects:[row.principal],next:[{revision:7n,phase:1n,offset:0n}],scanned:1n}}).mockResolvedValue({Ok:{revision:7n,subjects:[other.principal],next:[],scanned:1n}});
    mocks.read.mockResolvedValueOnce([row]).mockResolvedValueOnce([row]).mockResolvedValueOnce([other]).mockResolvedValueOnce([other]).mockResolvedValue([{...row,account_id:"relinked"},other]);
    await expect(searchScopedClubProfiles(ctx,"club-a","Paul")).rejects.toThrow("authority changed");
  });
});