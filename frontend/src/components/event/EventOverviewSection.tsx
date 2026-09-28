import type { ComponentProps } from "react";
import { format, parseISO } from "date-fns";
import { CalendarPlus, Clock, DollarSign, Loader2, MapPin, Play, Users } from "lucide-react";
import { EventGroupsManager } from "@/components/EventGroupsManager";
import { EventsHeaderSponsorStrip } from "@/components/events/EventsHeaderSponsorStrip";
import { GoogleMapEmbed } from "@/components/GoogleMapEmbed";
import { MatchScoreCard } from "@/components/event/MatchScoreCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { fetchEventDetail } from "@/features/events/eventDetailRepository";
import { exportEventIcs } from "@/lib/icsExport";
import { getShareUrl } from "@/lib/shareUtils";
import { formatMatchArrivalTime, getMatchArrivalMinutes } from "@/lib/matchArrivalTime";
import type { useToast } from "@/hooks/use-toast";

type EventDetail = NonNullable<Awaited<ReturnType<typeof fetchEventDetail>>>;
type EventRsvp = {
  status: string;
  child_id: string | null;
  mini_league_player_id?: string | null;
  user_id?: string | null;
  mini_league_players?: { child_id?: string | null } | null;
};

type EventOverviewSectionProps = {
  event: EventDetail;
  eventId: string;
  rsvps: EventRsvp[] | undefined;
  eventGuests: unknown[] | undefined;
  playerMembers: Array<{ id: string }> | undefined;
  attendanceUnavailable: boolean;
  eventPrice: number | null;
  isPitchBoardAccessLoading: boolean;
  canAccessPitchBoard: boolean;
  isTeamMembersForPitchLoading: boolean;
  isSoccerClub: boolean;
  teamMembers: unknown[] | undefined;
  setShowPitchBoard: (show: boolean) => void;
  canViewPitchBoardReadOnly: boolean;
  isTeamMember: boolean;
  canManageEvent: boolean;
  canManagePitchBoard: boolean;
  isMiniLeagueEvent: boolean;
  playerOverrides: ComponentProps<typeof EventGroupsManager>["playerOverrides"];
  toast: ReturnType<typeof useToast>["toast"];
};

export function EventOverviewSection({
  event,
  eventId,
  rsvps,
  eventGuests,
  playerMembers,
  attendanceUnavailable,
  eventPrice,
  isPitchBoardAccessLoading,
  canAccessPitchBoard,
  isTeamMembersForPitchLoading,
  isSoccerClub,
  teamMembers,
  setShowPitchBoard,
  canViewPitchBoardReadOnly,
  isTeamMember,
  canManageEvent,
  canManagePitchBoard,
  isMiniLeagueEvent,
  playerOverrides,
  toast,
}: EventOverviewSectionProps) {
  return (
    <>
      {/* Event Info */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{event.title}</h1>
          {event.is_cancelled && (
            <Badge variant="destructive">Cancelled</Badge>
          )}
        </div>
        <p className="text-muted-foreground">{event.clubs?.name}</p>
        {event.teams?.name && (
          <Badge variant="outline">{event.teams.name}</Badge>
        )}
      </div>

      {/* Details Card */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-primary" />
            <span className="flex-1">{format(parseISO(event.event_date), "EEEE, MMMM d 'at' h:mm a")}</span>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-8 w-8 -mr-2"
              aria-label="Add to calendar"
              title="Add to calendar"
              onClick={async () => {
                try {
                  await exportEventIcs({
                    id: event.id,
                    title: event.title,
                    type: event.type,
                    event_date: event.event_date,
                    start_time: (event as any).start_time,
                    end_time: (event as any).end_time,
                    description: event.description,
                    location_name: (event as any).location_name,
                    address: event.address,
                    suburb: (event as any).suburb,
                    state: (event as any).state,
                    postcode: (event as any).postcode,
                    is_cancelled: event.is_cancelled,
                    updated_at: (event as any).updated_at,
                    url: getShareUrl("event", eventId),
                  });
                  toast({ title: "Calendar file ready", description: "Open it to add this event to your calendar." });
                } catch (err) {
                  toast({ title: "Couldn't export event", description: (err as Error).message, variant: "destructive" });
                }
              }}
            >
              <CalendarPlus className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
          {event.address ? (
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p>{event.address}</p>
                <p className="text-muted-foreground">
                  {[event.suburb, event.state, event.postcode].filter(Boolean).join(", ")}
                </p>
              </div>
            </div>
          ) : ((event as any).location_name || (event as any).location) ? (
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                {(event as any).location_name && <p>{(event as any).location_name}</p>}
                {(event as any).location && (event as any).location !== (event as any).location_name && (
                  <p className="text-muted-foreground">{(event as any).location}</p>
                )}
              </div>
            </div>
          ) : null}
          {event.type === "game" && event.opponent && (
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-primary" />
              <span>vs {event.opponent}</span>
            </div>
          )}
          {event.type === "game" && (() => {
            const mins = getMatchArrivalMinutes(event as any);
            const arrivalTime = formatMatchArrivalTime(event as any);
            if (mins == null || !arrivalTime) return null;
            return (
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-warning" />
                <span>
                  Arrive by {arrivalTime}{" "}
                  <span className="text-muted-foreground">({mins} min before kickoff)</span>
                </span>
              </div>
            );
          })()}
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5 text-primary" />
            {rsvps ? (() => {
              const goingRsvps = rsvps.filter(r => r.status === "going");
              const guestCount = eventGuests?.length || 0;
              if (event.type === "social") {
                const adults = goingRsvps.filter(r => r.child_id == null).length + guestCount;
                const children = goingRsvps.filter(r => r.child_id != null).length;
                const total = adults + children;
                return (
                  <span>
                    {total} attending
                    {(adults > 0 || children > 0) && (
                      <span className="text-muted-foreground">
                        {" "}· {adults} adult{adults === 1 ? "" : "s"}, {children} {children === 1 ? "child" : "children"}
                      </span>
                    )}
                  </span>
                );
              }
              // Players-only count: mirror the same filter the Going list uses
              // (child RSVP, mini-league player, or adult RSVP whose membership
              // includes the "player" role) so the header and "Going (N)" tab
              // always agree.
              const playerUserIds = new Set((playerMembers || []).map((m: any) => m.id));
              const _seenKeys = new Set<string>();
              const playerGoing = goingRsvps.filter((r: any) => {
                const isPlayer = r.child_id || r.mini_league_player_id || (r.user_id && playerUserIds.has(r.user_id));
                if (!isPlayer) return false;
                const linkedChildId = r.child_id || r.mini_league_players?.child_id || null;
                const key = linkedChildId ? `c:${linkedChildId}` : r.mini_league_player_id ? `m:${r.mini_league_player_id}` : `u:${r.user_id}`;
                if (_seenKeys.has(key)) return false;
                _seenKeys.add(key);
                return true;
              }).length;
              const count = playerGoing + guestCount;
              return <span>{count} {count === 1 ? "player" : "players"} attending</span>;

            })() : attendanceUnavailable ? (
              <span className="text-destructive">Attendance unavailable</span>
            ) : <span>Loading...</span>}
          </div>

          {/* Price for social events */}
          {event.type === "social" && eventPrice && eventPrice > 0 && (
            <div className="flex items-center gap-3">
              <DollarSign className="h-5 w-5 text-primary" />
              <span>${Number(eventPrice).toFixed(2)} per person</span>
            </div>
          )}
          {/* Pitch Board / Start Game button for game events.
              Admins & coaches can open it for any upcoming game (not just on
              game day) so they can pre-set the lineup and auto-sub plan
              ahead of time. Past games (>3h after kickoff) stay hidden. */}
          {(isPitchBoardAccessLoading || (canAccessPitchBoard && isTeamMembersForPitchLoading)) && event.type === "game" && !!event.team_id && isSoccerClub && (
            <Button variant="outline" className="w-full mt-2" disabled>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Checking match access…
            </Button>
          )}
          {!isPitchBoardAccessLoading && canAccessPitchBoard && teamMembers && (() => {
            const eventTime = parseISO(event.event_date);
            const now = new Date();
            const minutesUntilKickoff = (eventTime.getTime() - now.getTime()) / (1000 * 60);
            const isWithin120Min = minutesUntilKickoff <= 120 && minutesUntilKickoff > 0;
            const hasStarted = minutesUntilKickoff <= 0;
            const isPastGame = hasStarted && minutesUntilKickoff < -180; // more than 3 hours ago

            // Don't show any pitch board button for past games
            if (isPastGame) return null;

            // Live / imminent: prominent CTA
            if (hasStarted || isWithin120Min) {
              return (
                <Button
                  variant="default"
                  size="lg"
                  className="w-full mt-2 h-14 text-lg font-bold gap-3"
                  onClick={() => setShowPitchBoard(true)}
                >
                  <Play className="h-5 w-5" />
                  {hasStarted ? "Open Match" : "Start Game"}
                </Button>
              );
            }

            // Future game: pre-prep lineup & auto-subs
            return (
              <Button
                variant="outline"
                className="w-full mt-2"
                onClick={() => setShowPitchBoard(true)}
              >
                <Play className="h-4 w-4 mr-2" />
                Prepare Lineup &amp; Auto-Subs
              </Button>
            );
          })()}
          {/* Read-only "Watch Live" button for parents when game is in progress */}
          {canViewPitchBoardReadOnly && teamMembers && (
            <Button
              variant="default"
              size="lg"
              className="w-full mt-2 h-14 text-lg font-bold gap-3"
              onClick={() => setShowPitchBoard(true)}
            >
              <Play className="h-5 w-5" />
              Open Pitch Board
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Match Score — viewable by team members; editable by team admins/coaches/club admins, app admins, and the Subs Manager assigned to the event */}
      {event.type === "game" && event.team_id && (isTeamMember || canManageEvent) && (() => {
        const canEditScore = canManagePitchBoard;
        // Fallback: derive opponent from title (e.g. "Round 4: Wolves v Stirling District")
        const derivedOpponent = (() => {
          if (event.opponent) return event.opponent;
          const m = (event.title || "").split(/\s+(?:v|vs|versus)\.?\s+/i);
          return m.length > 1 ? m[m.length - 1].trim() : null;
        })();
        return (
          <MatchScoreCard
            eventId={event.id}
            teamId={event.team_id}
            teamName={event.teams?.name || "Our Team"}
            opponent={derivedOpponent}
            sport={event.clubs?.sport}
            canEdit={canEditScore}
          />
        );
      })()}

      {/* Map */}
      {(() => {
        const mapAddress =
          event.address ||
          (event as any).location ||
          (event as any).location_name ||
          null;
        if (!mapAddress) return null;
        return (
          <GoogleMapEmbed
            address={mapAddress}
            className="w-full h-48 rounded-lg border"
          />
        );
      })()}

      {/* Mini League Matches — PRIMARY section for league events, placed at top */}
      {isMiniLeagueEvent && event.mini_league_id && (
        <>
          <Separator />
          <section className="space-y-3">
            <EventGroupsManager
              eventId={eventId}
              miniLeagueId={event.mini_league_id}
              isAdmin={canManageEvent}
              playerOverrides={playerOverrides}
            />
          </section>
        </>
      )}

      {/* Slim sponsor strip (matches Media header width/style; per-club opt-in) */}
      <div className="max-w-lg mx-auto w-full">
        <EventsHeaderSponsorStrip activeClubFilter={event.club_id} />
      </div>


      {/* Event Views are now surfaced inside the unified Attendance section below */}

      {event.description && (
        <p className="text-muted-foreground whitespace-pre-line">{event.description}</p>
      )}
    </>
  );
}
