import { beforeEach, describe, expect, it, vi } from "vitest";
import { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "../featureRouter";

const mocks = vi.hoisted(() => ({
  getProfilesByIds: vi.fn(),
  getProfile: vi.fn(),
  dispose: vi.fn(),
  searchGuardianProfiles: vi.fn(),
  hydrate: vi.fn(),
}));
vi.mock("../identityAccess", () => ({
  connectLiveIdentityAccessClientWithIdentity: vi.fn(async () => ({ client: mocks })),
}));
vi.mock("../privateProfileNames", () => ({ hydratePrivateProfileNames: mocks.hydrate }));

import { listLiveProfilesByIds, searchLiveGuardianProfiles } from "./identityAccessClient";

const caller = "mbrvi-lvde7-gdspi-hamp3-nxj43-p4tt6-at6q5-jlbit-eehve-7xqwc-wqe";
const context = {
  identity: { getPrincipal: () => Principal.fromText(caller) },
  target: {},
} as FeatureBackendContext;

describe("ICP media uploader profile resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProfilesByIds.mockResolvedValue([]);
    mocks.getProfile.mockResolvedValue({ account_id: "retained-account-id", display_name: "Paul Cranwell" });
  });

  it("resolves an uploader whose linked account retains its original ID", async () => {
    const profiles = await listLiveProfilesByIds(context, [caller, `principal:${caller}`]);
    expect(profiles).toEqual([
      { account_id: caller, display_name: "Paul Cranwell" },
      { account_id: `principal:${caller}`, display_name: "Paul Cranwell" },
    ]);
    expect(mocks.getProfile).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("keeps a batched uploader name without fetching the own profile again", async () => {
    mocks.getProfilesByIds.mockResolvedValue([{ account_id: caller, display_name: "Paul Cranwell" }]);
    expect(await listLiveProfilesByIds(context, [caller])).toEqual([
      { account_id: caller, display_name: "Paul Cranwell" },
    ]);
    expect(mocks.getProfile).not.toHaveBeenCalled();
  });

  it("never substitutes the signed-in person's profile for another uploader", async () => {
    expect(await listLiveProfilesByIds(context, ["2vxsx-fae"])).toEqual([]);
    expect(mocks.getProfile).not.toHaveBeenCalled();
  });

  it("hydrates private references at the shared display boundary with the same caller context", async () => {
    const row = { account_id: caller, display_name: "pii-display-name:v1:authority:subject" };
    mocks.getProfilesByIds.mockResolvedValue([row]);
    mocks.hydrate.mockResolvedValue([{ ...row, display_name: "Paul Cranwell" }]);
    expect(await listLiveProfilesByIds(context, [caller])).toEqual([{ ...row, display_name: "Paul Cranwell" }]);
    expect(mocks.hydrate).toHaveBeenCalledWith(context, [row]);
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it('withholds private references from generic cache reads without decrypting them', async () => {
    mocks.getProfilesByIds.mockResolvedValue([{ account_id: caller, display_name: 'pii-display-name:v1:authority:subject', avatar_ref: [] }]);
    expect(await listLiveProfilesByIds(context, [caller], { hydratePrivateNames: false })).toEqual([{ account_id: caller, display_name: null, avatar_ref: [] }]);
    expect(mocks.hydrate).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it.each(['family','competition','league'] as const)('passes exact %s audience through shared profile hydration',async kind=>{
    const row={account_id:caller,display_name:'pii-display-name:v1:authority:subject'};
    mocks.getProfilesByIds.mockResolvedValue([row]); mocks.hydrate.mockResolvedValue([{...row,display_name:'Paul Cranwell'}]);
    const options={audience:{kind,authority:Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai'),resource:'exact-resource',profile_revision:0n}};
    await listLiveProfilesByIds(context,[caller],options);
    expect(mocks.hydrate).toHaveBeenCalledWith(context,[row],options);
  });
});

describe("guardian-only full search", () => {
  const scoped = { ...context, target: { canisterIds: { club_domain: "rrkah-fqaaa-aaaaa-aaaaq-cai" } } } as FeatureBackendContext;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchGuardianProfiles.mockResolvedValue([{ account_id: "account-uuid", principal: Principal.fromText(caller), display_name: "Paul Cranwell", avatar_ref: [] }]);
  });
  it("uses the owning authority and exact child, returning a linkable principal", async () => {
    expect(await searchLiveGuardianProfiles(scoped, "child-1", " Paul ", 6)).toEqual([
      { id: caller, display_name: "Paul Cranwell", avatar_url: null },
    ]);
    expect(mocks.searchGuardianProfiles).toHaveBeenCalledWith(Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai"), "child-1", "Paul", 6);
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it("does not disclose matches after a guardian refusal", async () => {
    mocks.searchGuardianProfiles.mockRejectedValue(new Error("Verified guardian relationship required"));
    await expect(searchLiveGuardianProfiles(scoped, "child-1", "Paul", 6)).rejects.toThrow("Verified guardian relationship required");
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it("refuses a missing child before making a directory call", async () => {
    await expect(searchLiveGuardianProfiles(scoped, "", "Paul", 6)).rejects.toThrow("specific child");
    expect(mocks.searchGuardianProfiles).not.toHaveBeenCalled();
  });
});