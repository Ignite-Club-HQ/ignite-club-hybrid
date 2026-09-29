import { beforeEach, describe, expect, it } from "vitest";
import {
  cacheIcpIdentityProfile,
  clearIcpIdentityProfileCache,
  getCachedIcpIdentityProfile,
  type IcpIdentityProfile,
} from "./identityProfileCache";

const profile: IcpIdentityProfile = {
  accountId: "principal-1",
  displayName: "Paul",
  avatarRef: null,
  roles: [],
  profileMissing: false,
};

describe("identityProfileCache", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a profile per principal", () => {
    cacheIcpIdentityProfile("principal-1", profile);
    expect(getCachedIcpIdentityProfile("principal-1")).toEqual(profile);
    expect(getCachedIcpIdentityProfile("principal-2")).toBeNull();
  });

  it("returns null for corrupt cache entries and clears them", () => {
    localStorage.setItem("ignite_icp_identity_profile:principal-1", "not-json");
    expect(getCachedIcpIdentityProfile("principal-1")).toBeNull();
    expect(localStorage.getItem("ignite_icp_identity_profile:principal-1")).toBeNull();
  });

  it("clears one principal or every cached profile", () => {
    cacheIcpIdentityProfile("principal-1", profile);
    cacheIcpIdentityProfile("principal-2", { ...profile, accountId: "principal-2" });
    clearIcpIdentityProfileCache("principal-1");
    expect(getCachedIcpIdentityProfile("principal-1")).toBeNull();
    expect(getCachedIcpIdentityProfile("principal-2")).not.toBeNull();
    clearIcpIdentityProfileCache();
    expect(getCachedIcpIdentityProfile("principal-2")).toBeNull();
  });
});
