import { describe, expect, it } from "vitest";
import { buildTeamPitchSettingsPayload } from "./teamPitchSettingsPayload";

describe("buildTeamPitchSettingsPayload", () => {
  it("falls back to defaults when there is no current subscription row", () => {
    const payload = buildTeamPitchSettingsPayload("team-1", null, 45, {});
    expect(payload).toEqual({
      team_id: "team-1",
      team_size: 7,
      formation: null,
      minutes_per_half: 45,
      rotation_speed: 1,
      disable_auto_subs: false,
      disable_position_swaps: false,
      is_pro: false,
      is_pro_football: false,
    });
  });

  it("preserves untouched fields from the current row", () => {
    const current = {
      team_size: 11,
      formation: "4-4-2",
      minutes_per_half: 40,
      rotation_speed: 2,
      disable_auto_subs: true,
      disable_position_swaps: true,
      is_pro: true,
      is_pro_football: true,
    };
    const payload = buildTeamPitchSettingsPayload("team-1", current, 45, { rotation_speed: 3 });
    expect(payload).toEqual({
      team_id: "team-1",
      team_size: 11,
      formation: "4-4-2",
      minutes_per_half: 40,
      rotation_speed: 3,
      disable_auto_subs: true,
      disable_position_swaps: true,
      is_pro: true,
      is_pro_football: true,
    });
  });

  it("allows explicitly clearing the formation to null", () => {
    const payload = buildTeamPitchSettingsPayload(
      "team-1",
      { formation: "4-4-2" },
      45,
      { formation: null },
    );
    expect(payload.formation).toBeNull();
  });
});
