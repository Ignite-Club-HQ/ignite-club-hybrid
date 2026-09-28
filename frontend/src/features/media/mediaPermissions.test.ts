import { describe, expect, it } from "vitest";
import { canDeleteMediaPhoto, canShareMediaPhoto, type MediaPermissionRole } from "./mediaPermissions";

const photo = {
  uploader_id: "uploader-a",
  club_id: "club-a",
  team_id: "team-a",
};

const role = (
  roleName: string,
  clubId: string | null = null,
  teamId: string | null = null,
): MediaPermissionRole => ({ role: roleName, club_id: clubId, team_id: teamId });

const allowed = (options: Partial<Parameters<typeof canDeleteMediaPhoto>[0]> = {}) =>
  canDeleteMediaPhoto({
    photo,
    userId: "user-a",
    isAppAdmin: false,
    roles: [],
    ...options,
  });

describe("Media permissions", () => {
  it("allows an app admin regardless of photo scope", () => {
    expect(allowed({ isAppAdmin: true, userId: undefined })).toBe(true);
  });

  it("allows the uploader but not a different ordinary member", () => {
    expect(allowed({ userId: "uploader-a", roles: [role("member", "club-a")] })).toBe(true);
    expect(allowed({ userId: "member-b", roles: [role("member", "club-a")] })).toBe(false);
  });

  it("allows a club admin only within the matching club", () => {
    expect(allowed({ roles: [role("club_admin", "club-a")] })).toBe(true);
    expect(allowed({ roles: [role("club_admin", "club-b")] })).toBe(false);
  });

  it("allows a team admin only for a photo assigned to their exact team", () => {
    expect(allowed({ roles: [role("team_admin", "club-a", "team-a")] })).toBe(true);
    expect(allowed({ roles: [role("team_admin", "club-a", "team-b")] })).toBe(false);
  });

  it("does not let a team admin delete a club-level photo", () => {
    expect(allowed({
      photo: { ...photo, team_id: null },
      roles: [role("team_admin", "club-a", "team-a")],
    })).toBe(false);
  });

  it.each(["committee_member", "coach", "member", "parent", "player"])(
    "does not grant deletion merely because a %s belongs to the same club or team",
    (roleName) => {
      expect(allowed({ roles: [role(roleName, "club-a", "team-a")] })).toBe(false);
    },
  );

  it("fails closed with no roles and no matching uploader", () => {
    expect(allowed({ roles: undefined })).toBe(false);
    expect(allowed({ roles: [] })).toBe(false);
  });

  it("allows sharing only for an authenticated viewer", () => {
    expect(canShareMediaPhoto("user-a")).toBe(true);
    expect(canShareMediaPhoto(undefined)).toBe(false);
  });
});
