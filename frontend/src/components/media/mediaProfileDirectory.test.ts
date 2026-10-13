import { describe, expect, it } from "vitest";
import { mediaProfileDirectory } from "./mediaProfileDirectory";

describe("media uploader profile directory", () => {
  it("preserves each uploader's saved photo alongside their name", () => {
    const photo = "https://photos-cai.raw.icp0.io/avatars/paul.jpg";
    const profiles = mediaProfileDirectory([
      { account_id: "paul", display_name: "Paul Cranwell", avatar_ref: [photo] },
      { account_id: "clubmate", display_name: "Alex", avatar_ref: ["blob:alex-photo"] },
    ]);
    expect(profiles.get("paul")).toEqual({ display_name: "Paul Cranwell", avatar_url: photo });
    expect(profiles.get("clubmate")?.avatar_url).toBe("blob:alex-photo");
  });

  it("returns no photo for members without a saved avatar", () => {
    const profiles = mediaProfileDirectory([
      { account_id: "member", display_name: "Member", avatar_ref: [] },
    ]);
    expect(profiles.get("member")?.avatar_url).toBeNull();
    expect(profiles.get("unknown")).toBeUndefined();
  });
});