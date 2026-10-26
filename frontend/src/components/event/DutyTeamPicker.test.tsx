import { describe, expect, it } from "vitest";
import { eventDutyTeamIds, filterDutyTeamOptions, scopeDutyTeamOptions } from "./DutyTeamPicker";

describe("event-associated duty teams", () => {
  const teams = [{ id: "u9", name: "U9" }, { id: "u10", name: "U10" }, { id: "u11", name: "U11" }];
  it("offers only the event's single team", () => {
    expect(scopeDutyTeamOptions(teams, eventDutyTeamIds("u9", ["u10"]))).toEqual([teams[0]]);
  });
  it("offers only selected audience teams", () => {
    expect(scopeDutyTeamOptions(teams, eventDutyTeamIds(null, ["u9", "u10", "u9"]))).toEqual([teams[0], teams[1]]);
  });
  it("does not widen an empty restricted audience", () => {
    expect(scopeDutyTeamOptions(teams, eventDutyTeamIds(null, []))).toEqual([]);
  });
  it("retains club teams for all-club events", () => {
    expect(scopeDutyTeamOptions(teams, eventDutyTeamIds(null, null))).toEqual(teams);
  });
});

describe("filterDutyTeamOptions", () => {
  it("keeps live teams whose Candid deleted_at_ms optional is an empty array", () => {
    const options = filterDutyTeamOptions([
      { id: "team-live", name: "U9 Foxes", is_active: true, archived: false, is_shell: false, deleted_at_ms: [] },
      { id: "team-no-field", name: "U10 Hawks", is_active: true, archived: false, is_shell: false },
    ]);
    expect(options).toEqual([
      { id: "team-live", name: "U9 Foxes" },
      { id: "team-no-field", name: "U10 Hawks" },
    ]);
  });

  it("drops deleted, archived, shell and inactive teams", () => {
    const options = filterDutyTeamOptions([
      { id: "team-deleted", name: "Old", is_active: true, archived: false, is_shell: false, deleted_at_ms: [1n] },
      { id: "team-archived", name: "Archived", is_active: true, archived: true, is_shell: false, deleted_at_ms: [] },
      { id: "team-shell", name: "Shell", is_active: true, archived: false, is_shell: true, deleted_at_ms: [] },
      { id: "team-inactive", name: "Inactive", is_active: false, archived: false, is_shell: false, deleted_at_ms: [] },
    ]);
    expect(options).toEqual([]);
  });
});
