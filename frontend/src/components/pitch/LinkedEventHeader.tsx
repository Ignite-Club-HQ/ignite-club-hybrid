import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calendar, MapPin, Clock, Users, ChevronDown, ChevronUp, Link2, Check, CalendarCheck, Link2Off, Target, EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO, isAfter, subDays } from "date-fns";

interface LinkedEventHeaderProps {
  eventId: string;
  teamId?: string;
  teamName: string;
  compact?: boolean;
  onLinkEvent?: (eventId: string | null) => void;
  showScoreToggle?: boolean;
  scoreExpanded?: boolean;
  onToggleScore?: () => void;
  currentScore?: { team: number; opponent: number };
  isGameInProgress?: boolean;
}

interface EventDetails {
  id: string;
  title: string;
  event_date: string;
  address: string | null;
  suburb: string | null;
  description: string | null;
  opponent: string | null;
  team_id: string | null;
}

interface GameEvent {
  id: string;
  title: string;
  event_date: string;
  type: string;
  address: string | null;
  suburb: string | null;
  opponent: string | null;
}

export function LinkedEventHeader({ eventId, teamId, teamName, compact = false, onLinkEvent, showScoreToggle = false, scoreExpanded = false, onToggleScore, currentScore, isGameInProgress = false }: LinkedEventHeaderProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showEventSelector, setShowEventSelector] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const hasLinkedEvent = !!eventId;

  const { data: event, isLoading } = useQuery({
    queryKey: ["linked-event-details", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, title, event_date, address, suburb, description, opponent, team_id")
        .eq("id", eventId)
        .single();

      if (error) throw error;
      return data as EventDetails;
    },
    enabled: !!eventId,
    staleTime: 5 * 60 * 1000,
  });

  // Use provided teamId or fall back to event's team_id
  const effectiveTeamId = teamId || event?.team_id || "";

  // Fetch game events for the selector
  // Only show games from the last 24 hours (for past games) or future games
  const { data: gameEvents, isLoading: eventsLoading } = useQuery({
    queryKey: ["team-game-events-selector", effectiveTeamId],
    queryFn: async () => {
      const oneDayAgo = subDays(new Date(), 1);
      
      const { data, error } = await supabase
        .from("events")
        .select("id, title, event_date, type, address, suburb, opponent")
        .eq("team_id", effectiveTeamId)
        .eq("type", "game")
        .eq("is_cancelled", false)
        .gte("event_date", oneDayAgo.toISOString())
        .order("event_date", { ascending: true })
        .limit(20);

      if (error) throw error;
      return data as GameEvent[];
    },
    enabled: !!effectiveTeamId && showEventSelector,
  });

  // Show "No game linked" state when no event is linked
  if (!hasLinkedEvent) {
    // In read-only mode (onLinkEvent is undefined), just show a simple message
    if (!onLinkEvent) {
      return (
        <div className="flex items-center justify-center px-3 py-2 bg-muted/50 border-b border-border">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link2 className="h-4 w-4" />
            <span>No game linked</span>
          </div>
        </div>
      );
    }
    
    return (
      <>
        <div 
          className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border cursor-pointer"
          onClick={() => setShowEventSelector(true)}
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link2 className="h-4 w-4" />
            <span>No game linked - tap to link</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-3"
            onClick={(e) => {
              e.stopPropagation();
              setShowEventSelector(true);
            }}
          >
            <Link2 className="h-4 w-4 mr-1" />
            Link Game
          </Button>
        </div>

        {/* Event selector sheet */}
        <Sheet open={showEventSelector} onOpenChange={setShowEventSelector}>
          <SheetContent 
            side="bottom" 
            className="rounded-t-xl max-h-[70vh]"
            style={{ zIndex: 100010 }}
          >
            <SheetHeader className="pb-2">
              <SheetTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Link a Game
              </SheetTitle>
            </SheetHeader>
            <ScrollArea className="h-[50vh]">
              <div className="space-y-2 pr-4">
                {eventsLoading ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">Loading games...</div>
                ) : gameEvents && gameEvents.length > 0 ? (
                  gameEvents.map((game) => (
                    <button
                      key={game.id}
                      className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                      onClick={() => {
                        onLinkEvent?.(game.id);
                        setShowEventSelector(false);
                      }}
                    >
                      <div className="font-medium text-sm">{game.opponent ? `vs ${game.opponent}` : game.title}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {format(parseISO(game.event_date), "EEE, MMM d 'at' h:mm a")}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="py-8 text-center text-sm text-muted-foreground">No games found</div>
                )}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  if (isLoading || !event) return null;

  const formatEventDate = (dateStr: string) => {
    try {
      return format(parseISO(dateStr), "EEE, MMM d 'at' h:mm a");
    } catch {
      return dateStr;
    }
  };

  const formatShortDate = (dateStr: string) => {
    try {
      return format(parseISO(dateStr), "MMM d, h:mm a");
    } catch {
      return dateStr;
    }
  };

  const isUpcoming = (dateStr: string) => {
    try {
      return isAfter(parseISO(dateStr), new Date());
    } catch {
      return false;
    }
  };

  const getOpponent = () => {
    if (event.opponent) return event.opponent;
    const vsMatch = event.title.match(/\bvs?\b\s*(.+)/i);
    if (vsMatch) return vsMatch[1].trim();
    return null;
  };

  const opponent = getOpponent();

  const handleClearLink = () => {
    onLinkEvent?.(null);
    setShowClearConfirm(false);
  };

  const handleSelectGame = (game: GameEvent | null) => {
    onLinkEvent?.(game?.id || null);
    setShowEventSelector(false);
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs bg-background/90 backdrop-blur-sm rounded-lg px-2 py-1.5 shadow-md min-w-0 w-full">
        {isGameInProgress ? (
          <Badge variant="outline" className="gap-1 text-[10px] bg-primary/10 border-primary/20 shrink-0">
            <div className="w-1.5 h-1.5 bg-destructive rounded-full animate-pulse" />
            LIVE
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-[10px] bg-primary/10 border-primary/20 shrink-0">
            <Calendar className="h-3 w-3" />
            Match
          </Badge>
        )}
        <span className="font-medium truncate min-w-0 flex-1">{event.title}</span>
        {event.suburb && (
          <span className="text-muted-foreground flex items-center gap-1 shrink-0 hidden md:inline-flex">
            <MapPin className="h-3 w-3" />
            {event.suburb}
          </span>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="bg-background/95 backdrop-blur-sm border-b border-border">
        {/* Collapsed view - always visible */}
        <div 
          className="px-3 sm:px-4 py-2 flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {isGameInProgress ? (
              <Badge variant="default" className="gap-1 shrink-0 text-[10px] sm:text-xs px-1.5 sm:px-2">
                <div className="w-1.5 h-1.5 bg-destructive rounded-full animate-pulse" />
                LIVE
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1 shrink-0 text-[10px] sm:text-xs px-1.5 sm:px-2">
                <Calendar className="h-3 w-3" />
                Match
              </Badge>
            )}
            <span className="font-medium text-xs sm:text-sm truncate">{event.title}</span>
            {opponent && !isExpanded && (
              <span className="text-[10px] sm:text-xs text-muted-foreground hidden sm:inline">vs {opponent}</span>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {showScoreToggle && onToggleScore && (
              <Button
                variant={scoreExpanded ? "secondary" : "outline"}
                size="sm"
                className="h-8 px-2 sm:px-3 gap-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleScore();
                }}
              >
                {scoreExpanded ? (
                  <>
                    <EyeOff className="h-4 w-4" />
                    <span className="hidden sm:inline">Hide</span>
                  </>
                ) : (
                  <>
                    <Target className="h-4 w-4" />
                    {currentScore && (
                      <span className="font-bold">{currentScore.team} - {currentScore.opponent}</span>
                    )}
                    {!currentScore && <span className="hidden sm:inline">Score</span>}
                  </>
                )}
              </Button>
            )}
            {onLinkEvent && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 sm:h-10 sm:w-10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowEventSelector(true);
                  }}
                  title="Change linked game"
                >
                  <Link2 className="h-5 w-5 sm:h-5 sm:w-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 sm:h-10 sm:w-10 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowClearConfirm(true);
                  }}
                  title="Unlink game"
                >
                  <Link2Off className="h-5 w-5 sm:h-5 sm:w-5" />
                </Button>
              </>
            )}
            <div className="w-8 h-8 flex items-center justify-center">
              {isExpanded ? (
                <ChevronUp className="h-5 w-5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
          </div>
        </div>

        {/* Expanded details */}
        {isExpanded && (
          <div className="px-3 sm:px-4 pb-2 sm:pb-3 space-y-1">
            {opponent && (
              <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-muted-foreground">
                <Users className="h-3 w-3" />
                <span className="truncate">{teamName}</span>
                <span className="text-muted-foreground/60">vs</span>
                <span className="truncate">{opponent}</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-[10px] sm:text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                {formatEventDate(event.event_date)}
              </span>
              {(event.suburb || event.address) && (
                <span className="flex items-center gap-1 truncate">
                  <MapPin className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />
                  {event.suburb || event.address}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Event selector sheet - mobile friendly */}
      <Sheet open={showEventSelector} onOpenChange={setShowEventSelector}>
        <SheetContent 
          side="bottom" 
          className="h-[85vh] sm:h-[70vh] rounded-t-xl"
          style={{ zIndex: 100010 }}
        >
          <SheetHeader className="pb-4">
            <SheetTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Select Game
            </SheetTitle>
          </SheetHeader>
          
          <ScrollArea className="h-[calc(100%-4rem)]">
            <div className="space-y-2 pr-4">
              {/* Current selection */}
              <div className="p-3 bg-primary/10 border border-primary/20 rounded-xl mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <CalendarCheck className="h-4 w-4 text-primary" />
                  <span className="font-medium text-sm">Currently Linked</span>
                </div>
                <p className="text-sm truncate">{event.title}</p>
                <p className="text-xs text-muted-foreground">{formatShortDate(event.event_date)}</p>
              </div>

              {/* Game list */}
              {eventsLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Loading games...
                </div>
              ) : gameEvents && gameEvents.length > 0 ? (
                <div className="space-y-1">
                  {gameEvents.map((game) => {
                    const isSelected = game.id === eventId;
                    const gameOpponent = game.opponent || game.title.match(/\bvs?\b\s*(.+)/i)?.[1]?.trim();
                    
                    return (
                      <button
                        key={game.id}
                        onClick={() => handleSelectGame(game)}
                        className={`w-full p-3 rounded-xl text-left transition-all ${
                          isSelected 
                            ? "bg-primary text-primary-foreground" 
                            : "bg-muted/50 hover:bg-muted active:scale-[0.98]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <Calendar className={`h-4 w-4 shrink-0 ${isSelected ? "" : "text-muted-foreground"}`} />
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{game.title}</p>
                              {gameOpponent && (
                                <p className={`text-xs truncate ${isSelected ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                                  vs {gameOpponent}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {isUpcoming(game.event_date) && !isSelected && (
                              <Badge variant="outline" className="text-[10px]">Upcoming</Badge>
                            )}
                            {isSelected && (
                              <Check className="h-4 w-4" />
                            )}
                          </div>
                        </div>
                        <div className={`flex items-center gap-3 mt-1 text-xs ${isSelected ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatShortDate(game.event_date)}
                          </span>
                          {game.suburb && (
                            <span className="flex items-center gap-1 truncate">
                              <MapPin className="h-3 w-3" />
                              {game.suburb}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No games found for this team
                </div>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Clear confirmation sheet - mobile friendly */}
      <Sheet open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <SheetContent 
          side="bottom" 
          className="rounded-t-xl"
          style={{ zIndex: 100010 }}
        >
          <div className="py-4 space-y-4">
            <div className="flex items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center">
                <Link2Off className="h-6 w-6 text-warning" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h3 className="font-semibold text-lg">Unlink Game?</h3>
              <p className="text-sm text-muted-foreground px-4">
                Are you sure you want to unlink this game from the pitch board? Game stats will no longer be tracked for this match.
              </p>
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <Button 
                variant="destructive" 
                className="w-full"
                onClick={handleClearLink}
              >
                Unlink Game
              </Button>
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => setShowClearConfirm(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
