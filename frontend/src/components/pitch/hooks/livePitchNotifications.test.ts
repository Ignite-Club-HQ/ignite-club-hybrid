import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureBackendContext } from "@/live/featureRouter";
import { livePitchRecipients } from "./livePitchNotifications";
const m = vi.hoisted(() => ({ team: vi.fn(), flags: vi.fn(), grants: vi.fn(), events: vi.fn(), duties: vi.fn(), groups: vi.fn(), groupDuties: vi.fn() }));
vi.mock("@/live/features/club", () => ({ getLiveTeam: m.team, getLiveTeamPitchNotify: m.flags }));
vi.mock("@/live/features/membership", () => ({ listLiveTeamRoleGrants: m.grants }));
vi.mock("@/live/features/events", () => ({ listLiveEvents: m.events, listLiveDuties: m.duties, listLiveEventGroups: m.groups, listLiveGroupDuties: m.groupDuties }));
const ctx = {} as FeatureBackendContext;
beforeEach(() => {
  vi.clearAllMocks();
  m.team.mockResolvedValue([{ club_id: "club-1" }]);
  m.events.mockResolvedValue([{ id: "event-1", club_id: "club-1", title: "Match" }]);
  m.flags.mockResolvedValue({ coach: true, team_admin: true, subs_manager: true });
  m.grants.mockResolvedValue([{ role: "coach", account_id: "coach" }, { role: "team_admin", account_id: "admin" }, { role: "player", account_id: "player" }, { role: "coach", account_id: "self" }]);
  m.duties.mockResolvedValue([{ duty: "Subs Manager", account_id: "subs" }, { duty: "Subs Manager", account_id: "coach" }, { duty: "Referee", account_id: "ref" }]);
  m.groups.mockResolvedValue([{ id: "group-1" }]);
  m.groupDuties.mockResolvedValue([{ duty: "Referee", account_id: ["ref"] }, { duty: "Subs Manager", account_id: ["subs"] }, { duty: "Subs Manager", account_id: [] }, { duty: "Scorer", account_id: ["scorer"] }]);
});
describe("live pitch alert audiences", () => {
  it("links notify only team admins, coaches and the linked match Subs Manager once, excluding the author", async () => {
    const result = await livePitchRecipients(ctx, "team-1", "event-1", "self", false, true);
    expect(result.userIds).toEqual(["coach", "admin", "subs"]);
    expect(result.clubId).toBe("club-1");
    expect(m.duties).toHaveBeenCalledWith(ctx, "event-1");
    expect(m.events).toHaveBeenCalledWith(ctx, null, "team-1");
  });
  it("disabled link preferences remove the corresponding roles and Subs Manager", async () => {
    m.flags.mockResolvedValue({ coach: false, team_admin: true, subs_manager: false });
    expect((await livePitchRecipients(ctx, "team-1", "event-1", "self", false, true)).userIds).toEqual(["admin"]);
  });
  it("formations preserve the author plus staff and Subs Manager without duplicate recipients", async () => {
    expect((await livePitchRecipients(ctx, "team-1", "event-1", "self", true, false)).userIds).toEqual(["self", "coach", "admin", "subs"]);
    expect(m.flags).not.toHaveBeenCalled();
  });
  it("unlinked formation changes do not invent match duty holders", async () => {
    expect((await livePitchRecipients(ctx, "team-1", null, "self", true, false)).userIds).toEqual(["self", "coach", "admin"]);
    expect(m.duties).not.toHaveBeenCalled();
  });
  it("group boards notify only the specific match group's referee and Subs Manager", async () => {
    expect((await livePitchRecipients(ctx, "event-group-group-1", "event-1", "self", false, true)).userIds).toEqual(["ref", "subs"]);
    expect(m.groupDuties).toHaveBeenCalledWith(ctx, "group-1");
    expect(m.grants).not.toHaveBeenCalled();
  });
  it("rejects a group from a different match before reading its duties", async () => {
    m.groups.mockResolvedValue([{ id: "other-group" }]);
    await expect(livePitchRecipients(ctx, "event-group-group-1", "event-1", "self", false, true)).rejects.toThrow("not in the linked match");
    expect(m.groupDuties).not.toHaveBeenCalled();
  });
  it("rejects a linked event outside the team before reading recipient roles", async () => {
    m.events.mockResolvedValue([]);
    await expect(livePitchRecipients(ctx, "team-1", "other-event", "self", false, true)).rejects.toThrow("not in this pitch-board scope");
    expect(m.grants).not.toHaveBeenCalled();
  });
  it("never substitutes a team id for a missing club id", async () => {
    m.team.mockResolvedValue([]);
    await expect(livePitchRecipients(ctx, "team-1", null, "self", true, false)).rejects.toThrow("no club scope");
  });
});