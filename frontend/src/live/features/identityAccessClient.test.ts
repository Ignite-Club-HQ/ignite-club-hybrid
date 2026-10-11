import { beforeEach, describe, expect, it, vi } from "vitest";
import { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "../featureRouter";

const mocks = vi.hoisted(() => ({
  getProfilesByIds: vi.fn(),
  getProfile: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("../identityAccess", () => ({
  connectLiveIdentityAccessClientWithIdentity: vi.fn(async () => ({ client: mocks })),
}));

import { listLiveProfilesByIds } from "./identityAccessClient";

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
});