import { describe, expect, it } from "vitest";
import { competitionFixtureKeys } from "./queryKeys";

describe("competitionFixtureKeys", () => {
  it("preserves the established fixture cache key", () => {
    expect(competitionFixtureKeys.matches("competition-1")).toEqual([
      "competition-matches",
      "competition-1",
    ]);
  });

  it("preserves the established linked-team cache key", () => {
    expect(competitionFixtureKeys.linkedTeams("competition-1", 3)).toEqual([
      "competition-linked-teams",
      "competition-1",
      3,
    ]);
  });
});
