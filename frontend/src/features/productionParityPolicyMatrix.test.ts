import { describe, expect, it } from "vitest";
import { dutyTeamBadgeAudience } from "@/components/events/MyTeamDutyTag";
import { makeCompetitionFixtureVisibility } from "@/features/events/competitionFixtureVisibility";
import {
  DEFAULT_TEAM_RSVP_AUDIENCE,
  isParentFirstEvent,
  resolveRsvpAudience,
  shouldPromptParent,
  shouldPromptPlayer,
  shouldPromptSelf,
} from "@/lib/rsvpAudience";

const rsvpValues = [
  undefined,
  null,
  "",
  "unknown",
  "players_only",
  "players_and_parents",
  "parents_only",
] as const;
const validAudiences = ["players_only", "players_and_parents", "parents_only"] as const;

const subsets = (values: string[]) =>
  Array.from({ length: 1 << values.length }, (_, mask) =>
    values.filter((_, index) => (mask & (1 << index)) !== 0),
  );

describe("production parity policy matrices", () => {
  it.each(rsvpValues.flatMap((eventAudience) => rsvpValues.map((teamDefault) => ({ eventAudience, teamDefault }))))(
    "resolves RSVP fallback for event=%j and team=%j",
    ({ eventAudience, teamDefault }) => {
      const expected = validAudiences.includes(eventAudience as (typeof validAudiences)[number])
        ? eventAudience
        : validAudiences.includes(teamDefault as (typeof validAudiences)[number])
          ? teamDefault
          : DEFAULT_TEAM_RSVP_AUDIENCE;
      expect(resolveRsvpAudience(eventAudience, teamDefault)).toBe(expected);
    },
  );

  it.each(validAudiences.flatMap((audience) => [false, true].map((adultPlayer) => ({ audience, adultPlayer }))))(
    "maps RSVP prompts for %s with adultPlayer=%s",
    ({ audience, adultPlayer }) => {
      const playerExpected = audience === "players_only" || audience === "players_and_parents";
      const parentExpected = audience === "parents_only" || audience === "players_and_parents";
      expect(shouldPromptPlayer(audience)).toBe(playerExpected);
      expect(shouldPromptParent(audience)).toBe(parentExpected);
      expect(shouldPromptSelf(audience, adultPlayer)).toBe(parentExpected || (playerExpected && adultPlayer));
    },
  );

  it.each([null, "team-1"].flatMap((teamId) => [null, "social", "training", "game"].map((type) => ({ teamId, type }))))(
    "keeps parent-first events limited to club-wide socials: %j",
    ({ teamId, type }) => {
      expect(isParentFirstEvent({ team_id: teamId, type })).toBe(!teamId && type === "social");
    },
  );

  const teams = ["team-1", "team-2", "team-3"];
  const teamSets = subsets(teams);
  const clubs = ["club-1", "club-2"];
  const clubSets = subsets(clubs);
  const dutyCases = [null, ...teams].flatMap((dutyTeamId) =>
    clubs.map((clubId) => ({ dutyTeamId, clubId })),
  );

  it.each(dutyCases.flatMap((event) =>
    teamSets.flatMap((teamIds) => clubSets.map((leagueAdminClubIds) => ({ event, teamIds, leagueAdminClubIds }))),
  ))(
    "restricts duty badges to the assigned team or its club league admin: %j",
    ({ event, teamIds, leagueAdminClubIds }) => {
      const expected = !event.dutyTeamId
        ? null
        : teamIds.includes(event.dutyTeamId)
          ? "member"
          : leagueAdminClubIds.includes(event.clubId)
            ? "league_admin"
            : null;
      expect(dutyTeamBadgeAudience(
        { duty_team_id: event.dutyTeamId, club_id: event.clubId },
        { teamIds, leagueAdminClubIds },
      )).toBe(expected);
    },
  );

  const matchIds = ["match-1", "match-2"];
  const matchSets = subsets(matchIds);
  it.each(teamSets.flatMap((teamIds) => matchSets.map((viewableMatchIds) => ({ teamIds, viewableMatchIds }))))(
    "keeps own fixtures, deduplicates visible matches, and hides other rows: %j",
    ({ teamIds, viewableMatchIds }) => {
      const events = [
        ...matchIds.flatMap((matchId) => teams.map((teamId) => ({ id: `${matchId}-${teamId}`, team_id: teamId, competition_match_id: matchId }))),
        { id: "unrelated-match", team_id: "team-4", competition_match_id: "match-3" },
        { id: "unscoped", team_id: "team-4", competition_match_id: null },
        { id: "club-wide", team_id: null, competition_match_id: "match-1" },
      ];
      const visible = makeCompetitionFixtureVisibility(teamIds, viewableMatchIds, events);
      const visibleIds = events.filter(visible).map((event) => event.id);

      const memberTeams = new Set(teamIds);
      const visibleMatches = new Set(viewableMatchIds);
      const covered = new Set(
        events
          .filter((event) => event.team_id && memberTeams.has(event.team_id) && event.competition_match_id)
          .map((event) => event.competition_match_id!),
      );
      const expected: string[] = [];
      for (const event of events) {
        if (event.team_id && memberTeams.has(event.team_id)) {
          expected.push(event.id);
          continue;
        }
        if (!event.team_id || !event.competition_match_id || !visibleMatches.has(event.competition_match_id) || covered.has(event.competition_match_id)) continue;
        covered.add(event.competition_match_id);
        expected.push(event.id);
      }
      expect(visibleIds).toEqual(expected);
    },
  );
});