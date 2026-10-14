import { describe, expect, it } from "vitest";
import { resolveNewsAudienceTarget } from "./newsAudience";

describe("resolveNewsAudienceTarget", () => {
  it("keeps club-wide news on the selected club", () => {
    expect(resolveNewsAudienceTarget({
      audience: "club", clubId: "club-1", teamIds: [], miniLeagueId: "", competitionId: "",
    })).toEqual({
      clubId: "club-1", targetTeamIds: null, targetMiniLeagueId: null, targetCompetitionId: null,
    });
  });

  it("targets selected teams without changing the post club", () => {
    expect(resolveNewsAudienceTarget({
      audience: "teams", clubId: "club-1", teamIds: ["team-1"], miniLeagueId: "", competitionId: "",
    })).toEqual({
      clubId: "club-1", targetTeamIds: ["team-1"], targetMiniLeagueId: null, targetCompetitionId: null,
    });
  });

  it("targets a mini-league only", () => {
    expect(resolveNewsAudienceTarget({
      audience: "mini_league", clubId: "club-1", teamIds: [], miniLeagueId: "league-1", competitionId: "",
    })).toEqual({
      clubId: "club-1", targetTeamIds: null, targetMiniLeagueId: "league-1", targetCompetitionId: null,
    });
  });

  it("stores competition news under its organizer club", () => {
    expect(resolveNewsAudienceTarget({
      audience: "competition", clubId: "member-club", teamIds: [], miniLeagueId: "",
      competitionId: "competition-1", competitionClubId: "organizer-club",
    })).toEqual({
      clubId: "organizer-club", targetTeamIds: null, targetMiniLeagueId: null, targetCompetitionId: "competition-1",
    });
  });

  it("rejects missing target ids before upload or persistence", () => {
    expect(() => resolveNewsAudienceTarget({
      audience: "competition", clubId: "club-1", teamIds: [], miniLeagueId: "", competitionId: "",
    })).toThrow("Select a competition");
    expect(() => resolveNewsAudienceTarget({
      audience: "teams", clubId: "club-1", teamIds: [], miniLeagueId: "", competitionId: "",
    })).toThrow("Select at least one team");
  });
});