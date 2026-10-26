import { beforeEach, describe, expect, it, vi } from "vitest";
import { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "./featureRouter";
const mocks = vi.hoisted(() => ({ read: vi.fn(), hydrate: vi.fn(), dispose: vi.fn(), connect: vi.fn() }));
vi.mock("./identityAccess", () => ({ connectLiveIdentityAccessClientWithIdentity: mocks.connect }));
vi.mock("./privateProfileNames", () => ({ hydratePrivateProfileNames: mocks.hydrate }));
import { searchScopedProfileCandidates } from "./scopedProfileSearch";
const subject = "mbrvi-lvde7-gdspi-hamp3-nxj43-p4tt6-at6q5-jlbit-eehve-7xqwc-wqe";
const authority = "rrkah-fqaaa-aaaaa-aaaaq-cai";
const ctx = { identity: { getPrincipal: () => Principal.fromText(subject) }, target: { canisterIds: { club_domain: authority } } } as FeatureBackendContext;
const row = { principal: Principal.fromText(subject), account_id: "account-id", display_name: "Paul Cranwell", avatar_ref: ["avatar"] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue({ client: { readClubProfiles: mocks.read, dispose: mocks.dispose } });
  mocks.read.mockResolvedValue([row]);
  mocks.hydrate.mockImplementation(async (_, rows) => rows);
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
    expect(mocks.hydrate).toHaveBeenCalledWith(ctx, expect.any(Array));
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
});