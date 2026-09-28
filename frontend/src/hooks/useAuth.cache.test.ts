import { beforeEach, describe, expect, it } from "vitest";
import { getCachedProfile, setCachedProfile } from "./useAuth";

const profile = {
  id: "user-a",
  display_name: "Alex Morgan",
  avatar_url: null,
  ignite_points: 12,
  theme_preference: "dark",
};

describe("authentication profile cache isolation", () => {
  beforeEach(() => localStorage.clear());

  it("restores a profile only for the authenticated user who owns it", () => {
    setCachedProfile(profile, "user-a");
    expect(getCachedProfile("user-a")).toEqual(profile);
  });

  it("rejects and clears another user's cached profile", () => {
    setCachedProfile(profile, "user-a");
    expect(getCachedProfile("user-b")).toBeNull();
    expect(localStorage.getItem("ignite_cached_profile")).toBeNull();
  });

  it("clears malformed and legacy cache values instead of trusting them", () => {
    localStorage.setItem("ignite_cached_profile", "not-json");
    expect(getCachedProfile("user-a")).toBeNull();
    expect(localStorage.getItem("ignite_cached_profile")).toBeNull();

    localStorage.setItem("ignite_cached_profile", JSON.stringify(profile));
    expect(getCachedProfile("user-a")).toBeNull();
    expect(localStorage.getItem("ignite_cached_profile")).toBeNull();
  });

  it("removes cached identity on logout cleanup", () => {
    setCachedProfile(profile, "user-a");
    setCachedProfile(null);
    expect(getCachedProfile("user-a")).toBeNull();
  });
});
