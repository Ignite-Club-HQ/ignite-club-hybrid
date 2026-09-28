import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Minus, Target, Users, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Goal, Player, MiniLeagueTeams } from "./types";

interface ScoreTrackerProps {
  goals: Goal[];
  onAddGoal: (goal: Goal) => void;
  onRemoveGoal: (goalId: string) => void;
  onUpdateGoal?: (goal: Goal) => void;
  players: Player[];
  currentHalf: 1 | 2;
  elapsedSeconds: number;
  teamName: string;
  opponentName?: string;
  readOnly?: boolean;
  compact?: boolean;
  mini?: boolean;
  isGameFinished?: boolean;
  miniLeagueTeams?: MiniLeagueTeams | null;
}

export default function ScoreTracker({
  goals,
  onAddGoal,
  onRemoveGoal,
  onUpdateGoal,
  players,
  currentHalf,
  elapsedSeconds,
  teamName,
  opponentName = "Opponent",
  readOnly = false,
  compact = false,
  mini = false,
  isGameFinished = false,
  miniLeagueTeams,
}: ScoreTrackerProps) {
  const [showGoalSheet, setShowGoalSheet] = useState(false);
  const [selectedGoalType, setSelectedGoalType] = useState<"team" | "opponent" | "teamA" | "teamB" | null>(null);
  const [pendingGoal, setPendingGoal] = useState<{ goal: Goal; label: string } | null>(null);
  const [showEditSheet, setShowEditSheet] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [showChangeScorerSheet, setShowChangeScorerSheet] = useState(false);

  // Mini-league mode: count goals by teamSide
  const isMiniLeague = !!miniLeagueTeams;
  const teamAGoals = isMiniLeague ? goals.filter((g) => g.teamSide === "a") : goals.filter((g) => !g.isOpponentGoal);
  const teamBGoals = isMiniLeague ? goals.filter((g) => g.teamSide === "b") : goals.filter((g) => g.isOpponentGoal);
  
  // For regular mode compatibility
  const teamGoals = teamAGoals;
  const opponentGoals = teamBGoals;

  // Get team names for mini-league
  const teamAName = miniLeagueTeams?.teamAName || "Team A";
  const teamBName = miniLeagueTeams?.teamBName || "Team B";

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    return `${mins}'`;
  };

  const handleAddTeamGoal = () => {
    if (isMiniLeague) {
      setSelectedGoalType("teamA");
    } else {
      setSelectedGoalType("team");
    }
    setShowGoalSheet(true);
  };

  const handleAddTeamBGoal = () => {
    setSelectedGoalType("teamB");
    setShowGoalSheet(true);
  };

  const handleAddOpponentGoal = () => {
    if (isMiniLeague) {
      // For mini-league, open sheet to select Team B scorer
      setSelectedGoalType("teamB");
      setShowGoalSheet(true);
    } else {
      // Open sheet so the user can pick "Unknown" or "Own Goal by ..."
      setSelectedGoalType("opponent");
      setShowGoalSheet(true);
    }
  };

  const handleSelectScorer = (player: Player | null, forTeamSide?: "a" | "b") => {
    const teamSide = forTeamSide || (selectedGoalType === "teamA" ? "a" : selectedGoalType === "teamB" ? "b" : undefined);
    const newGoal: Goal = {
      id: `goal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      scorerId: player?.id,
      scorerName: player?.name,
      time: elapsedSeconds,
      half: currentHalf,
      isOpponentGoal: isMiniLeague ? false : (selectedGoalType === "opponent"),
      teamSide: isMiniLeague ? teamSide : undefined,
    };
    const scorerLabel = player?.name
      ? `${player.number ? `#${player.number} ` : ''}${player.name}`
      : selectedGoalType === "opponent"
        ? `${opponentName} goal`
        : "Unknown / Own Goal";
    setPendingGoal({ goal: newGoal, label: scorerLabel });
    setShowGoalSheet(false);
    setSelectedGoalType(null);
  };

  // Own goal: scored by one of OUR players, credited to the opposing side.
  const handleSelectOwnGoal = (player: Player) => {
    const newGoal: Goal = {
      id: `goal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      scorerId: player.id,
      scorerName: player.name,
      time: elapsedSeconds,
      half: currentHalf,
      isOpponentGoal: true,
      isOwnGoal: true,
    };
    const label = `Own Goal — ${player.number ? `#${player.number} ` : ''}${player.name}`;
    setPendingGoal({ goal: newGoal, label });
    setShowGoalSheet(false);
    setSelectedGoalType(null);
  };

  const handleConfirmGoal = () => {
    if (pendingGoal) {
      onAddGoal(pendingGoal.goal);
      setPendingGoal(null);
    }
  };

  const handleChangeScorer = (player: Player | null) => {
    if (editingGoal && onUpdateGoal) {
      onUpdateGoal({
        ...editingGoal,
        scorerId: player?.id,
        scorerName: player?.name,
      });
      setEditingGoal(null);
      setShowChangeScorerSheet(false);
      setShowEditSheet(false);
    }
  };

  const handleRemoveLastTeamGoal = () => {
    if (teamGoals.length > 0) {
      onRemoveGoal(teamGoals[teamGoals.length - 1].id);
    }
  };

  const handleRemoveLastOpponentGoal = () => {
    if (opponentGoals.length > 0) {
      onRemoveGoal(opponentGoals[opponentGoals.length - 1].id);
    }
  };

  // Get players on pitch for scorer selection
  const playersOnPitch = players.filter((p) => p.position !== null);

  // Combine readOnly for score locking (isGameFinished no longer blocks adding goals)
  const isLocked = readOnly;

  // Get players by team for mini-league mode
  const teamAPlayersOnPitch = isMiniLeague ? players.filter(p => p.position !== null && p.teamSide === "a") : [];
  const teamBPlayersOnPitch = isMiniLeague ? players.filter(p => p.position !== null && p.teamSide === "b") : [];

  // Mini mode - just score display, click to add goals
  if (mini) {
    return (
      <>
        <button
          onClick={() => {
            if (!isLocked) {
              if (isMiniLeague) {
                setSelectedGoalType("teamA");
              } else {
                setSelectedGoalType("team");
              }
              setShowGoalSheet(true);
            } else if (goals.length > 0) {
              setShowEditSheet(true);
            }
          }}
          className={cn(
            "flex items-center gap-1.5 bg-background/90 backdrop-blur-sm rounded-md px-2 py-1 shadow-sm border border-border",
            !isLocked && "hover:bg-background cursor-pointer active:scale-95 transition-transform",
            isGameFinished && "ring-2 ring-primary/30"
          )}
        >
          <Badge 
            variant="default" 
            className="text-sm font-bold px-1.5 min-w-[20px] justify-center h-5"
            style={isMiniLeague ? { backgroundColor: miniLeagueTeams?.teamAColor } : undefined}
          >
            {teamAGoals.length}
          </Badge>
          <span className="text-muted-foreground text-xs">-</span>
          <Badge 
            variant="secondary" 
            className="text-sm font-bold px-1.5 min-w-[20px] justify-center h-5"
            style={isMiniLeague ? { backgroundColor: miniLeagueTeams?.teamBColor, color: 'white' } : undefined}
          >
            {teamBGoals.length}
          </Badge>
        </button>

        {/* Goal scorer selection sheet */}
        <Sheet open={showGoalSheet} onOpenChange={setShowGoalSheet}>
          <SheetContent
            side="bottom"
            className="rounded-t-xl h-[85vh]"
            style={{ zIndex: 100001 }}
          >
            <SheetHeader className="pb-2">
              <SheetTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Add Goal
              </SheetTitle>
            </SheetHeader>
            <ScrollArea className="h-[calc(85vh-4rem)]">
              <div className="space-y-3 pr-4">
                {isMiniLeague ? (
                  <>
                    {/* Team A goal section */}
                    <div className="space-y-2">
                      <p className="text-sm font-medium" style={{ color: miniLeagueTeams?.teamAColor }}>{teamAName} Goal</p>
                      <button
                        className="w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                        style={{ borderColor: miniLeagueTeams?.teamAColor }}
                        onClick={() => handleSelectScorer(null, "a")}
                      >
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-sm">Unknown / Own Goal</span>
                        </div>
                      </button>
                      {teamAPlayersOnPitch.map((player) => (
                        <button
                          key={player.id}
                          className="w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                          style={{ borderColor: miniLeagueTeams?.teamAColor }}
                          onClick={() => handleSelectScorer(player, "a")}
                        >
                          <div className="flex items-center gap-2">
                            {player.number && (
                              <Badge variant="outline" className="text-xs">
                                #{player.number}
                              </Badge>
                            )}
                            <span className="font-medium text-sm">{player.name}</span>
                          </div>
                        </button>
                      ))}
                    </div>

                    {/* Team B goal section */}
                    <div className="space-y-2 pt-2 border-t border-border">
                      <p className="text-sm font-medium" style={{ color: miniLeagueTeams?.teamBColor }}>{teamBName} Goal</p>
                      <button
                        className="w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                        style={{ borderColor: miniLeagueTeams?.teamBColor }}
                        onClick={() => handleSelectScorer(null, "b")}
                      >
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-sm">Unknown / Own Goal</span>
                        </div>
                      </button>
                      {teamBPlayersOnPitch.map((player) => (
                        <button
                          key={player.id}
                          className="w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                          style={{ borderColor: miniLeagueTeams?.teamBColor }}
                          onClick={() => handleSelectScorer(player, "b")}
                        >
                          <div className="flex items-center gap-2">
                            {player.number && (
                              <Badge variant="outline" className="text-xs">
                                #{player.number}
                              </Badge>
                            )}
                            <span className="font-medium text-sm">{player.name}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    {/* Regular mode: Team goal section */}
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-muted-foreground">{teamName} Goal</p>
                      <button
                        className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                        onClick={() => handleSelectScorer(null)}
                      >
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-sm">Unknown / Own Goal</span>
                        </div>
                      </button>
                      {playersOnPitch.map((player) => (
                        <button
                          key={player.id}
                          className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                          onClick={() => handleSelectScorer(player)}
                        >
                          <div className="flex items-center gap-2">
                            {player.number && (
                              <Badge variant="outline" className="text-xs">
                                #{player.number}
                              </Badge>
                            )}
                            <span className="font-medium text-sm">{player.name}</span>
                          </div>
                        </button>
                      ))}
                    </div>

                    {/* Opponent goal section */}
                    <div className="space-y-2 pt-2 border-t border-border">
                      <p className="text-sm font-medium text-muted-foreground">{opponentName} Goal</p>
                      <button
                        className="w-full text-left p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors"
                        onClick={() => {
                          const newGoal: Goal = {
                            id: `goal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                            time: elapsedSeconds,
                            half: currentHalf,
                            isOpponentGoal: true,
                          };
                          setShowGoalSheet(false);
                          setSelectedGoalType(null);
                          setPendingGoal({ goal: newGoal, label: `${opponentName} goal` });
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <Target className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-sm">Add {opponentName} Goal</span>
                        </div>
                      </button>
                      <p className="text-[11px] text-muted-foreground pt-1">Own goal by one of our players:</p>
                      {playersOnPitch.map((player) => (
                        <button
                          key={`og-${player.id}`}
                          className="w-full text-left p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors"
                          onClick={() => handleSelectOwnGoal(player)}
                        >
                          <div className="flex items-center gap-2">
                            <Target className="h-4 w-4 text-destructive" />
                            {player.number && (
                              <Badge variant="outline" className="text-xs">
                                #{player.number}
                              </Badge>
                            )}
                            <span className="font-medium text-sm">{player.name}</span>
                            <span className="text-[10px] text-muted-foreground ml-auto">OG</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {/* Edit goals link when goals exist */}
                {goals.length > 0 && (
                  <div className="pt-3 border-t border-border">
                    <Button
                      variant="ghost"
                      className="w-full text-muted-foreground"
                      onClick={() => {
                        setShowGoalSheet(false);
                        setSelectedGoalType(null);
                        setShowEditSheet(true);
                      }}
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit Recorded Goals ({goals.length})
                    </Button>
                  </div>
                )}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>

        {/* Edit goals sheet */}
        <Sheet open={showEditSheet} onOpenChange={setShowEditSheet}>
          <SheetContent
            side="bottom"
            className="rounded-t-xl h-[70vh]"
            style={{ zIndex: 100001 }}
          >
            <SheetHeader className="pb-2">
              <SheetTitle className="flex items-center gap-2">
                <Pencil className="h-5 w-5 text-primary" />
                Edit Goals
              </SheetTitle>
            </SheetHeader>
            <ScrollArea className="h-[calc(70vh-4rem)]">
              <div className="space-y-2 pr-4">
                {goals.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No goals recorded</p>
                ) : (
                  goals.sort((a, b) => a.time - b.time).map((goal) => {
                    const isOpponent = isMiniLeague ? goal.teamSide === "b" : goal.isOpponentGoal;
                    return (
                      <div key={goal.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant={isOpponent ? "secondary" : "default"} className="text-[10px] px-1.5 shrink-0">
                              {formatTime(goal.time)}
                            </Badge>
                            <span className="font-medium text-sm truncate">
                              {goal.scorerName || (isOpponent ? (isMiniLeague ? (goal.teamSide === "b" ? teamBName : teamAName) : opponentName) : "Unknown")}
                              {goal.isOwnGoal && <span className="ml-1 text-[10px] text-destructive">(OG)</span>}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {isOpponent ? (isMiniLeague ? (goal.teamSide === "b" ? teamBName : teamAName) : opponentName) : (isMiniLeague ? (goal.teamSide === "a" ? teamAName : teamBName) : teamName)} · Half {goal.half}
                          </p>
                        </div>
                        {!isLocked && (
                          <div className="flex items-center gap-1 shrink-0">
                            {!goal.isOpponentGoal && onUpdateGoal && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => {
                                  setEditingGoal(goal);
                                  setShowChangeScorerSheet(true);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => {
                                onRemoveGoal(goal.id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                {!isLocked && (
                  <Button
                    variant="outline"
                    className="w-full mt-3"
                    onClick={() => {
                      setShowEditSheet(false);
                      if (isMiniLeague) {
                        setSelectedGoalType("teamA");
                      } else {
                        setSelectedGoalType("team");
                      }
                      setShowGoalSheet(true);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Goal
                  </Button>
                )}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>

        {/* Change scorer sheet */}
        <Sheet open={showChangeScorerSheet} onOpenChange={(open) => {
          setShowChangeScorerSheet(open);
          if (!open) setEditingGoal(null);
        }}>
          <SheetContent
            side="bottom"
            className="rounded-t-xl h-[85vh]"
            style={{ zIndex: 100002 }}
          >
            <SheetHeader className="pb-2">
              <SheetTitle className="flex items-center gap-2">
                <Pencil className="h-5 w-5 text-primary" />
                Change Scorer
              </SheetTitle>
            </SheetHeader>
            <ScrollArea className="h-[calc(85vh-4rem)]">
              <div className="space-y-2 pr-4">
                <button
                  className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                  onClick={() => handleChangeScorer(null)}
                >
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">Unknown / Own Goal</span>
                  </div>
                </button>
                {players.map((player) => (
                  <button
                    key={player.id}
                    className={cn(
                      "w-full text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors",
                      editingGoal?.scorerId === player.id && "bg-primary/10 border-primary"
                    )}
                    onClick={() => handleChangeScorer(player)}
                  >
                    <div className="flex items-center gap-2">
                      {player.number && (
                        <Badge variant="outline" className="text-xs">
                          #{player.number}
                        </Badge>
                      )}
                      <span className="font-medium text-sm">{player.name}</span>
                      {player.position !== null && (
                        <span className="text-xs text-muted-foreground">(On Pitch)</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>

        <AlertDialog open={!!pendingGoal} onOpenChange={(open) => !open && setPendingGoal(null)}>
          <AlertDialogContent style={{ zIndex: 100002 }}>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Goal</AlertDialogTitle>
              <AlertDialogDescription>
                Add goal scored by <span className="font-semibold text-foreground">{pendingGoal?.label}</span>?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmGoal}>Confirm Goal</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2 bg-background/95 backdrop-blur-sm rounded-lg px-3 py-2 shadow-md border border-border">
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium truncate max-w-[60px]">{teamName}</span>
          <Badge variant="default" className="text-lg font-bold px-2 min-w-[28px] justify-center">
            {teamGoals.length}
          </Badge>
        </div>
        <span className="text-muted-foreground text-sm">-</span>
        <div className="flex items-center gap-1">
          <Badge variant="secondary" className="text-lg font-bold px-2 min-w-[28px] justify-center">
            {opponentGoals.length}
          </Badge>
          <span className="text-xs font-medium truncate max-w-[60px]">{opponentName}</span>
        </div>
        {!isLocked && (
          <div className="flex items-center gap-1 ml-2 border-l border-border pl-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 hover:bg-primary/20"
              onClick={handleAddTeamGoal}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 hover:bg-secondary/50"
              onClick={handleAddOpponentGoal}
            >
              <Target className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Goal scorer selection sheet */}
        <Sheet open={showGoalSheet} onOpenChange={setShowGoalSheet}>
          <SheetContent
            side="bottom"
            className="rounded-t-xl h-[85vh]"
            style={{ zIndex: 100001 }}
          >
            <SheetHeader className="pb-2">
              <SheetTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Who Scored?
              </SheetTitle>
            </SheetHeader>
            <ScrollArea className="h-[calc(85vh-4rem)]">
              <div className="space-y-2 pr-4">
                {/* Unknown scorer option */}
                <button
                  className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                  onClick={() => handleSelectScorer(null)}
                >
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">Unknown / Own Goal</span>
                  </div>
                </button>

                {/* Players on pitch */}
                {playersOnPitch.map((player) => (
                  <button
                    key={player.id}
                    className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                    onClick={() => handleSelectScorer(player)}
                  >
                    <div className="flex items-center gap-2">
                      {player.number && (
                        <Badge variant="outline" className="text-xs">
                          #{player.number}
                        </Badge>
                      )}
                      <span className="font-medium text-sm">{player.name}</span>
                      {player.currentPitchPosition && (
                        <span className="text-xs text-muted-foreground">
                          ({player.currentPitchPosition})
                        </span>
                      )}
                    </div>
                  </button>
                ))}

                {/* Players on bench (less prominent) */}
                {players
                  .filter((p) => p.position === null)
                  .map((player) => (
                    <button
                      key={player.id}
                      className="w-full text-left p-3 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors opacity-60"
                      onClick={() => handleSelectScorer(player)}
                    >
                      <div className="flex items-center gap-2">
                        {player.number && (
                          <Badge variant="outline" className="text-xs">
                            #{player.number}
                          </Badge>
                        )}
                        <span className="font-medium text-sm">{player.name}</span>
                        <span className="text-xs text-muted-foreground">(Bench)</span>
                      </div>
                    </button>
                  ))}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>

        <AlertDialog open={!!pendingGoal} onOpenChange={(open) => !open && setPendingGoal(null)}>
          <AlertDialogContent style={{ zIndex: 100002 }}>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Goal</AlertDialogTitle>
              <AlertDialogDescription>
                Add goal scored by <span className="font-semibold text-foreground">{pendingGoal?.label}</span>?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmGoal}>Confirm Goal</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // Determine display names based on mode
  const displayTeamAName = isMiniLeague ? teamAName : teamName;
  const displayTeamBName = isMiniLeague ? teamBName : opponentName;

  return (
    <div className={cn(
      "bg-background/95 backdrop-blur-sm rounded-xl p-3 shadow-md border border-border",
      isGameFinished && "ring-2 ring-primary/30"
    )}>
      {/* Score display */}
      <div className="flex items-center justify-center gap-4 mb-3">
        <div className="flex flex-col items-center gap-1 flex-1">
          <span 
            className="text-xs font-medium truncate max-w-full"
            style={isMiniLeague ? { color: miniLeagueTeams?.teamAColor } : undefined}
          >
            {displayTeamAName}
          </span>
          <div className="flex items-center gap-2">
            {!isLocked && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleRemoveLastTeamGoal}
                disabled={teamAGoals.length === 0}
              >
                <Minus className="h-4 w-4" />
              </Button>
            )}
            <Badge
              variant="default"
              className="text-2xl font-bold px-4 py-1 min-w-[48px] justify-center"
              style={isMiniLeague ? { backgroundColor: miniLeagueTeams?.teamAColor } : undefined}
            >
              {teamAGoals.length}
            </Badge>
            {!isLocked && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleAddTeamGoal}
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <span className="text-2xl font-bold text-muted-foreground">-</span>

        <div className="flex flex-col items-center gap-1 flex-1">
          <span 
            className="text-xs font-medium truncate max-w-full"
            style={isMiniLeague ? { color: miniLeagueTeams?.teamBColor } : undefined}
          >
            {displayTeamBName}
          </span>
          <div className="flex items-center gap-2">
            {!isLocked && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleRemoveLastOpponentGoal}
                disabled={teamBGoals.length === 0}
              >
                <Minus className="h-4 w-4" />
              </Button>
            )}
            <Badge
              variant="secondary"
              className="text-2xl font-bold px-4 py-1 min-w-[48px] justify-center"
              style={isMiniLeague ? { backgroundColor: miniLeagueTeams?.teamBColor, color: 'white' } : undefined}
            >
              {teamBGoals.length}
            </Badge>
            {!isLocked && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleAddTeamBGoal}
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Goal timeline */}
      {goals.length > 0 && (
        <div className="border-t border-border pt-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-muted-foreground">
              {isGameFinished ? "Final Score" : "Goals"}
            </p>
            {!isLocked && (
              <button
                onClick={() => setShowEditSheet(true)}
                className="text-[10px] text-primary font-medium hover:underline"
              >
                Edit
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {goals
              .sort((a, b) => a.time - b.time)
              .map((goal) => {
                const isTeamB = isMiniLeague ? goal.teamSide === "b" : goal.isOpponentGoal;
                const teamColor = isMiniLeague 
                  ? (goal.teamSide === "a" ? miniLeagueTeams?.teamAColor : miniLeagueTeams?.teamBColor)
                  : undefined;
                return (
                  <div
                    key={goal.id}
                    className={cn(
                      "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full cursor-pointer",
                      !isMiniLeague && (goal.isOpponentGoal
                        ? "bg-secondary text-secondary-foreground"
                        : "bg-primary/20 text-primary")
                    )}
                    style={isMiniLeague ? { 
                      backgroundColor: teamColor ? `${teamColor}30` : undefined,
                      color: teamColor 
                    } : undefined}
                    onClick={() => !isLocked && setShowEditSheet(true)}
                  >
                    <span>{formatTime(goal.time)}</span>
                    {goal.scorerName && (
                      <span className="font-medium truncate max-w-[80px]">
                        {goal.scorerName}
                      </span>
                    )}
                    {!isMiniLeague && goal.isOpponentGoal && <span>{goal.isOwnGoal ? "OG" : "Opp"}</span>}
                    {isMiniLeague && !goal.scorerName && (
                      <span>{goal.teamSide === "a" ? teamAName : teamBName}</span>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Goal scorer selection sheet */}
      <Sheet open={showGoalSheet} onOpenChange={setShowGoalSheet}>
        <SheetContent
          side="bottom"
          className="rounded-t-xl h-[85vh]"
          style={{ zIndex: 100001 }}
        >
          <SheetHeader className="pb-2">
            <SheetTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              {isMiniLeague 
                ? (selectedGoalType === "teamA" ? `${teamAName} Goal` : `${teamBName} Goal`)
                : "Who Scored?"}
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(85vh-4rem)]">
            <div className="space-y-2 pr-4">
              {isMiniLeague ? (
                <>
                  {/* Show players from the selected team */}
                  <button
                    className="w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                    style={{ borderColor: selectedGoalType === "teamA" ? miniLeagueTeams?.teamAColor : miniLeagueTeams?.teamBColor }}
                    onClick={() => handleSelectScorer(null, selectedGoalType === "teamA" ? "a" : "b")}
                  >
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">Unknown / Own Goal</span>
                    </div>
                  </button>
                  {(selectedGoalType === "teamA" ? teamAPlayersOnPitch : teamBPlayersOnPitch).map((player) => (
                    <button
                      key={player.id}
                      className="w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                      style={{ borderColor: selectedGoalType === "teamA" ? miniLeagueTeams?.teamAColor : miniLeagueTeams?.teamBColor }}
                      onClick={() => handleSelectScorer(player, selectedGoalType === "teamA" ? "a" : "b")}
                    >
                      <div className="flex items-center gap-2">
                        {player.number && (
                          <Badge variant="outline" className="text-xs">
                            #{player.number}
                          </Badge>
                        )}
                        <span className="font-medium text-sm">{player.name}</span>
                        {player.currentPitchPosition && (
                          <span className="text-xs text-muted-foreground">
                            ({player.currentPitchPosition})
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </>
              ) : selectedGoalType === "opponent" ? (
                <>
                  {/* Opponent goal: unknown opponent scorer */}
                  <button
                    className="w-full text-left p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors"
                    onClick={() => handleSelectScorer(null)}
                  >
                    <div className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{opponentName} goal (unknown scorer)</span>
                    </div>
                  </button>

                  <p className="text-[11px] text-muted-foreground pt-1">Own goal by one of our players:</p>
                  {playersOnPitch.map((player) => (
                    <button
                      key={`og-${player.id}`}
                      className="w-full text-left p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors"
                      onClick={() => handleSelectOwnGoal(player)}
                    >
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-destructive" />
                        {player.number && (
                          <Badge variant="outline" className="text-xs">
                            #{player.number}
                          </Badge>
                        )}
                        <span className="font-medium text-sm">{player.name}</span>
                        {player.currentPitchPosition && (
                          <span className="text-xs text-muted-foreground">
                            ({player.currentPitchPosition})
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto">OG</span>
                      </div>
                    </button>
                  ))}
                </>
              ) : (
                <>
                  {/* Regular mode: Unknown scorer option */}
                  <button
                    className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                    onClick={() => handleSelectScorer(null)}
                  >
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">Unknown / Own Goal</span>
                    </div>
                  </button>

                  {/* Players on pitch */}
                  {playersOnPitch.map((player) => (
                    <button
                      key={player.id}
                      className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                      onClick={() => handleSelectScorer(player)}
                    >
                      <div className="flex items-center gap-2">
                        {player.number && (
                          <Badge variant="outline" className="text-xs">
                            #{player.number}
                          </Badge>
                        )}
                        <span className="font-medium text-sm">{player.name}</span>
                        {player.currentPitchPosition && (
                          <span className="text-xs text-muted-foreground">
                            ({player.currentPitchPosition})
                          </span>
                        )}
                      </div>
                    </button>
                  ))}

                  {/* Players on bench (less prominent) */}
                  {players
                    .filter((p) => p.position === null)
                    .map((player) => (
                      <button
                        key={player.id}
                        className="w-full text-left p-3 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors opacity-60"
                        onClick={() => handleSelectScorer(player)}
                      >
                        <div className="flex items-center gap-2">
                          {player.number && (
                            <Badge variant="outline" className="text-xs">
                              #{player.number}
                            </Badge>
                          )}
                          <span className="font-medium text-sm">{player.name}</span>
                          <span className="text-xs text-muted-foreground">(Bench)</span>
                        </div>
                      </button>
                    ))}
                </>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Edit goals sheet */}
      <Sheet open={showEditSheet} onOpenChange={setShowEditSheet}>
        <SheetContent
          side="bottom"
          className="rounded-t-xl h-[70vh]"
          style={{ zIndex: 100001 }}
        >
          <SheetHeader className="pb-2">
            <SheetTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              Edit Goals
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(70vh-4rem)]">
            <div className="space-y-2 pr-4">
              {goals.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No goals recorded</p>
              ) : (
                goals.sort((a, b) => a.time - b.time).map((goal) => {
                  const isOpponent = isMiniLeague ? goal.teamSide === "b" : goal.isOpponentGoal;
                  return (
                    <div key={goal.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant={isOpponent ? "secondary" : "default"} className="text-[10px] px-1.5 shrink-0">
                            {formatTime(goal.time)}
                          </Badge>
                          <span className="font-medium text-sm truncate">
                            {goal.scorerName || (isOpponent ? (isMiniLeague ? (goal.teamSide === "b" ? teamBName : teamAName) : opponentName) : "Unknown")}
                            {goal.isOwnGoal && <span className="ml-1 text-[10px] text-destructive">(OG)</span>}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {isOpponent ? (isMiniLeague ? (goal.teamSide === "b" ? teamBName : teamAName) : opponentName) : (isMiniLeague ? (goal.teamSide === "a" ? teamAName : teamBName) : teamName)} · Half {goal.half}
                        </p>
                      </div>
                      {!isLocked && (
                        <div className="flex items-center gap-1 shrink-0">
                          {!goal.isOpponentGoal && onUpdateGoal && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => {
                                setEditingGoal(goal);
                                setShowChangeScorerSheet(true);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => {
                              onRemoveGoal(goal.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              {!isLocked && (
                <Button
                  variant="outline"
                  className="w-full mt-3"
                  onClick={() => {
                    setShowEditSheet(false);
                    if (isMiniLeague) {
                      setSelectedGoalType("teamA");
                    } else {
                      setSelectedGoalType("team");
                    }
                    setShowGoalSheet(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Goal
                </Button>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Change scorer sheet */}
      <Sheet open={showChangeScorerSheet} onOpenChange={(open) => {
        setShowChangeScorerSheet(open);
        if (!open) setEditingGoal(null);
      }}>
        <SheetContent
          side="bottom"
          className="rounded-t-xl h-[85vh]"
          style={{ zIndex: 100002 }}
        >
          <SheetHeader className="pb-2">
            <SheetTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              Change Scorer
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(85vh-4rem)]">
            <div className="space-y-2 pr-4">
              <button
                className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                onClick={() => handleChangeScorer(null)}
              >
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">Unknown / Own Goal</span>
                </div>
              </button>
              {players.map((player) => (
                <button
                  key={player.id}
                  className={cn(
                    "w-full text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors",
                    editingGoal?.scorerId === player.id && "bg-primary/10 border-primary"
                  )}
                  onClick={() => handleChangeScorer(player)}
                >
                  <div className="flex items-center gap-2">
                    {player.number && (
                      <Badge variant="outline" className="text-xs">
                        #{player.number}
                      </Badge>
                    )}
                    <span className="font-medium text-sm">{player.name}</span>
                    {player.position !== null && (
                      <span className="text-xs text-muted-foreground">(On Pitch)</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Goal confirmation dialog */}
      <AlertDialog open={!!pendingGoal} onOpenChange={(open) => !open && setPendingGoal(null)}>
        <AlertDialogContent style={{ zIndex: 100002 }}>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Goal</AlertDialogTitle>
            <AlertDialogDescription>
              Add goal scored by <span className="font-semibold text-foreground">{pendingGoal?.label}</span>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmGoal}>Confirm Goal</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
