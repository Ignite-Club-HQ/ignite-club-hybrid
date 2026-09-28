import { describe, expect, it } from "vitest";
import { resolvePitchBoardActions } from "./pitchBoardActionPolicy";

const base = {
  eventType: "game", hasTeam: true, supportedSport: true, accessLoading: false,
  canAccess: true, membersLoading: false, hasTeamMembers: true,
  canViewReadOnly: false, nowMs: 1_000_000,
};
const atMinutes = (minutes: number) => ({ ...base, eventTimeMs: base.nowMs + minutes * 60_000 });

describe("PitchBoard action policy", () => {
  it.each([
    [121, "prepare"], [120, "start"], [1, "start"], [0, "open"], [-180, "open"], [-181, null],
  ] as const)("maps %s minutes until kickoff to %s", (minutes, primary) => {
    expect(resolvePitchBoardActions(atMinutes(minutes)).primary).toBe(primary);
  });
  it("shows access loading only for a supported team game", () => {
    expect(resolvePitchBoardActions({ ...atMinutes(60), accessLoading: true }).showLoading).toBe(true);
    expect(resolvePitchBoardActions({ ...atMinutes(60), accessLoading: true, eventType: "social" }).showLoading).toBe(false);
    expect(resolvePitchBoardActions({ ...atMinutes(60), membersLoading: true }).showLoading).toBe(true);
  });
  it("requires resolved access and members for a manager action", () => {
    expect(resolvePitchBoardActions({ ...atMinutes(60), accessLoading: true }).primary).toBeNull();
    expect(resolvePitchBoardActions({ ...atMinutes(60), canAccess: false }).primary).toBeNull();
    expect(resolvePitchBoardActions({ ...atMinutes(60), hasTeamMembers: false }).primary).toBeNull();
  });
  it("preserves the independently authorized read-only action", () => {
    expect(resolvePitchBoardActions({ ...atMinutes(-10), canAccess: false, canViewReadOnly: true }).showReadOnly).toBe(true);
    expect(resolvePitchBoardActions({ ...atMinutes(-10), canViewReadOnly: true, hasTeamMembers: false }).showReadOnly).toBe(false);
  });
});
