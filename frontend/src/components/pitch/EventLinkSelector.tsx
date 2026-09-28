import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, Calendar, ChevronDown, X, Link2, MapPin, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO, isAfter, subDays, addHours } from "date-fns";

// Games can only be linked from 48 hours before kickoff up until 24 hours
// after kickoff. Anything further out is not yet linkable so coaches don't
// accidentally tie the pitch board to a fixture weeks away.
const LINK_WINDOW_HOURS_BEFORE = 48;

interface EventLinkSelectorProps {
  teamId: string;
  linkedEventId: string | null;
  onLinkEvent: (eventId: string | null, eventTitle?: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

interface GameEvent {
  id: string;
  title: string;
  event_date: string;
  type: string;
  address: string | null;
  suburb: string | null;
}

export function EventLinkSelector({
  teamId,
  linkedEventId,
  onLinkEvent,
  disabled = false,
  compact = false,
}: EventLinkSelectorProps) {
  const [open, setOpen] = useState(false);

  // Fetch game events for this team within the link window: from 24h after
  // kickoff back to 48h before kickoff. Games further away are excluded.
  const { data: events, isLoading } = useQuery({
    queryKey: ["team-game-events", teamId],
    queryFn: async () => {
      const oneDayAgo = subDays(new Date(), 1);
      const linkCutoff = addHours(new Date(), LINK_WINDOW_HOURS_BEFORE);

      const { data, error } = await supabase
        .from("events")
        .select("id, title, event_date, type, address, suburb")
        .eq("team_id", teamId)
        .eq("type", "game")
        .eq("is_cancelled", false)
        .gte("event_date", oneDayAgo.toISOString())
        .lte("event_date", linkCutoff.toISOString())
        .order("event_date", { ascending: true })
        .limit(20);

      if (error) throw error;
      return data as GameEvent[];
    },
    enabled: !!teamId,
  });

  // Get linked event details
  const linkedEvent = events?.find((e) => e.id === linkedEventId);

  const handleSelectEvent = (event: GameEvent | null) => {
    onLinkEvent(event?.id || null, event?.title);
    setOpen(false);
  };

  const formatEventDate = (dateStr: string) => {
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

  // Mobile-friendly full-width selector for settings dialog
  if (!compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link2 className="h-3.5 w-3.5" />
          <span>Link to Game Event</span>
        </div>
        
        {/* Currently linked event display */}
        {linkedEventId && linkedEvent && (
          <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">{linkedEvent.title}</span>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={() => handleSelectEvent(null)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatEventDate(linkedEvent.event_date)}
              </span>
              {linkedEvent.suburb && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {linkedEvent.suburb}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Stats will be saved when game ends
            </p>
          </div>
        )}
        
        {/* Event selection list */}
        <div className="border border-border rounded-lg overflow-hidden">
          <ScrollArea className="h-[200px]">
            {isLoading ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                Loading games...
              </div>
            ) : events && events.length > 0 ? (
              <div className="divide-y divide-border">
                {events.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => handleSelectEvent(event)}
                    disabled={disabled}
                    className={`w-full p-3 text-left hover:bg-muted/50 transition-colors ${
                      event.id === linkedEventId ? "bg-primary/5" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-medium text-sm truncate">{event.title}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isUpcoming(event.event_date) && (
                          <Badge variant="outline" className="text-[10px]">
                            Upcoming
                          </Badge>
                        )}
                        {event.id === linkedEventId && (
                          <Badge variant="secondary" className="text-[10px]">
                            Linked
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatEventDate(event.event_date)}
                      </span>
                      {event.suburb && (
                        <span className="flex items-center gap-1 truncate">
                          <MapPin className="h-3 w-3" />
                          {event.suburb}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-4 text-sm text-muted-foreground text-center">
                No games within 48 hours.
                <div className="text-xs mt-1 opacity-80">Games can be linked from 48h before kickoff.</div>
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    );
  }

  // Compact dropdown for landscape toolbar
  return (
    <div className="relative">
      <Button
        variant={linkedEventId ? "default" : "outline"}
        size="sm"
        className="h-8 gap-1.5"
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        {linkedEventId ? (
          <CalendarCheck className="h-3.5 w-3.5" />
        ) : (
          <Link2 className="h-3.5 w-3.5" />
        )}
        <span className="max-w-[100px] truncate">
          {linkedEvent?.title || (linkedEventId ? "Linked" : "Link Game")}
        </span>
        <ChevronDown className="h-3 w-3" />
      </Button>
      
      {open && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-[99998]" 
            onClick={() => setOpen(false)}
          />
          {/* Dropdown */}
          <div className="absolute top-full left-0 mt-1 w-64 bg-popover border border-border rounded-lg shadow-lg z-[99999]">
            <ScrollArea className="max-h-[300px]">
              {linkedEventId && (
                <>
                  <button
                    onClick={() => handleSelectEvent(null)}
                    className="w-full p-2.5 flex items-center gap-2 hover:bg-muted/50 text-destructive"
                  >
                    <X className="h-4 w-4" />
                    Unlink game
                  </button>
                  <div className="border-t border-border" />
                </>
              )}
              {isLoading ? (
                <div className="p-3 text-sm text-muted-foreground text-center">
                  Loading games...
                </div>
              ) : events && events.length > 0 ? (
                events.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => handleSelectEvent(event)}
                    className="w-full p-2.5 text-left hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-2">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate flex-1 text-sm">{event.title}</span>
                      {event.id === linkedEventId && (
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          Linked
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground pl-5 mt-0.5">
                      {formatEventDate(event.event_date)}
                      {isUpcoming(event.event_date) && (
                        <Badge variant="outline" className="ml-1 text-[10px]">
                          Upcoming
                        </Badge>
                      )}
                    </div>
                  </button>
                ))
              ) : (
                <div className="p-3 text-sm text-muted-foreground text-center">
                  No games within 48 hours
                </div>
              )}
            </ScrollArea>
          </div>
        </>
      )}
    </div>
  );
}
