import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync("src/pages/PlayerStatsReportPage.tsx", "utf8");
const view = readFileSync("src/components/reports/PlayerStatsReportView.tsx", "utf8");
const extras = readFileSync("src/components/reports/playerStatsReportExtras.ts", "utf8");

describe("player stats game filtering", () => {
  it("only admits game events to the picker and date-range stats", () => {
    expect(page).toMatch(/from\("events"\)[\s\S]*?eq\("team_id", selectedTeamId\)\.eq\("type", "game"\)/);
    expect(view).toMatch(/from\("events"\)[\s\S]*?eq\("team_id", teamId\)[\s\S]*?eq\("type", "game"\)/);
  });

  it("only builds match rows and score joins from game events", () => {
    expect(extras).toMatch(/from\("events"\)[\s\S]*?eq\("team_id", teamId\)[\s\S]*?eq\("type", "game"\)/);
  });
});