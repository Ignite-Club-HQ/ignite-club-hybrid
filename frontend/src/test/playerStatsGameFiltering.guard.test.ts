import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const extras = readFileSync("src/components/reports/playerStatsReportExtras.ts", "utf8");

describe("player stats game filtering", () => {
  it("only builds match rows and score joins from game events", () => {
    expect(extras).toMatch(/from\("events"\)[\s\S]*?eq\("team_id", teamId\)[\s\S]*?eq\("type", "game"\)/);
  });
});