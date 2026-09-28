import { useState, useCallback, Suspense } from "react";
import { getCurrentGameSeconds } from "@/components/pitch/timerUtils";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Timer, ExternalLink, LayoutGrid, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

// Lazy load PitchBoard for performance
const PitchBoard = lazyWithRetry(() => import("@/components/pitch/PitchBoard"));

interface TimerState {
  minutesPerHalf: number;
  currentHalf: 1 | 2;
  elapsedSeconds: number;
  isRunning: boolean;
  lastUpdateTime: number;
  isGameFinished?: boolean;
}

interface ActiveMiniLeagueMatch {
  id: string;
  name: string;
  eventId: string;
  eventTitle: string;
  leagueId: string;
  leagueName: string;
  clubId: string;
  timerState: TimerState | null;
  pitchState: any;
  teamAColor: string;
  teamBColor: string;
  players: { id: string; name: string; team: "a" | "b" | null }[];
  teamAScore: number;
  teamBScore: number;
  isAdmin: boolean;
  isReferee: boolean;
  minutesPerHalf: number;
}

interface MiniLeagueGameWidgetsProps {
  activeClubFilter?: string | null;
}

function LoadingOverlay() {
  return (
    <div className="fixed inset-0 z-[60] bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading Pitch Board...</p>
      </div>
    </div>
  );
}

export function MiniLeagueGameWidgets({ activeClubFilter }: MiniLeagueGameWidgetsProps) {
  const { user } = useAuth();
  const [activePitchBoard, setActivePitchBoard] = useState<ActiveMiniLeagueMatch | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Fetch user's mini league memberships (as parent or admin)
  const { data: userLeagueMemberships } = useQuery({
    queryKey: ["user-league-memberships", user?.id],
    queryFn: async () => {
      // Get leagues where user is a parent
      const { data: playerLeagues } = await supabase
        .from("mini_league_players")
        .select("mini_league_id")
        .eq("parent_user_id", user!.id);

      // Get leagues where user is admin via club_admin, league_admin, or coach role
      const { data: adminRoles } = await supabase
        .from("user_roles")
        .select("club_id, role")
        .eq("user_id", user!.id)
        .in("role", ["club_admin", "league_admin", "coach", "app_admin"]);

      const isAppAdmin = adminRoles?.some(r => r.role === "app_admin");
      const adminClubIds = adminRoles?.filter(r => r.club_id).map(r => r.club_id) as string[] || [];

      let adminLeagueIds: string[] = [];
      if (adminClubIds.length > 0 || isAppAdmin) {
        let query = supabase.from("mini_leagues").select("id");
        if (!isAppAdmin && adminClubIds.length > 0) {
          query = query.in("club_id", adminClubIds);
        }
        const { data: adminLeagues } = await query;
        adminLeagueIds = adminLeagues?.map(l => l.id) || [];
      }

      const parentLeagueIds = playerLeagues?.map(p => p.mini_league_id) || [];
      const allLeagueIds = [...new Set([...parentLeagueIds, ...adminLeagueIds])];

      return {
        parentLeagueIds,
        adminLeagueIds,
        allLeagueIds,
        isAppAdmin,
      };
    },
    enabled: !!user,
    staleTime: 30000,
  });

  // Fetch active mini league matches (where timer_state has isRunning = true)
  const { data: activeMatches = [], refetch } = useQuery({
    queryKey: ["active-mini-league-matches", userLeagueMemberships?.allLeagueIds, activeClubFilter],
    queryFn: async () => {
      if (!userLeagueMemberships?.allLeagueIds?.length) return [];

      // Get events from user's leagues that have active matches
      const { data: events, error: eventsError } = await supabase
        .from("events")
        .select("id, title, mini_league_id, club_id")
        .in("mini_league_id", userLeagueMemberships.allLeagueIds)
        .not("mini_league_id", "is", null);

      if (eventsError || !events?.length) return [];

      // Filter by club if active filter is set
      const filteredEvents = activeClubFilter
        ? events.filter(e => e.club_id === activeClubFilter)
        : events;

      if (!filteredEvents.length) return [];

      // Get event groups with timer_state
      const { data: groups, error: groupsError } = await supabase
        .from("event_groups")
        .select("*")
        .in("event_id", filteredEvents.map(e => e.id))
        .not("timer_state", "is", null);

      if (groupsError || !groups?.length) return [];

      // Get league names and settings
      const leagueIds = [...new Set(filteredEvents.map(e => e.mini_league_id).filter(Boolean))];
      const { data: leagues } = await supabase
        .from("mini_leagues")
        .select("id, name, club_id, minutes_per_half")
        .in("id", leagueIds as string[]);

      const leagueMap = new Map(leagues?.map(l => [l.id, l]) || []);

      // Get players for each group
      const activeMatches: ActiveMiniLeagueMatch[] = [];
      
      for (const group of groups) {
        // Cast timer_state properly
        const rawTimerState = group.timer_state as unknown as TimerState | null;
        
        // Only show matches that are actively in progress (timer running or has started)
        if (!rawTimerState || typeof rawTimerState !== 'object') continue;
        
        const timerState = rawTimerState;
        
        // Skip if game is finished
        if (timerState.isGameFinished) continue;
        
        // Skip if timer hasn't started yet
        const hasStarted = timerState.elapsedSeconds > 0 || timerState.isRunning || timerState.currentHalf > 1;
        if (!hasStarted) continue;

        const event = filteredEvents.find(e => e.id === group.event_id);
        if (!event) continue;

        const league = leagueMap.get(event.mini_league_id!);
        if (!league) continue;

        // Get players for this match
        const { data: playerLinks } = await supabase
          .from("event_group_players")
          .select("player_id, team")
          .eq("group_id", group.id);

        const playerIds = playerLinks?.map(p => p.player_id) || [];
        let players: { id: string; name: string; team: "a" | "b" | null }[] = [];

        if (playerIds.length > 0) {
          const { data: playersData } = await supabase
            .from("mini_league_players")
            .select("id, name")
            .in("id", playerIds);

          players = (playersData || []).map(p => ({
            id: p.id,
            name: p.name,
            team: playerLinks?.find(pl => pl.player_id === p.id)?.team as "a" | "b" | null,
          }));
        }

        // Calculate scores from pitch_state goals
        const pitchState = group.pitch_state as any;
        const goals = pitchState?.goals || [];
        const teamAScore = goals.filter((g: any) => g.teamSide === "a").length;
        const teamBScore = goals.filter((g: any) => g.teamSide === "b").length;

        // Check if user is admin for this league
        const isAdmin = userLeagueMemberships.isAppAdmin || 
          userLeagueMemberships.adminLeagueIds.includes(league.id);

        // Check if user has a duty (e.g. Referee, Subs Manager) for this group
        let isRefForGroup = false;
        let hasGroupDuty = false;
        if (user) {
          const { data: userDuties } = await supabase
            .from("event_group_duties")
            .select("id, name")
            .eq("group_id", group.id)
            .eq("assigned_to", user.id);
          hasGroupDuty = !!userDuties?.length;
          isRefForGroup = !!userDuties?.some(d => d.name === "Referee");
        }

        // For non-admins, only show matches where:
        // 1. Their child is a player in this group, OR
        // 2. They have a duty assigned in this group
        if (!isAdmin) {
          const userChildIds = playerLinks?.filter(pl => {
            const player = players.find(p => p.id === pl.player_id);
            return player !== undefined;
          }).map(pl => pl.player_id) || [];

          // Check if any of the user's children are in this match
          let hasChildInMatch = false;
          if (userChildIds.length > 0) {
            const { data: userChildren } = await supabase
              .from("mini_league_players")
              .select("id")
              .in("id", userChildIds)
              .eq("parent_user_id", user!.id);
            hasChildInMatch = !!userChildren?.length;
          }

          if (!hasChildInMatch && !hasGroupDuty) {
            continue; // Skip this match - user has no association
          }
        }

        activeMatches.push({
          id: group.id,
          name: group.name,
          eventId: event.id,
          eventTitle: event.title,
          leagueId: league.id,
          leagueName: league.name,
          clubId: league.club_id,
          timerState,
          pitchState: pitchState || {},
          teamAColor: group.team_a_color || "#ef4444",
          teamBColor: group.team_b_color || "#3b82f6",
          players,
          teamAScore,
          teamBScore,
          isAdmin,
          isReferee: isRefForGroup,
          minutesPerHalf: league.minutes_per_half || 10,
        });
      }

      return activeMatches;
    },
    enabled: !!user && !!userLeagueMemberships?.allLeagueIds?.length,
    refetchInterval: 5000, // Refresh every 5 seconds to get updated timer states
  });

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }, []);

  const calculateCurrentTime = (timerState: TimerState) => {
    return getCurrentGameSeconds(timerState as any);
  };

  const openPitchBoard = (match: ActiveMiniLeagueMatch) => {
    setActivePitchBoard(match);
  };

  // Limit displayed matches
  const displayedMatches = expanded ? activeMatches : activeMatches.slice(0, 2);
  const hasMoreMatches = activeMatches.length > 2;

  if (!activeMatches.length) return null;

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-primary" />
            Live Matches
          </h2>
          {hasMoreMatches && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="text-muted-foreground"
            >
              {expanded ? (
                <>Show Less <ChevronUp className="h-4 w-4 ml-1" /></>
              ) : (
                <>+{activeMatches.length - 2} more <ChevronDown className="h-4 w-4 ml-1" /></>
              )}
            </Button>
          )}
        </div>

        <div className="grid gap-3">
          {displayedMatches.map((match) => {
            const timerState = match.timerState;
            const currentTime = timerState ? calculateCurrentTime(timerState) : 0;

            return (
              <Card 
                key={match.id} 
                className="border-primary/30 bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors"
                onClick={() => openPitchBoard(match)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="secondary" className="text-xs">
                          {match.leagueName}
                        </Badge>
                        <span className="text-sm font-medium truncate">{match.name}</span>
                        {timerState?.isRunning && (
                          <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                        )}
                      </div>
                      
                      {/* Score display */}
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-4 h-4 rounded-full" 
                            style={{ backgroundColor: match.teamAColor }}
                          />
                          <span className="font-bold text-lg">{match.teamAScore}</span>
                        </div>
                        <span className="text-muted-foreground">-</span>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-lg">{match.teamBScore}</span>
                          <div 
                            className="w-4 h-4 rounded-full" 
                            style={{ backgroundColor: match.teamBColor }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Timer display */}
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Timer className={`h-4 w-4 ${timerState?.isRunning ? 'text-primary animate-pulse' : ''}`} />
                          <span>{timerState?.currentHalf === 1 ? "1H" : "2H"}</span>
                        </div>
                        {timerState && (
                          <span className="font-mono text-lg font-bold text-primary">
                            {formatTime(currentTime)}
                          </span>
                        )}
                      </div>
                      <Button 
                        variant="default" 
                        size="icon" 
                        className="h-10 w-10"
                        onClick={(e) => {
                          e.stopPropagation();
                          openPitchBoard(match);
                        }}
                      >
                        <ExternalLink className="h-5 w-5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Pitch Board Portal */}
      {activePitchBoard && createPortal(
        <Suspense fallback={<LoadingOverlay />}>
          <PitchBoard
            key={activePitchBoard.id}
            teamId={`event-group-${activePitchBoard.id}`}
            teamName={`${activePitchBoard.leagueName} - ${activePitchBoard.name}`}
            members={activePitchBoard.players.map(p => ({
              id: `player-${p.id}`,
              user_id: p.id,
              role: "player",
              profiles: { display_name: p.name, avatar_url: "" },
            }))}
            onClose={() => {
              setActivePitchBoard(null);
              refetch();
            }}
            miniLeagueTeams={{
              teamAPlayerIds: activePitchBoard.players.filter(p => p.team === "a").map(p => p.id),
              teamBPlayerIds: activePitchBoard.players.filter(p => p.team === "b").map(p => p.id),
              teamAColor: activePitchBoard.teamAColor,
              teamBColor: activePitchBoard.teamBColor,
            }}
            initialTeamSize={(() => {
              const teamACount = activePitchBoard.players.filter(p => p.team === "a").length;
              const teamBCount = activePitchBoard.players.filter(p => p.team === "b").length;
              const avgTeamSize = Math.max(Math.ceil((teamACount + teamBCount) / 2), 3);
              if (avgTeamSize <= 3) return 3;
              if (avgTeamSize <= 4) return 4;
              if (avgTeamSize <= 5) return 5;
              if (avgTeamSize <= 6) return 6;
              if (avgTeamSize <= 7) return 7;
              if (avgTeamSize <= 8) return 8;
              if (avgTeamSize <= 9) return 9;
              if (avgTeamSize <= 10) return 10;
              return 11;
            })()}
            initialMinutesPerHalf={activePitchBoard.minutesPerHalf}
            initialLinkedEventId={activePitchBoard.eventId}
            readOnly={!activePitchBoard.isAdmin && !activePitchBoard.isReferee}
            isSubsManager={false}
          />
        </Suspense>,
        document.body
      )}
    </>
  );
}
