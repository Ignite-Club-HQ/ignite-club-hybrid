import { ChevronRight, Search, Users, X } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type ClubTeamFilter = "all" | "junior" | "senior" | "my";

export interface ClubTeamBrowserTeam {
  id: string;
  name: string | null;
  logo_url?: string | null;
  level_age?: string | null;
  description?: string | null;
  team_type?: string | null;
}

interface Subscription {
  team_id?: string | null;
  is_pro?: boolean | null;
  is_pro_football?: boolean | null;
  admin_pro_override?: boolean | null;
  admin_pro_football_override?: boolean | null;
}

interface ClubSubscription {
  is_pro?: boolean | null;
  is_pro_football?: boolean | null;
  admin_pro_override?: boolean | null;
  admin_pro_football_override?: boolean | null;
}

interface ClubTeamBrowserProps {
  clubId: string;
  classModeEnabled: boolean;
  isAdmin: boolean;
  teams: readonly ClubTeamBrowserTeam[];
  userTeamIds: readonly string[];
  teamSubscriptions: readonly Subscription[];
  clubSubscription?: ClubSubscription | null;
  teamFilter: ClubTeamFilter;
  yearLevelFilter: string;
  searchQuery: string;
  onTeamFilterChange: (filter: ClubTeamFilter) => void;
  onYearLevelFilterChange: (filter: string) => void;
  onSearchQueryChange: (query: string) => void;
}

function sortTeams(left: ClubTeamBrowserTeam, right: ClubTeamBrowserTeam) {
  return (left.name || "").localeCompare(right.name || "", undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function TeamRow({
  team,
  userTeamIds,
  teamSubscriptions,
  clubSubscription,
}: Pick<ClubTeamBrowserProps, "userTeamIds" | "teamSubscriptions" | "clubSubscription"> & {
  team: ClubTeamBrowserTeam;
}) {
  const teamSubscription = teamSubscriptions.find((subscription) => subscription.team_id === team.id);
  const clubHasPro = !!(clubSubscription?.is_pro || clubSubscription?.admin_pro_override);
  const clubHasProFootball = !!(
    clubSubscription?.is_pro_football || clubSubscription?.admin_pro_football_override
  );
  const isPro = !!(teamSubscription?.is_pro || teamSubscription?.admin_pro_override || clubHasPro);
  const isProFootball = !!(
    teamSubscription?.is_pro_football
    || teamSubscription?.admin_pro_football_override
    || clubHasProFootball
  );
  const isUserTeamMember = userTeamIds.includes(team.id);

  return (
    <Link
      to={`/teams/${team.id}`}
      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors hover:border-primary/40 hover:bg-accent/30 ${
        isUserTeamMember ? "border-primary/30 bg-primary/[0.04]" : "border-border"
      }`}
    >
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarImage src={team.logo_url || undefined} />
        <AvatarFallback className="bg-primary/15 text-primary text-sm">
          {team.name?.charAt(0)?.toUpperCase() || "T"}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{team.name}</span>
          {isUserTeamMember && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-primary text-primary shrink-0">
              My Team
            </Badge>
          )}
          {isProFootball && (
            <Badge className="bg-emerald-500 text-emerald-950 text-[10px] px-1.5 py-0 h-4 shrink-0">
              PRO FOOTBALL
            </Badge>
          )}
          {isPro && !isProFootball && (
            <Badge className="bg-yellow-500 text-yellow-950 text-[10px] px-1.5 py-0 h-4 shrink-0">
              PRO
            </Badge>
          )}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </Link>
  );
}

export function ClubTeamBrowser({
  clubId,
  classModeEnabled,
  isAdmin,
  teams,
  userTeamIds,
  teamSubscriptions,
  clubSubscription,
  teamFilter,
  yearLevelFilter,
  searchQuery,
  onTeamFilterChange,
  onYearLevelFilterChange,
  onSearchQueryChange,
}: ClubTeamBrowserProps) {
  const yearLevels = [...new Set(
    teams.flatMap((team) => team.level_age ? [team.level_age] : []),
  )].sort((left, right) => {
    const leftNumber = parseInt(left.replace(/\D/g, ""), 10) || 999;
    const rightNumber = parseInt(right.replace(/\D/g, ""), 10) || 999;
    return leftNumber - rightNumber;
  });

  const query = searchQuery.toLowerCase().trim();
  const filteredTeams = teams.filter((team) => {
    const type = team.team_type?.toLowerCase() || "";
    if (teamFilter === "junior" && type !== "junior") return false;
    if (teamFilter === "senior" && type !== "senior" && type !== "mixed") return false;
    if (teamFilter === "my" && !userTeamIds.includes(team.id)) return false;
    if (yearLevelFilter !== "all" && team.level_age !== yearLevelFilter) return false;
    return !query
      || !!team.name?.toLowerCase().includes(query)
      || !!team.level_age?.toLowerCase().includes(query)
      || !!team.description?.toLowerCase().includes(query);
  }).sort(sortTeams);

  const showGrouped = teamFilter === "all" && !query && yearLevelFilter === "all";
  const juniorTeams = showGrouped ? filteredTeams.filter((team) => team.team_type?.toLowerCase() === "junior") : [];
  const seniorTeams = showGrouped
    ? filteredTeams.filter((team) => ["senior", "mixed"].includes(team.team_type?.toLowerCase() || ""))
    : [];
  const otherTeams = showGrouped
    ? filteredTeams.filter((team) => !["junior", "senior", "mixed"].includes(team.team_type?.toLowerCase() || ""))
    : filteredTeams;
  const renderTeam = (team: ClubTeamBrowserTeam) => (
    <TeamRow
      key={team.id}
      team={team}
      userTeamIds={userTeamIds}
      teamSubscriptions={teamSubscriptions}
      clubSubscription={clubSubscription}
    />
  );

  return (
    <>
      {teams.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
            {([
              ["all", "All"],
              ["junior", "Junior"],
              ["senior", "Senior"],
              ["my", "My Teams"],
            ] as const).map(([filter, label]) => (
              <button
                key={filter}
                onClick={() => {
                  onTeamFilterChange(filter);
                  onYearLevelFilterChange("all");
                }}
                className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors min-h-[36px] ${
                  teamFilter === filter
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {teamFilter === "junior" && yearLevels.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
              <button
                onClick={() => onYearLevelFilterChange("all")}
                className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors min-h-[28px] ${
                  yearLevelFilter === "all"
                    ? "bg-secondary text-secondary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-accent"
                }`}
              >
                All Levels
              </button>
              {yearLevels.map((level) => (
                <button
                  key={level}
                  onClick={() => onYearLevelFilterChange(yearLevelFilter === level ? "all" : level)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors min-h-[28px] ${
                    yearLevelFilter === level
                      ? "bg-secondary text-secondary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={classModeEnabled ? "Search classes..." : "Search teams..."}
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              className="pl-9 pr-9"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                onClick={() => onSearchQueryChange("")}
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      )}
      {teams.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center">
            <Users className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No teams yet</p>
            {isAdmin && (
              <Link to={`/clubs/${clubId}/teams/new`} className="mt-3 inline-block">
                <Button variant="outline" size="sm">Create First Team</Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : filteredTeams.length === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-6">
          {searchQuery ? "No teams match your search" : teamFilter === "my" ? "You haven't joined any teams yet" : `No ${teamFilter} teams`}
        </p>
      ) : showGrouped ? (
        <div className="space-y-4">
          {juniorTeams.length > 0 && <TeamGroup heading="Junior Teams">{juniorTeams.map(renderTeam)}</TeamGroup>}
          {seniorTeams.length > 0 && <TeamGroup heading="Senior Teams">{seniorTeams.map(renderTeam)}</TeamGroup>}
          {otherTeams.length > 0 && (
            <TeamGroup heading={juniorTeams.length > 0 || seniorTeams.length > 0 ? "Other" : undefined}>
              {otherTeams.map(renderTeam)}
            </TeamGroup>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">{filteredTeams.map(renderTeam)}</div>
      )}
    </>
  );
}

function TeamGroup({ heading, children }: { heading?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      {heading && <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">{heading}</h3>}
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}
