import { idlFactory } from './bindings/competition_domain/declarations/competition_domain.did.js';
import type {
  Competition as IcpCompetition,
  JoinToken,
  Match,
  Season,
  TeamEntry,
  _SERVICE,
} from './bindings/competition_domain/declarations/competition_domain.did.js';
import { connectLocalDomainActor } from './localActor';

export interface LocalCompetitionSummary {
  id: string;
  name: string;
  sport: string | null;
  season: string;
  status: string;
  visibility: string;
  organizer_club_id: string;
  source: string;
  last_synced_at: string | null;
  clubs: { name: string } | null;
  competition_entries: unknown[];
  revision: bigint;
}

export interface LocalCompetitionEntry extends TeamEntry {}
export interface LocalCompetitionSeason extends Season {}
export interface LocalCompetitionMatch extends Match {}

export interface LocalCompetitionState {
  competition: LocalCompetitionSummary;
  entries: LocalCompetitionEntry[];
  seasons: LocalCompetitionSeason[];
  matches: LocalCompetitionMatch[];
  joinTokens: JoinToken[];
}

function convertCompetition(competition: IcpCompetition): LocalCompetitionSummary {
  return {
    id: competition.id,
    name: competition.name,
    sport: null,
    season: competition.season,
    status: competition.status,
    visibility: 'local',
    organizer_club_id: competition.club_id,
    source: 'icp',
    last_synced_at: null,
    clubs: competition.club_id ? { name: 'ICP club' } : null,
    competition_entries: [],
    revision: competition.revision,
  };
}

export function isLocalCompetitionCanisterUnavailable(error: unknown): boolean {
  return error instanceof Error && /competition domain canister is not configured/i.test(error.message);
}

export function createCompetitionDomainClient(
  actor: Pick<
    _SERVICE,
    'export_state' | 'create_competition' | 'claim_join_token' | 'issue_join_token' | 'create_season' | 'set_season_status' | 'record_match' | 'set_match_result' | 'register_team'
  >,
) {
  const readState = async () => {
    const result = await actor.export_state();
    if ('Err' in result) throw new Error(result.Err);
    return result.Ok;
  };
  const getCompetitionState = async (id: string): Promise<LocalCompetitionState> => {
    const state = await readState();
    const competition = state.competitions.find((candidate) => candidate.id === id);
    if (!competition) throw new Error('Competition not found');
    return {
      competition: convertCompetition(competition),
      entries: state.entries.filter((entry) => entry.competition_id === id),
      seasons: state.seasons.filter((season) => season.competition_id === id),
      matches: state.matches.filter((match) => match.competition_id === id),
      joinTokens: state.tokens.filter((token) => token.competition_id === id),
    };
  };

  return {
    async listCompetitions(): Promise<LocalCompetitionSummary[]> {
      const state = await readState();
      return state.competitions.map(convertCompetition);
    },
    async getCompetitionState(id: string): Promise<LocalCompetitionState> {
      return getCompetitionState(id);
    },
    async getCompetition(id: string): Promise<LocalCompetitionSummary> {
      return (await getCompetitionState(id)).competition;
    },
    async createCompetition(clubId: string, name: string, season: string): Promise<LocalCompetitionSummary> {
      const result = await actor.create_competition(clubId, name, season);
      if ('Err' in result) throw new Error(result.Err);
      return convertCompetition(result.Ok);
    },
    async claimJoinToken(token: string): Promise<string> {
      const result = await actor.claim_join_token(token);
      if ('Err' in result) throw new Error(result.Err);
      return result.Ok;
    },
    async issueJoinToken(competitionId: string, teamId: string, expiresAtMs: bigint): Promise<JoinToken> {
      const result = await actor.issue_join_token(competitionId, teamId, expiresAtMs);
      if ('Err' in result) throw new Error(result.Err);
      return result.Ok;
    },
    async registerTeam(competitionId: string, teamId: string, clubId: string): Promise<TeamEntry> {
      const result = await actor.register_team(competitionId, teamId, clubId);
      if ('Err' in result) throw new Error(result.Err);
      return result.Ok;
    },
    async createSeason(competitionId: string, name: string): Promise<Season> {
      const result = await actor.create_season(competitionId, name);
      if ('Err' in result) throw new Error(result.Err);
      return result.Ok;
    },
    async setSeasonStatus(seasonId: string, status: string, revision: bigint): Promise<Season> {
      const result = await actor.set_season_status(seasonId, status, revision);
      if ('Err' in result) throw new Error(result.Err);
      return result.Ok;
    },
    async recordMatch(competitionId: string, homeTeam: string, awayTeam: string): Promise<Match> {
      const result = await actor.record_match(competitionId, homeTeam, awayTeam);
      if ('Err' in result) throw new Error(result.Err);
      return result.Ok;
    },
    async setMatchResult(matchId: string, homeScore: number, awayScore: number, revision: bigint): Promise<Match> {
      const result = await actor.set_match_result(matchId, homeScore, awayScore, revision);
      if ('Err' in result) throw new Error(result.Err);
      return result.Ok;
    },
  };
}

async function connectCompetitionActor(persona: string): Promise<_SERVICE> {
  return connectLocalDomainActor<_SERVICE>(persona, 'competition_domain', 'competition', idlFactory);
}

export async function listLocalCompetitions(persona: string): Promise<LocalCompetitionSummary[]> {
  return createCompetitionDomainClient(await connectCompetitionActor(persona)).listCompetitions();
}

export async function getLocalCompetition(persona: string, id: string): Promise<LocalCompetitionSummary> {
  return (await getLocalCompetitionState(persona, id)).competition;
}

export async function getLocalCompetitionState(persona: string, id: string): Promise<LocalCompetitionState> {
  return createCompetitionDomainClient(await connectCompetitionActor(persona)).getCompetitionState(id);
}

export async function createLocalCompetition(
  persona: string,
  clubId: string,
  name: string,
  season: string,
): Promise<LocalCompetitionSummary> {
  return createCompetitionDomainClient(await connectCompetitionActor(persona)).createCompetition(clubId, name, season);
}

export async function claimLocalCompetitionJoinToken(persona: string, token: string): Promise<string> {
  return createCompetitionDomainClient(await connectCompetitionActor(persona)).claimJoinToken(token);
}

export async function registerLocalCompetitionTeam(
  persona: string,
  competitionId: string,
  teamId: string,
  clubId: string,
): Promise<TeamEntry> {
  return createCompetitionDomainClient(await connectCompetitionActor(persona)).registerTeam(competitionId, teamId, clubId);
}

export async function issueLocalCompetitionJoinToken(
  persona: string,
  competitionId: string,
  teamId: string,
  expiresAtMs: bigint,
): Promise<JoinToken> {
  return createCompetitionDomainClient(await connectCompetitionActor(persona)).issueJoinToken(competitionId, teamId, expiresAtMs);
}

export async function createLocalCompetitionSeason(persona: string, competitionId: string, name: string): Promise<Season> {
  return createCompetitionDomainClient(await connectCompetitionActor(persona)).createSeason(competitionId, name);
}

export async function setLocalCompetitionSeasonStatus(
  persona: string,
  competitionId: string,
  status: string,
  revision: bigint,
): Promise<Season> {
  return createCompetitionDomainClient(await connectCompetitionActor(persona)).setSeasonStatus(competitionId, status, revision);
}

export async function recordLocalCompetitionMatch(
  persona: string,
  competitionId: string,
  homeTeam: string,
  awayTeam: string,
): Promise<Match> {
  return createCompetitionDomainClient(await connectCompetitionActor(persona)).recordMatch(competitionId, homeTeam, awayTeam);
}

export async function setLocalCompetitionMatchResult(
  persona: string,
  matchId: string,
  homeScore: number,
  awayScore: number,
  revision: bigint,
): Promise<Match> {
  return createCompetitionDomainClient(await connectCompetitionActor(persona)).setMatchResult(matchId, homeScore, awayScore, revision);
}
