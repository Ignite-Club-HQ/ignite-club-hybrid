/**
 * Regression guard: email-invite club-filter defect.
 *
 * 1. `CompleteProfilePage` must never let profile submission proceed while
 *    pending email invitations are still loading (a fast signup would
 *    otherwise process an empty invitation list and lose the invited club).
 * 2. `JoinTeamPage` must switch the active club filter to the resolved
 *    `inviteClubId` via `applyInviteClubSwitch` (the sanctioned helper for
 *    user-driven invite switches) after a successful join, once only, and
 *    must not write club-filter localStorage keys directly.
 * 3. The URL-based signup intent fix must remain in place.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const completeProfile = read("src/pages/CompleteProfilePage.tsx");
const joinTeam = read("src/pages/JoinTeamPage.tsx");
const authPage = read("src/pages/AuthPage.tsx");

describe("CompleteProfilePage invitation-loading gate", () => {
  it("blocks handleSubmit while invitations are loading", () => {
    const submit = completeProfile.slice(completeProfile.indexOf("const handleSubmit"));
    const guardIdx = submit.indexOf("if (invitesLoading)");
    const savingIdx = submit.indexOf("setSaving(true)");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(savingIdx);
  });

  it("disables the Continue button while invitations are loading", () => {
    expect(completeProfile).toMatch(/disabled=\{saving \|\| invitesLoading/);
  });

  it("shows a loading indication instead of looking broken", () => {
    expect(completeProfile).toMatch(/Checking invitations/);
  });

  it("guards the button click handler defensively", () => {
    expect(completeProfile).toMatch(/Continue blocked - invitations still loading/);
  });
});

describe("JoinTeamPage club-filter switching", () => {
  it("uses the sanctioned invite-switch helper and club theme setter", () => {
    expect(joinTeam).toMatch(/from "@\/lib\/inviteClubSwitch"/);
    expect(joinTeam).toMatch(/useClubTheme\(\)/);
    expect(joinTeam).toMatch(/applyInviteClubSwitch\(user\.id, inviteClubId, setActiveClubTheme/);
  });

  it("requires both user id and club id before applying a filter", () => {
    expect(joinTeam).toMatch(/if \(!user\?\.id \|\| !inviteClubId\) return;/);
  });

  it("applies the filter at most once (no navigation loops / duplicate writes)", () => {
    expect(joinTeam).toMatch(/clubFilterSeededRef/);
    expect(joinTeam).toMatch(/if \(clubFilterSeededRef\.current\) return;/);
    expect(joinTeam.match(/applyInviteClubFilter\(\)/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it("applies the filter only after the join work has completed", () => {
    const seedIdx = joinTeam.indexOf("await applyInviteClubFilter();");
    const returnIdx = joinTeam.indexOf("return rolesToAdd;");
    expect(seedIdx).toBeGreaterThan(-1);
    expect(seedIdx).toBeLessThan(returnIdx);
  });

  it("supports club-level invites (club_id stamped without a team)", () => {
    expect(joinTeam).toMatch(/pendingInviteData\?\.club_id/);
  });

  it("does not write club-filter localStorage keys directly", () => {
    expect(joinTeam).not.toMatch(/ignite-club-theme-/);
    expect(joinTeam).not.toMatch(/__ignite_no_club__/);
  });
});

describe("previous invite signup handoff fix is preserved", () => {
  it("keeps URL-driven signup intent and does not depend on authDefaultTab", () => {
    expect(authPage).toMatch(/useSearchParams/);
    expect(authPage).toMatch(/mode/);
    expect(joinTeam).not.toMatch(/safeSessionSet\("authDefaultTab"/);
  });
});
