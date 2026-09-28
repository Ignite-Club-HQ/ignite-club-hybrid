import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Clock, MapPin } from "lucide-react";
import { format, parseISO } from "date-fns";
import { getEventTypeLabel } from "@/lib/eventTypeLabel";
import { Skeleton } from "@/components/ui/skeleton";
import { shouldAppendOpponent } from "@/lib/eventTitle";
import { memo, useCallback } from "react";

interface EventLinkCardProps {
  eventId: string;
}

export const EventLinkCard = memo(function EventLinkCard({ eventId }: EventLinkCardProps) {
  const navigate = useNavigate();

  const { data: event, isLoading } = useQuery({
    queryKey: ["event-link-card", eventId],
    queryFn: async () => {
      const { data } = await supabase
        .from("events")
        .select("id, title, event_date, start_time, end_time, location_name, location, type, opponent, is_home_game, mini_league_id, is_cancelled")
        .eq("id", eventId)
        .maybeSingle();
      return data;
    },
    enabled: !!eventId,
    staleTime: 5 * 60 * 1000,
  });

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (event?.id) {
      navigate(`/events/${event.id}`);
    }
  }, [event?.id, navigate]);

  if (isLoading) {
    // Match the loaded card's exact outer height (h-[76px]) so the
    // skeleton → card transition does not grow the row when the query
    // resolves (visible as "movement after scrolling stops").
    return <Skeleton className="h-[76px] w-full max-w-[280px] rounded-lg" />;
  }

  if (!event) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground max-w-[280px]">
        Event not found
      </div>
    );
  }

  const typeLabel = getEventTypeLabel(event.type, { miniLeagueId: event.mini_league_id });
  const eventDate = parseISO(event.event_date);
  const locationDisplay = event.location_name || event.location;

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/[0.06] p-2.5 max-w-[280px] w-full text-left transition-colors active:bg-primary/[0.12] touch-manipulation"
    >
      {/* Date badge */}
      <div className="flex flex-col items-center justify-center rounded-lg bg-primary/15 p-1.5 min-w-[40px]">
        <span className="text-[10px] font-semibold text-primary uppercase leading-none">
          {format(eventDate, "EEE")}
        </span>
        <span className="text-base font-bold text-primary leading-tight">
          {format(eventDate, "d")}
        </span>
        <span className="text-[9px] text-primary/70 uppercase leading-none">
          {format(eventDate, "MMM")}
        </span>
      </div>

      <div className="flex-1 min-w-0 space-y-0.5">
        <span className="text-[10px] font-semibold text-primary uppercase tracking-wide">
          {typeLabel}
        </span>
        <p className="text-sm font-semibold truncate leading-tight">
          {event.title}
          {shouldAppendOpponent(event) && (
            <span className="text-muted-foreground font-normal"> vs {event.opponent}</span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0 text-[11px] text-muted-foreground">
          {event.start_time && (
            <span className="flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {format(new Date(event.start_time), "h:mm a")}
            </span>
          )}
          {locationDisplay && (
            <span className="flex items-center gap-0.5 truncate max-w-[140px]">
              <MapPin className="h-2.5 w-2.5 shrink-0" />
              {locationDisplay}
            </span>
          )}
        </div>
        {event.is_cancelled && (
          <span className="text-[10px] font-medium text-destructive">Cancelled</span>
        )}
      </div>
    </button>
  );
});
