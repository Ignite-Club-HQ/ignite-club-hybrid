import { ArrowLeft, Trophy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { LocalCompetitionState, LocalCompetitionSummary } from "@/lab/localCompetitionService";

interface IcpCompetitionContentProps {
  competition: LocalCompetitionSummary;
  state: LocalCompetitionState | undefined;
  onBack: () => void;
  registrationTeamId: string; registrationClubId: string;
  onRegistrationTeamIdChange: (value: string) => void; onRegistrationClubIdChange: (value: string) => void;
  onRegisterTeam: () => void; registerTeamPending: boolean;
  seasonName: string; onSeasonNameChange: (value: string) => void; onCreateSeason: () => void; createSeasonPending: boolean;
  homeTeam: string; awayTeam: string; onHomeTeamChange: (value: string) => void; onAwayTeamChange: (value: string) => void; onRecordMatch: () => void; recordMatchPending: boolean;
  resultMatchId: string; homeScore: string; awayScore: string; onResultMatchIdChange: (value: string) => void; onHomeScoreChange: (value: string) => void; onAwayScoreChange: (value: string) => void; onSaveResult: () => void; saveResultPending: boolean;
  onActivateSeason: (args: { competitionId: string; status: string; revision: bigint }) => void; activateSeasonPending: boolean;
  tokenTeamId: string; tokenExpiry: string; onTokenTeamIdChange: (value: string) => void; onTokenExpiryChange: (value: string) => void; onIssueToken: () => void; issueTokenPending: boolean;
}

export function IcpCompetitionContent({
  competition, state, onBack, registrationTeamId, registrationClubId, onRegistrationTeamIdChange, onRegistrationClubIdChange, onRegisterTeam, registerTeamPending,
  seasonName, onSeasonNameChange, onCreateSeason, createSeasonPending, homeTeam, awayTeam, onHomeTeamChange, onAwayTeamChange, onRecordMatch, recordMatchPending,
  resultMatchId, homeScore, awayScore, onResultMatchIdChange, onHomeScoreChange, onAwayScoreChange, onSaveResult, saveResultPending, onActivateSeason, activateSeasonPending,
  tokenTeamId, tokenExpiry, onTokenTeamIdChange, onTokenExpiryChange, onIssueToken, issueTokenPending,
}: IcpCompetitionContentProps) {
return (
    <div className="container max-w-4xl mx-auto px-4 py-4 space-y-5">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ArrowLeft className="h-4 w-4 mr-1" /> Competitions
      </Button>
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight truncate flex items-center gap-2">
              <Trophy className="h-6 w-6 text-primary shrink-0" />
              {competition.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {[competition.season, competition.clubs?.name].filter(Boolean).join(" · ")}
            </p>
          </div>
          <Badge variant={competition.status === "active" ? "default" : "secondary"} className="capitalize">
            {competition.status}
          </Badge>
        </div>
      </header>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <h2 className="font-semibold">Register a team</h2>
            <p className="text-sm text-muted-foreground">Register an existing local team by ID. The club admin actor must manage this competition.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input value={registrationTeamId} onChange={(event) => onRegistrationTeamIdChange(event.target.value)} placeholder="Team ID" />
            <Input
              value={registrationClubId}
              onChange={(event) => onRegistrationClubIdChange(event.target.value)}
              placeholder={`Club ID (defaults to ${competition.organizer_club_id})`}
            />
          </div>
          <Button onClick={onRegisterTeam} disabled={registerTeamPending || !registrationTeamId.trim()}>
            {registerTeamPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Register team
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 space-y-2 text-sm">
          <p className="font-medium">Local ICP competition record</p>
          <p className="text-muted-foreground">
            Entries, seasons, matches, and join-token state below come from the local canister export. Division, ladder, invitation administration, and team-name resolution remain disabled until their provider-neutral workflows are wired.
          </p>
          <dl className="grid gap-2 sm:grid-cols-2 pt-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Competition ID</dt>
              <dd className="font-mono text-xs break-all">{competition.id}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Organizer club ID</dt>
              <dd className="font-mono text-xs break-all">{competition.organizer_club_id}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Revision</dt>
              <dd>{competition.revision.toString()}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 space-y-4">
          <div>
            <h2 className="font-semibold">Supported local ICP actions</h2>
            <p className="text-sm text-muted-foreground">
              These controls call the competition canister directly. Invitations, divisions, and team membership remain unavailable.
            </p>
          </div>
          <form
            className="grid gap-2 sm:grid-cols-[1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              onCreateSeason();
            }}
          >
            <Input value={seasonName} onChange={(event) => onSeasonNameChange(event.target.value)} placeholder="New season name" />
            <Button type="submit" disabled={createSeasonPending}>Create season</Button>
          </form>
          <form
            className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              onRecordMatch();
            }}
          >
            <Input value={homeTeam} onChange={(event) => onHomeTeamChange(event.target.value)} placeholder="Home team ID" />
            <Input value={awayTeam} onChange={(event) => onAwayTeamChange(event.target.value)} placeholder="Away team ID" />
            <Button type="submit" disabled={recordMatchPending}>Record match</Button>
          </form>
          <form
            className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              onSaveResult();
            }}
          >
            <Input value={resultMatchId} onChange={(event) => onResultMatchIdChange(event.target.value)} placeholder="Match ID" />
            <Input value={homeScore} onChange={(event) => onHomeScoreChange(event.target.value)} inputMode="numeric" placeholder="Home score" />
            <Input value={awayScore} onChange={(event) => onAwayScoreChange(event.target.value)} inputMode="numeric" placeholder="Away score" />
            <Button type="submit" disabled={saveResultPending}>Save result</Button>
          </form>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Seasons</h2>
              <Badge variant="outline">{state?.seasons.length ?? 0}</Badge>
            </div>
            {state?.seasons.length ? (
              <div className="space-y-2">
                {state.seasons.map((season) => (
                  <div key={`${season.competition_id}-${season.name}`} className="flex items-center justify-between gap-2 text-sm">
                    <span>{season.name}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={season.status === "active" ? "default" : "secondary"}>{season.status}</Badge>
                      {season.status !== "active" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={activateSeasonPending}
                          onClick={() => onActivateSeason({
                            competitionId: competition.id,
                            status: "active",
                            revision: season.revision,
                          })}
                        >
                          Activate
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No seasons in the local canister state.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Team entries</h2>
              <Badge variant="outline">{state?.entries.length ?? 0}</Badge>
            </div>
            {state?.entries.length ? (
              <div className="space-y-2">
                {state.entries.map((entry) => (
                  <div key={`${entry.competition_id}-${entry.team_id}`} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs">{entry.team_id}</span>
                    <Badge variant="secondary">{entry.status}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No team entries in the local canister state.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Matches</h2>
            <Badge variant="outline">{state?.matches.length ?? 0}</Badge>
          </div>
          {state?.matches.length ? (
            <div className="space-y-2">
              {state.matches.map((match) => (
                <div key={match.id} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-sm">
                  <span className="truncate">{match.home_team}</span>
                  <span className="font-mono text-xs">
                    {match.status === "scheduled" ? "vs" : `${match.home_score} - ${match.away_score}`}
                  </span>
                  <span className="truncate text-right">{match.away_team}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No matches in the local canister state.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Join tokens</h2>
            <Badge variant="outline">{state?.joinTokens.length ?? 0}</Badge>
          </div>
          <p className="text-muted-foreground">
            Issue a token for an existing team. The club admin actor must manage this competition; invitation emails and broader administration remain unavailable.
          </p>
          <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); onIssueToken(); }}>
            <Input value={tokenTeamId} onChange={(event) => onTokenTeamIdChange(event.target.value)} placeholder="Team ID" />
            <Input type="datetime-local" value={tokenExpiry} onChange={(event) => onTokenExpiryChange(event.target.value)} />
            <Button type="submit" disabled={issueTokenPending || !tokenTeamId.trim() || !tokenExpiry}>
              {issueTokenPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Issue token
            </Button>
          </form>
          {state?.joinTokens.length ? (
            <div className="space-y-1 text-xs">
              {state.joinTokens.map((token) => (
                <div key={token.id} className="flex justify-between gap-2">
                  <span className="font-mono">{token.id}</span>
                  <span>{token.team_id} · {token.used ? "used" : "available"}</span>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
