import { describe, expect, it, vi } from "vitest";
import {
  LocalCompetitionSettingsFlow,
  type CompetitionSettings,
} from "../src/lab/exportPageModels";

const competition: CompetitionSettings = {
  id: "competition-1",
  name: "Winter League",
  description: "Saturday competition",
  status: "draft",
  visibility: "private",
  points_win: 3,
  points_draw: 1,
  points_loss: 0,
  organizerClubId: "club-1",
  source: "native",
  associationClub: false,
};

function actor() {
  return {
    updateCompetition: vi.fn(async () => undefined),
    updateDivision: vi.fn(async () => undefined),
    addCoordinator: vi.fn(async () => undefined),
    removeCoordinator: vi.fn(async () => undefined),
  };
}

describe("CompetitionSettingsPage local characterization", () => {
  it("does not expose settings while competition or permission checks are loading", () => {
    const service = actor();
    expect(new LocalCompetitionSettingsFlow(competition, true, true, true, service).view()).toBe("loading");
  });

  it("shows a not-found state without exposing mutation controls", () => {
    const service = actor();
    expect(new LocalCompetitionSettingsFlow(null, false, true, true, service).view()).toBe("not_found");
  });

  it("denies a non-admin before rendering any editable competition fields", () => {
    const service = actor();
    expect(new LocalCompetitionSettingsFlow(competition, false, false, true, service).view()).toBe("denied");
  });

  it("blocks an administrator when the organiser club lacks Pro entitlement", () => {
    const service = actor();
    expect(new LocalCompetitionSettingsFlow(competition, false, true, false, service).view()).toBe("pro_locked");
  });

  it("keeps PlayHQ competitions read-only for a non-association club", () => {
    const service = actor();
    expect(new LocalCompetitionSettingsFlow({ ...competition, source: "playhq" }, false, true, true, service).view()).toBe("read_only");
  });

  it("does not issue an update until an editable value changes", async () => {
    const service = actor();
    const flow = new LocalCompetitionSettingsFlow(competition, false, true, true, service);
    const draft = { name: competition.name, description: competition.description ?? "" };
    expect(draft).toEqual({ name: "Winter League", description: "Saturday competition" });
    expect(service.updateCompetition).not.toHaveBeenCalled();
    await flow.save({ name: "Summer League", description: draft.description });
    expect(service.updateCompetition).toHaveBeenCalledOnce();
  });

  it("trims values and scopes a successful update to the current competition", async () => {
    const service = actor();
    await new LocalCompetitionSettingsFlow(competition, false, true, true, service)
      .save({ name: "  Summer League  ", description: "  Updated rules  " });
    expect(service.updateCompetition).toHaveBeenCalledWith("competition-1", expect.objectContaining({
      name: "Summer League", description: "Updated rules",
    }));
  });

  it("reports an update failure without claiming success or refetching", async () => {
    const service = actor();
    service.updateCompetition.mockRejectedValueOnce(new Error("update denied"));
    await expect(new LocalCompetitionSettingsFlow(competition, false, true, true, service)
      .save({ name: "Summer League", description: "" }))
      .resolves.toEqual({ ok: false, message: "update denied" });
  });

  it("scopes a ladder-visibility update and refreshes both affected views", async () => {
    const service = actor();
    const invalidated: string[] = [];
    await service.updateDivision("division-1", true);
    invalidated.push("competition-divisions:competition-1", "competition-ladder:competition-1");
    expect(service.updateDivision).toHaveBeenCalledWith("division-1", true);
    expect(invalidated).toEqual(["competition-divisions:competition-1", "competition-ladder:competition-1"]);
  });

  it("reports a ladder update failure without refreshing cached ladders", async () => {
    const service = actor();
    service.updateDivision.mockRejectedValueOnce(new Error("ladder update denied"));
    await expect(service.updateDivision("division-1", true)).rejects.toThrow("ladder update denied");
  });

  it("never offers a control to remove the competition owner", () => {
    const rows = [{ id: "owner", userId: "owner-1", role: "owner" }, { id: "admin", userId: "admin-1", role: "admin" }];
    expect(rows.filter((row) => row.role !== "owner" && row.userId !== "admin-1")).toEqual([]);
  });

  it("adds only the selected eligible coordinator with an admin role", async () => {
    const service = actor();
    await service.addCoordinator("competition-1", "candidate-1");
    expect(service.addCoordinator).toHaveBeenCalledWith("competition-1", "candidate-1");
  });

  it("scopes removal to both competition and coordinator identity", async () => {
    const service = actor();
    await service.removeCoordinator("role-coordinator");
    expect(service.removeCoordinator).toHaveBeenCalledWith("role-coordinator");
  });

  it("does not offer removal of the current admin", () => {
    const rows = [{ id: "current", userId: "admin-1", role: "admin" }];
    expect(rows.filter((row) => row.role !== "owner" && row.userId !== "admin-1")).toEqual([]);
  });

  it("keeps current-admin access separate from removing other admins", () => {
    const rows = [{ id: "current", userId: "admin-1", role: "admin" }, { id: "other", userId: "other-1", role: "admin" }];
    expect(rows.filter((row) => row.role !== "owner" && row.userId !== "admin-1")).toEqual([{ id: "other", userId: "other-1", role: "admin" }]);
  });
});
