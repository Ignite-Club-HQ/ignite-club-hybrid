import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trophy, Clock, Users, Loader2, Check, CalendarCheck, AlertTriangle } from "lucide-react";
import { PitchPosition } from "./PositionBadge";
import { useGameStats } from "@/hooks/useGameStats";
import { useSaveGameResult } from "@/hooks/useSaveGameResult";
import { EventLinkSelector } from "./EventLinkSelector";
import { useToast } from "@/hooks/use-toast";


interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
  minutesPlayed?: number;
  isFillIn?: boolean;
}

interface SubstitutionEvent {
  time: number;
  half: 1 | 2;
  playerOut: Player;
  playerIn: Player;
  positionSwap?: {
    player: Player;
    fromPosition: PitchPosition;
    toPosition: PitchPosition;
  };
  executed?: boolean;
  skipped?: boolean;
}

interface Goal {
  id: string;
  scorerId?: string;
  scorerName?: string;
  time: number;
  half: 1 | 2;
  isOpponentGoal: boolean;
}

interface GameFinishedDialogProps {
  open: boolean;
  onClose: () => void;
  players: Player[];
  totalGameTime: number;
  teamName?: string;
  // Event linking
  linkedEventId?: string | null;
  teamId?: string;
  /** Fallback team id (the board's own team) when the saved state has none. */
  boardTeamId?: string | null;
  formationUsed?: string;
  teamSize?: number;
  executedSubs?: SubstitutionEvent[];
  halfDuration?: number;
  goals?: Goal[];
  // Event details for email notification
  eventTitle?: string;
  eventDate?: string;
  opponent?: string;
  /** Manual "End game & save stats" flow (not triggered by full time). */
  manual?: boolean;
}

const PITCH_STATE_KEY = 'ignite-pitch-board-state';
const PITCH_STATE_KEY_BASE = 'ignite-pitch-board-state-team';
const getPitchStateKeyForTeam = (teamId: string) => `${PITCH_STATE_KEY_BASE}-${teamId}`;
const TIMER_STATE_KEY = 'pitch-board-timer-state';

export default function GameFinishedDialog({ 
  open, 
  onClose, 
  players, 
  totalGameTime,
  teamName,
  linkedEventId,
  teamId,
  boardTeamId,
  formationUsed,
  teamSize = 7,
  executedSubs = [],
  halfDuration,
  goals = [],
  eventTitle,
  eventDate,
  opponent,
  manual = false,
}: GameFinishedDialogProps) {
  const { saveGameStats, isSaving } = useGameStats();
  const { save: saveGameResult } = useSaveGameResult();
  const { toast } = useToast();
  const [statsSaved, setStatsSaved] = useState(false);
  const [finishInProgress, setFinishInProgress] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Retroactive event link chosen inside this dialog when the board session
  // was never linked to a fixture (stats are event-keyed, so without this the
  // whole session is unsaveable).
  const [retroEventId, setRetroEventId] = useState<string | null>(null);
  const [unlinkedAcknowledged, setUnlinkedAcknowledged] = useState(false);
  const finishInProgressRef = useRef(false);

  const effectiveEventId = linkedEventId || retroEventId;
  const linkTeamId = teamId || boardTeamId || undefined;
  const canPickEvent = !linkedEventId && !!linkTeamId && !linkTeamId.startsWith("event-group-");
  

  
  // Sort players by minutes played (descending)
  const sortedPlayers = [...players].sort((a, b) => (b.minutesPlayed || 0) - (a.minutesPlayed || 0));
  
  const totalMinutesPlayed = players.reduce((sum, p) => sum + (p.minutesPlayed || 0), 0);
  const avgMinutes = players.length > 0 ? Math.round(totalMinutesPlayed / players.length) : 0;
  
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleFinish = async () => {
    // Synchronous, component-local guard against duplicate submissions.
    // The `isSaving` prop updates asynchronously after the first click, so
    // rapid taps can otherwise slip past the disabled state and run the
    // full save + cleanup workflow multiple times.
    if (finishInProgressRef.current) return;
    finishInProgressRef.current = true;
    setFinishInProgress(true);
    setSaveError(null);

    try {
    // Save stats when we have an event to key them to and haven't saved yet.
    // A failure here MUST NOT clear the session — we surface the error and
    // keep this dialog open so the coach can retry.
    if (effectiveEventId && !statsSaved) {
      const resolvedTeamId = await saveGameStats({
        eventId: effectiveEventId,
        teamId,
        boardTeamId,
        players,
        totalGameTime,
        halfDuration: halfDuration || Math.floor(totalGameTime / 2),
        formationUsed,
        teamSize,
        executedSubs,
        goals,
        eventTitle,
        eventDate,
        opponent,
      }).then((res) => res?.teamId ?? teamId ?? boardTeamId ?? undefined);
      setStatsSaved(true);

      // Also persist a soccer match score row (parity with basketball/netball boards),
      // so the score shows on the event card and in History.
      // Use onlyIfMissing so manual overrides via MatchScoreCard are never clobbered.
      try {
        const homeScore = goals.filter((g) => !g.isOpponentGoal).length;
        const awayScore = goals.filter((g) => g.isOpponentGoal).length;

        // Build per-player goal tallies. Own goals are stored as opponent
        // goals (isOpponentGoal=true) so they're correctly excluded here.
        const goalsByPlayer = new Map<string, { id: string; name: string; goals: number }>();
        goals
          .filter((g) => !g.isOpponentGoal && g.scorerId)
          .forEach((g) => {
            const existing = goalsByPlayer.get(g.scorerId!);
            if (existing) {
              existing.goals += 1;
            } else {
              goalsByPlayer.set(g.scorerId!, {
                id: g.scorerId!,
                name: g.scorerName || "Player",
                goals: 1,
              });
            }
          });
        const scorerStats = Array.from(goalsByPlayer.values());

        if (resolvedTeamId) {
          const scoreSaved = await saveGameResult(
            {
              teamId: resolvedTeamId,
              eventId: effectiveEventId,
              sport: "soccer",
              homeLabel: teamName || "Our Team",
              awayLabel: opponent || "Opponent",
              homeScore,
              awayScore,
              perQuarter: [],
              players: scorerStats as any,
            },
            { silent: true, onlyIfMissing: true }
          );
          if (!scoreSaved) {
            toast({
              title: "Stats saved, but not the score",
              description: "Open the fixture and record the result again so it appears in Player Stats.",
              variant: "destructive",
            });
          }
        }
      } catch (err) {
        // The score row is secondary — player stats are already persisted.
        console.error("Failed to save soccer game result:", err);
      }
    }




    // Preserve the timer state as "finished" with a `gameFinishedAt` stamp
    // so the home-screen Game Timer Widget keeps showing "Full Time" for the
    // post-game visibility window (~60 minutes), instead of disappearing the
    // moment the user dismisses this dialog. The widget self-expires after
    // the window, and users can still swipe to dismiss it sooner.
    const stampFinishedTimer = (raw: string | null): string | null => {
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        parsed.isGameFinished = true;
        parsed.isRunning = false;
        if (!parsed.gameFinishedAt) parsed.gameFinishedAt = Date.now();
        parsed.lastUpdateTime = Date.now();
        return JSON.stringify(parsed);
      } catch {
        return null;
      }
    };

    if (teamId) {
      const teamTimerKey = `pitch-board-timer-state-team-${teamId}`;
      const teamStamped = stampFinishedTimer(localStorage.getItem(teamTimerKey));
      if (teamStamped) localStorage.setItem(teamTimerKey, teamStamped);

      const activeTimerRaw = localStorage.getItem(TIMER_STATE_KEY);
      if (activeTimerRaw) {
        try {
          const activeTimer = JSON.parse(activeTimerRaw);
          if (activeTimer.teamId === teamId) {
            const stamped = stampFinishedTimer(activeTimerRaw);
            if (stamped) localStorage.setItem(TIMER_STATE_KEY, stamped);
          }
        } catch { /* leave as-is */ }
      }
    } else {
      const stamped = stampFinishedTimer(localStorage.getItem(TIMER_STATE_KEY));
      if (stamped) localStorage.setItem(TIMER_STATE_KEY, stamped);
    }

    // Clear auto-sub plan + linked event from pitch state, but keep the rest
    // (players, goals, score) so the post-game widget can still surface the
    // final state for the visibility window.
    const pitchStateKey = teamId ? getPitchStateKeyForTeam(teamId) : PITCH_STATE_KEY;
    const pitchStateRaw = localStorage.getItem(pitchStateKey) || localStorage.getItem(PITCH_STATE_KEY);
    if (pitchStateRaw) {
      try {
        const pitchState = JSON.parse(pitchStateRaw);
        pitchState.autoSubPlan = [];
        pitchState.autoSubActive = false;
        pitchState.autoSubPaused = false;
        pitchState.linkedEventId = null;
        // Strip fill-ins so they don't carry into the next match on this team.
        // Fill-ins are ad-hoc for the finished match only; the next event's
        // real roster will repopulate. Also drop any plan steps referencing them
        // (defensive — autoSubPlan was already cleared above).
        if (Array.isArray(pitchState.players)) {
          pitchState.players = pitchState.players.filter((p: any) => !p?.isFillIn);
        }
        const json = JSON.stringify(pitchState);
        if (teamId) localStorage.setItem(getPitchStateKeyForTeam(teamId), json);
        const activeRaw = localStorage.getItem(PITCH_STATE_KEY);
        if (activeRaw) {
          try {
            const activeState = JSON.parse(activeRaw);
            if (!activeState.teamId || activeState.teamId === teamId) {
              localStorage.setItem(PITCH_STATE_KEY, json);
            }
          } catch { localStorage.setItem(PITCH_STATE_KEY, json); }
        } else {
          localStorage.setItem(PITCH_STATE_KEY, json);
        }
      } catch (e) {
        console.error('Failed to clear auto-sub plan:', e);
      }
    }
    onClose();
    } catch (err) {
      // Save failed: keep the dialog open, surface the error and let the coach
      // retry. The session (players, minutes, goals, timer) is untouched.
      console.error('handleFinish failed:', err);
      const message =
        (err as any)?.message ||
        "Something went wrong saving these stats. Please try again.";
      setSaveError(message);
      toast({
        title: "Stats not saved",
        description: message,
        variant: "destructive",
      });
      finishInProgressRef.current = false;
      setFinishInProgress(false);
      return;
    }
    finishInProgressRef.current = false;
    setFinishInProgress(false);
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-md z-[99999]" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            {manual ? "End game & save stats" : "Game Finished!"}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {teamName && (
            <p className="text-center text-muted-foreground">{teamName}</p>
          )}
          
          {/* Event linked indicator */}
          {effectiveEventId ? (
            <div className="flex items-center justify-center gap-2 text-sm text-primary">
              <CalendarCheck className="h-4 w-4" />
              <span>Stats will be saved to the linked game</span>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-3 space-y-2">
              <div className="flex items-start gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-500 shrink-0" />
                <p className="text-muted-foreground">
                  This session isn't linked to a fixture. Player stats are stored
                  against a game, so pick the fixture to save them.
                </p>
              </div>
              {canPickEvent && (
                <EventLinkSelector
                  teamId={linkTeamId!}
                  linkedEventId={retroEventId}
                  onLinkEvent={(id) => { setRetroEventId(id); setSaveError(null); }}
                  compact
                />
              )}
              {!unlinkedAcknowledged && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-muted-foreground"
                  onClick={() => setUnlinkedAcknowledged(true)}
                >
                  This was an unlinked practice — don't save stats
                </Button>
              )}
            </div>
          )}

          {saveError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {saveError}
            </div>
          )}
          

          
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-primary/10 rounded-lg p-3 text-center">
              <Clock className="h-4 w-4 mx-auto mb-1 text-primary" />
              <p className="text-xl font-bold">{formatTime(totalGameTime)}</p>
              <p className="text-[10px] text-muted-foreground">Total Time</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <Users className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <p className="text-xl font-bold">{players.length}</p>
              <p className="text-[10px] text-muted-foreground">Players</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <Clock className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <p className="text-xl font-bold">{formatTime(avgMinutes)}</p>
              <p className="text-[10px] text-muted-foreground">Avg/Player</p>
            </div>
          </div>
          
          {/* Player list */}
          {players.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Final Playing Time</p>
              <ScrollArea className="h-[200px]">
                <div className="space-y-1.5">
                  {sortedPlayers.map((player, index) => {
                    const minutes = player.minutesPlayed || 0;
                    const gamePercentage = totalGameTime > 0 ? Math.round((minutes / totalGameTime) * 100) : 0;
                    
                    return (
                      <div key={player.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
                        <span className="text-xs text-muted-foreground w-4">{index + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm truncate">
                              {player.number ? `#${player.number} ` : ''}{player.name}
                            </span>
                            <Badge variant="secondary" className="text-[10px] shrink-0">
                              {gamePercentage}%
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-primary rounded-full"
                                style={{ width: `${gamePercentage}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground w-10 text-right">
                              {formatTime(minutes)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
        
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            onClick={handleFinish}
            className="w-full"
            disabled={
              isSaving || finishInProgress ||
              (!effectiveEventId && !unlinkedAcknowledged)
            }
          >
            {(isSaving || finishInProgress) ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving Stats...
              </>
            ) : statsSaved ? (
              <>
                <Check className="h-4 w-4 mr-2" />
                Done
              </>
            ) : saveError ? (
              <>
                <Trophy className="h-4 w-4 mr-2" />
                Retry save
              </>
            ) : (
              <>
                <Trophy className="h-4 w-4 mr-2" />
                {effectiveEventId ? "Save & Finish" : "Finish without stats"}
              </>
            )}
          </Button>
          {saveError && (
            <Button
              variant="ghost"
              className="w-full text-xs text-muted-foreground"
              onClick={onClose}
            >
              Keep session and close
            </Button>
          )}
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}
