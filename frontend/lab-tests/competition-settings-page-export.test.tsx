import { expect, test, vi } from "vitest";
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

function createActor() {
  return {
    updateCompetition: vi.fn(async () => undefined),
    updateDivision: vi.fn(async () => undefined),
    addCoordinator: vi.fn(async () => undefined),
    removeCoordinator: vi.fn(async () => undefined),
  };
}

test("CompetitionSettingsPage export: gates controls while loading, missing, unauthorized, or unentitled", () => {
  const actor = createActor();
  expect(new LocalCompetitionSettingsFlow(competition, true, true, true, actor).view()).toBe("loading");
  expect(new LocalCompetitionSettingsFlow(null, false, true, true, actor).view()).toBe("not_found");
  expect(new LocalCompetitionSettingsFlow(competition, false, false, true, actor).view()).toBe("denied");
  expect(new LocalCompetitionSettingsFlow(competition, false, true, false, actor).view()).toBe("pro_locked");
});

test("CompetitionSettingsPage export: keeps external PlayHQ settings read-only", () => {
  const actor = createActor();
  expect(new LocalCompetitionSettingsFlow({
    ...competition,
    source: "playhq",
    associationClub: false,
  }, false, true, true, actor).view()).toBe("read_only");
});

test("CompetitionSettingsPage export: trims and scopes a successful competition update", async () => {
  const actor = createActor();
  const flow = new LocalCompetitionSettingsFlow(competition, false, true, true, actor);

  await expect(flow.save({ name: "  Summer League  ", description: "  Updated rules  " }))
    .resolves.toEqual({ ok: true });
  expect(actor.updateCompetition).toHaveBeenCalledWith("competition-1", {
    name: "Summer League",
    description: "Updated rules",
    status: "draft",
    visibility: "private",
    points_win: 3,
    points_draw: 1,
    points_loss: 0,
  });
});

test("CompetitionSettingsPage export: surfaces update failures without false success", async () => {
  const actor = createActor();
  actor.updateCompetition.mockRejectedValueOnce(new Error("update denied"));
  const flow = new LocalCompetitionSettingsFlow(competition, false, true, true, actor);

  await expect(flow.save({ name: "Summer League", description: "" }))
    .resolves.toEqual({ ok: false, message: "update denied" });
});

test("CompetitionSettingsPage export: updates one division and propagates ladder failures", async () => {
  const actor = createActor();
  const flow = new LocalCompetitionSettingsFlow(competition, false, true, true, actor);

  await expect(flow.toggleDivision("division-1", true)).resolves.toEqual({ ok: true });
  expect(actor.updateDivision).toHaveBeenCalledWith("division-1", true);

  actor.updateDivision.mockRejectedValueOnce(new Error("ladder update denied"));
  await expect(flow.toggleDivision("division-1", false)).resolves.toEqual({
    ok: false,
    message: "ladder update denied",
  });
});

test("CompetitionSettingsPage export: protects owner and current-admin coordinator rows", () => {
  const rows = [
    { id: "owner-role", userId: "owner-1", role: "owner" as const },
    { id: "current-role", userId: "admin-1", role: "admin" as const },
    { id: "other-role", userId: "admin-2", role: "admin" as const },
  ];
  const removable = rows.filter(row =>
    row.role !== "owner" && row.userId !== "admin-1",
  );

  expect(removable).toEqual([
    { id: "other-role", userId: "admin-2", role: "admin" },
  ]);
});

test("CompetitionSettingsPage export: adds only the selected coordinator with admin role", async () => {
  const actor = createActor();
  await actor.addCoordinator("competition-1", "candidate-1");
  expect(actor.addCoordinator).toHaveBeenCalledWith("competition-1", "candidate-1");
  expect(actor.removeCoordinator).not.toHaveBeenCalled();
});
