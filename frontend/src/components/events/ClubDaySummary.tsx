import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { MapPin, Clock, Dumbbell, Users, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { EventCard, type EventCardEvent } from "@/components/events/EventCard";

interface ClubDaySummaryProps {
  selectedDate: Date;
  clubIds: string[];
  /** Team IDs the user is a member of — used for "My teams" filter (default view). */
  myTeamIds?: string[];
  /** Initial scope. Defaults to "my". */
  defaultScope?: "my" | "club";
  /**
   * Full EventCard-shaped events for the selected day that the user has access to.
   * When provided, the "My teams" view renders rich EventCards instead of compact rows.
   */
  myDayEvents?: EventCardEvent[];
  /** Set of event IDs the current user has already viewed (for "New" badge on EventCard). */
  viewedEventIds?: Set<string>;
  /** Returns true if the current user is admin for a given event. */
  isAdminForEvent?: (event: EventCardEvent) => boolean;
}

interface ClubDayEvent {
  id: string;
  title: string;
  type: "game" | "training" | "social" | string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location_name: string | null;
  address: string | null;
  suburb: string | null;
  team_id: string | null;
  team_name: string | null;
  opponent: string | null;
  is_cancelled: boolean;
}

const dayKey = (d: Date) => format(d, "yyyy-MM-dd");

function venueLabel(e: ClubDayEvent): string {
  return (
    e.location_name ||
    [e.address, e.suburb].filter(Boolean).join(", ") ||
    "Location TBD"
  );
}

/**
 * Strip pitch/field suffixes like " - P2 MINI 4V4", " — Pitch 3", " - Field 1"
 * so multiple pitches at the same venue group together.
 */
function venueGroupKey(e: ClubDayEvent): string {
  const raw = venueLabel(e);
  return raw.split(/\s+[-–—]\s+/)[0].trim();
}

function fromEventCardEvent(e: EventCardEvent): ClubDayEvent {
  return {
    id: e.id,
    title: e.title,
    type: e.type as ClubDayEvent["type"],
    event_date: e.event_date,
    start_time: (e as any).start_time || null,
    end_time: (e as any).end_time || null,
    location_name: e.location_name,
    address: e.address,
    suburb: e.suburb,
    team_id: e.team_id,
    team_name: e.teams?.name || null,
    opponent: e.opponent,
    is_cancelled: e.is_cancelled,
  };
}

/**
 * Day summary for a single date. Defaults to showing only events for teams
 * the user belongs to ("My teams"); a toggle switches to a club-wide view
 * (all teams) where events are grouped by venue/location.
 */
export function ClubDaySummary({
  selectedDate,
  clubIds,
  myTeamIds = [],
  defaultScope = "my",
  myDayEvents,
  viewedEventIds,
  isAdminForEvent,
}: ClubDaySummaryProps) {
  const dKey = dayKey(selectedDate);
  const [scope, setScope] = useState<"my" | "club">(defaultScope);

  const { data: events, isLoading } = useQuery({
    queryKey: ["club-day-events", dKey, clubIds.slice().sort().join(",")],
    queryFn: async () => {
      if (!clubIds.length) return [] as ClubDayEvent[];
      const all: ClubDayEvent[] = [];
      for (const clubId of clubIds) {
        const { data, error } = await supabase.rpc("get_club_day_events", {
          _club_id: clubId,
          _day: dKey,
        });
        if (error) throw error;
        if (data) all.push(...(data as ClubDayEvent[]));
      }
      return all.sort((a, b) => {
        const at = a.start_time || a.event_date;
        const bt = b.start_time || b.event_date;
        return at.localeCompare(bt);
      });
    },
    enabled: clubIds.length > 0,
    staleTime: 60 * 1000,
  });

  const myTeamSet = useMemo(() => new Set(myTeamIds), [myTeamIds]);
  const myVisibleEvents = useMemo(() => {
    return (myDayEvents || [])
      .filter((e) => !e.team_id || myTeamSet.has(e.team_id))
      .sort((a: any, b: any) => (a.start_time || a.event_date).localeCompare(b.start_time || b.event_date));
  }, [myDayEvents, myTeamSet]);

  const visible = useMemo(() => {
    if (scope === "club") return events || [];
    // "My teams" = events for any team the user belongs to + club-wide events (no team_id)
    const fromMyDay = myVisibleEvents.map(fromEventCardEvent);
    const fromRpc = (events || []).filter((e) => !e.team_id || myTeamSet.has(e.team_id));
    // De-dupe by id, preferring myDayEvents (richer EventCard data)
    const seen = new Set(fromMyDay.map((e) => e.id));
    return [...fromMyDay, ...fromRpc.filter((e) => !seen.has(e.id))].sort((a, b) => {
      const at = a.start_time || a.event_date;
      const bt = b.start_time || b.event_date;
      return at.localeCompare(bt);
    });
  }, [events, scope, myTeamSet, myVisibleEvents]);

  const games = visible.filter((e) => e.type === "game");
  const trainings = visible.filter((e) => e.type === "training");
  const socials = visible.filter((e) => (e.type as string) === "social");

  // Group by venue (without pitch/field suffix) for club view
  const byVenue = useMemo(() => {
    const map = new Map<string, ClubDayEvent[]>();
    for (const e of visible) {
      const k = venueGroupKey(e);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    for (const [, list] of map) {
      list.sort((a, b) => {
        const at = a.start_time || a.event_date;
        const bt = b.start_time || b.event_date;
        return at.localeCompare(bt);
      });
    }
    return Array.from(map.entries());
  }, [visible]);

  const extraAcrossClub = scope === "my" && events ? Math.max(0, events.length - visible.length) : 0;
  const primaryCount = games.length > 0 ? games.length : visible.length;
  const primaryLabel = games.length > 0
    ? `${primaryCount} game${primaryCount === 1 ? "" : "s"} today`
    : `${primaryCount} event${primaryCount === 1 ? "" : "s"} today`;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight text-foreground leading-tight truncate">
          {format(selectedDate, "EEEE, MMMM d")}
        </h2>
        {visible.length > 0 && (
          <p className="text-xs text-muted-foreground truncate">
            {primaryLabel}
            {extraAcrossClub > 0 && (
              <> <span aria-hidden="true">•</span> {extraAcrossClub} more across club</>
            )}
          </p>
        )}
      </div>

      <ToggleGroup
        type="single"
        value={scope}
        onValueChange={(v) => v && setScope(v as "my" | "club")}
        className="w-full grid grid-cols-2 gap-1 rounded-xl bg-muted p-1"
      >
        <ToggleGroupItem
          value="my"
          aria-label="Show events for me"
          className="h-10 min-h-[40px] px-4 rounded-lg text-sm font-medium gap-1.5 text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:font-semibold data-[state=on]:shadow-sm transition-colors"
        >
          <Users className="h-4 w-4" />
          For me
        </ToggleGroupItem>
        <ToggleGroupItem
          value="club"
          aria-label="Show events across the whole club"
          className="h-10 min-h-[40px] px-4 rounded-lg text-sm font-medium gap-1.5 text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:font-semibold data-[state=on]:shadow-sm transition-colors"
        >
          <Building2 className="h-4 w-4" />
          Whole club
        </ToggleGroupItem>
      </ToggleGroup>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : visible.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground text-sm">
              {scope === "my"
                ? "Nothing scheduled for you on this day."
                : "Nothing scheduled across the club on this day."}
            </p>
            {scope === "my" && events && events.length > 0 && (
              <button
                onClick={() => setScope("club")}
                className="text-xs text-primary mt-2 underline"
              >
                See {events.length} club-wide event{events.length === 1 ? "" : "s"}
              </button>
            )}
          </CardContent>
        </Card>
      ) : scope === "club" ? (
        <div className="space-y-3">
          {byVenue.map(([venue, list]) => (
            <div key={venue} className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 text-primary" />
                <span className="truncate">{venue}</span>
                <span>({list.length})</span>
              </div>
              <div className="space-y-2">
                {list.map((e) => (
                  <DayEventRow key={e.id} event={e} hideVenue />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((v) => {
            // Prefer rich EventCard from the main events query for "My teams".
            // The club-day RPC is only a fallback/club-wide source and can be
            // more restrictive than a parent's child-team membership path.
            const rich = myVisibleEvents.find((e) => e.id === v.id) || myDayEvents?.find((e) => e.id === v.id);
            if (rich) {
              return (
                <EventCard
                  key={v.id}
                  event={rich}
                  isAdmin={isAdminForEvent ? isAdminForEvent(rich) : false}
                  hasViewed={viewedEventIds ? viewedEventIds.has(v.id) : true}
                />
              );
            }
            return <DayEventRow key={v.id} event={v} />;
          })}
        </div>
      )}
    </div>
  );
}

function DayEventRow({ event, hideVenue = false }: { event: ClubDayEvent; hideVenue?: boolean }) {
  const navigate = useNavigate();
  const time = event.start_time
    ? format(new Date(event.start_time), "h:mma").toLowerCase()
    : null;
  const venue = hideVenue ? null : venueLabel(event);
  const isTraining = event.type === "training";

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/events/${event.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(`/events/${event.id}`);
        }
      }}
      className="cursor-pointer hover:bg-accent/50 active:bg-accent transition-colors"
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {!hideVenue && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] py-0 h-4 shrink-0",
                    isTraining ? "border-primary/40 text-primary" : "border-destructive/40 text-destructive"
                  )}
                >
                  {isTraining ? "Training" : "Game"}
                </Badge>
              )}
              <p className="font-medium text-sm truncate">
                {event.team_name || event.title}
                {event.opponent ? (
                  <span className="text-muted-foreground"> vs {event.opponent}</span>
                ) : null}
              </p>
              {event.is_cancelled && (
                <Badge variant="destructive" className="text-[10px] py-0 h-4">
                  Cancelled
                </Badge>
              )}
            </div>
            {venue && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{venue}</span>
              </div>
            )}
            {hideVenue && isTraining && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                <Dumbbell className="h-3 w-3 shrink-0" />
                <span>Training</span>
              </div>
            )}
          </div>
          {time && (
            <div className="flex items-center gap-1 text-xs font-medium text-foreground shrink-0">
              <Clock className="h-3 w-3" />
              {time}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
