import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { MapPin, Clock } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMatchArrivalTime, getMatchArrivalMinutes } from "@/lib/matchArrivalTime";
import { shouldAppendOpponent } from "@/lib/eventTitle";
import { TeamChip } from "@/components/events/TeamChip";
import { getEventTypeIcon } from "@/lib/eventTypeIcon";

interface TeamNextEventCardProps {
  teamId: string;
  clubId: string;
}

export function TeamNextEventCard({ teamId, clubId }: TeamNextEventCardProps) {
  const navigate = useNavigate();
  const today = format(new Date(), "yyyy-MM-dd");

  const { data: nextEvent, isLoading } = useQuery({
    queryKey: ["team-next-event", teamId],
    queryFn: async () => {
      const { data } = await supabase
        .from("events")
        .select("id, title, event_date, start_time, end_time, location_name, location, type, opponent, is_home_game, mini_league_id, is_cancelled, arrival_minutes_before, teams (name, default_match_arrival_minutes)")
        .eq("team_id", teamId)
        .eq("is_cancelled", false)
        .gte("event_date", today)
        .order("event_date", { ascending: true })
        .order("start_time", { ascending: true })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!teamId,
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) {
    return <Skeleton className="h-24 w-full rounded-lg" />;
  }

  if (!nextEvent) {
    return null;
  }

  const eventDate = parseISO(nextEvent.event_date);
  const locationDisplay = nextEvent.location_name || nextEvent.location;

  return (
    <Card
      className="border-primary/30 bg-gradient-to-br from-primary/[0.08] to-primary/[0.03] hover:border-primary/50 transition-all cursor-pointer shadow-sm"
      onClick={() => navigate(`/events/${nextEvent.id}`)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Date badge */}
          <div className="flex flex-col items-center justify-center rounded-xl bg-primary/15 p-2.5 min-w-[52px]">
            <span className="text-[11px] font-semibold text-primary uppercase leading-none">
              {format(eventDate, "EEE")}
            </span>
            <span className="text-lg font-bold text-primary leading-tight">
              {format(eventDate, "d")}
            </span>
            <span className="text-[10px] text-primary/70 uppercase leading-none">
              {format(eventDate, "MMM")}
            </span>
          </div>

          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <TeamChip teamName={(nextEvent as any).teams?.name} fallbackLabel="" size="sm" />
            </div>
            {(() => {
              const TypeIcon = getEventTypeIcon(nextEvent.type, { miniLeagueId: (nextEvent as any).mini_league_id });
              return (
                <p className="font-medium text-sm text-foreground/90 flex items-center gap-1.5 min-w-0">
                  <TypeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
                  <span className="truncate">
                    {nextEvent.title}
                    {shouldAppendOpponent(nextEvent) && (
                      <span className="text-muted-foreground font-normal"> vs {nextEvent.opponent}</span>
                    )}
                  </span>
                </p>
              );
            })()}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {nextEvent.start_time && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {format(new Date(nextEvent.start_time), "h:mm a")}
                  {nextEvent.end_time && ` – ${format(new Date(nextEvent.end_time), "h:mm a")}`}
                </span>
              )}
              {locationDisplay && (
                <span className="flex items-center gap-1 truncate max-w-[180px]">
                  <MapPin className="h-3 w-3 shrink-0" />
                  {locationDisplay}
                </span>
              )}
              {nextEvent.type === "game" && (() => {
                const mins = getMatchArrivalMinutes(nextEvent as any);
                const arrivalTime = formatMatchArrivalTime(nextEvent as any);
                if (mins == null || !arrivalTime) return null;
                return (
                  <span className="flex items-center gap-1 text-warning">
                    <Clock className="h-3 w-3" />
                    Arrive by {arrivalTime}
                  </span>
                );
              })()}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
