export type NewsAudience = "club" | "teams" | "mini_league" | "competition";

export interface NewsAudienceInput {
  audience: NewsAudience;
  clubId: string;
  teamIds: string[];
  miniLeagueId: string;
  competitionId: string;
  competitionClubId?: string | null;
}

export interface NewsAudienceTarget {
  clubId: string;
  targetTeamIds: string[] | null;
  targetMiniLeagueId: string | null;
  targetCompetitionId: string | null;
}

export function resolveNewsAudienceTarget(input: NewsAudienceInput): NewsAudienceTarget {
  switch (input.audience) {
    case "club":
      if (!input.clubId) throw new Error("Select a club");
      return { clubId: input.clubId, targetTeamIds: null, targetMiniLeagueId: null, targetCompetitionId: null };
    case "teams":
      if (!input.clubId) throw new Error("Select a club");
      if (input.teamIds.length === 0) throw new Error("Select at least one team");
      return { clubId: input.clubId, targetTeamIds: input.teamIds, targetMiniLeagueId: null, targetCompetitionId: null };
    case "mini_league":
      if (!input.clubId) throw new Error("Select a club");
      if (!input.miniLeagueId) throw new Error("Select a mini league");
      return { clubId: input.clubId, targetTeamIds: null, targetMiniLeagueId: input.miniLeagueId, targetCompetitionId: null };
    case "competition":
      if (!input.competitionId || !input.competitionClubId) throw new Error("Select a competition");
      return { clubId: input.competitionClubId, targetTeamIds: null, targetMiniLeagueId: null, targetCompetitionId: input.competitionId };
  }
}