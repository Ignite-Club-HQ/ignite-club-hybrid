import { describe, expect, it } from "vitest";
import { calculateVaultStorageBreakdown } from "./vaultStorageBreakdown";

describe("calculateVaultStorageBreakdown", () => {
  it("keeps photo estimates, file classifications, and scope buckets aligned", () => {
    expect(
      calculateVaultStorageBreakdown({
        photos: [
          { file_size: null, team_id: "team-a", mini_league_id: null },
          { file_size: 100, team_id: null, mini_league_id: "league-a" },
        ],
        files: [
          { file_size: 200, team_id: "team-a", mini_league_id: null, name: "poster.PNG" },
          { file_size: 300, team_id: "team-b", mini_league_id: null, name: "rules.pdf" },
          { file_size: 400, team_id: null, mini_league_id: "league-a", name: "sheet.csv" },
        ],
        teams: [
          { id: "team-a", name: "A Team" },
          { id: "team-b", name: "B Team" },
        ],
        miniLeagues: [{ id: "league-a", name: "Mini League A" }],
      }),
    ).toEqual({
      photos: 512000 + 100 + 200,
      documents: 300 + 400,
      total: 512000 + 100 + 200 + 300 + 400,
      byTeam: [
        {
          teamId: "team-a",
          teamName: "A Team",
          size: 512000 + 200,
          photosSize: 512000 + 200,
          documentsSize: 0,
        },
        {
          teamId: "team-b",
          teamName: "B Team",
          size: 300,
          photosSize: 0,
          documentsSize: 300,
        },
      ],
      byMiniLeague: [
        {
          miniLeagueId: "league-a",
          miniLeagueName: "Mini League A",
          size: 100 + 400,
          photosSize: 100,
          documentsSize: 400,
        },
      ],
    });
  });

  it("uses stable fallback names and omits empty buckets", () => {
    expect(
      calculateVaultStorageBreakdown({
        photos: [],
        files: [
          { file_size: 0, team_id: "unknown-team", mini_league_id: null, name: "empty.txt" },
          { file_size: 10, team_id: null, mini_league_id: null, name: "club.bin" },
        ],
        teams: [],
        miniLeagues: [],
      }).byTeam,
    ).toEqual([
      {
        teamId: null,
        teamName: "Club-level",
        size: 10,
        photosSize: 0,
        documentsSize: 10,
      },
    ]);
  });
});
