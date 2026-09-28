import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import { getEventTypeLabel } from "@/lib/eventTypeLabel";
import { shouldAppendOpponent } from "@/lib/eventTitle";
import { Clock, MapPin, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface EventPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectEvent: (eventId: string) => void;
  teamId?: string;
  clubId?: string;
  /** Set when the chat itself belongs to a mini-league (allows its events). */
  miniLeagueId?: string | null;
  /** Set when the chat itself belongs to a competition (allows its events). */
  competitionId?: string | null;
}

export function EventPickerSheet({ open, onOpenChange, onSelectEvent, teamId, clubId, miniLeagueId, competitionId }: EventPickerSheetProps) {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const today = format(new Date(), "yyyy-MM-dd");

  const { data: events, isLoading } = useQuery({
    queryKey: ["event-picker", teamId, clubId, miniLeagueId, competitionId, user?.id],
    queryFn: async () => {
      // Team chat: this team's own events, plus club-wide GAME events this
      // team is invited to (untargeted, or targeted at this team). Other
      // club-wide event types (social, training) and other teams' events
      // are intentionally excluded. Mini-league and competition events are
      // excluded unless this chat belongs to that mini-league/competition.
      if (teamId) {
        const cols =
          "id, title, event_date, start_time, location_name, location, type, opponent, mini_league_id, competition_match_id, is_cancelled, team_id, target_team_ids";

        const [ownRes, clubGamesRes] = await Promise.all([
          supabase
            .from("events")
            .select(cols)
            .eq("team_id", teamId)
            .eq("is_cancelled", false)
            .gte("event_date", today)
            .order("event_date", { ascending: true })
            .order("start_time", { ascending: true })
            .limit(50),
          clubId
            ? supabase
                .from("events")
                .select(cols)
                .eq("club_id", clubId)
                .is("team_id", null)
                .eq("type", "game")
                .eq("is_cancelled", false)
                .gte("event_date", today)
                .order("event_date", { ascending: true })
                .limit(50)
            : Promise.resolve({ data: [] as any[] }),
        ]);

        const clubGames = ((clubGamesRes as any).data || []).filter((e: any) => {
          const targets = (e.target_team_ids ?? null) as string[] | null;
          return !targets || targets.length === 0 || targets.includes(teamId);
        });

        // Scope gate: hide mini-league / competition events in plain team chats.
        const allowedScope = (e: any) => {
          if (e.mini_league_id) return !!miniLeagueId && e.mini_league_id === miniLeagueId;
          if (e.competition_match_id) return !!competitionId;
          return true;
        };

        const seen = new Set<string>();
        return [...(ownRes.data || []), ...clubGames]
          .filter(allowedScope)
          .filter((e: any) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
          .sort((a: any, b: any) => {
            const dateCmp = (a.event_date || "").localeCompare(b.event_date || "");
            if (dateCmp !== 0) return dateCmp;
            return (a.start_time || "").localeCompare(b.start_time || "");
          })
          .slice(0, 50);
      }



      // Club-wide / group chat: only events the user has access to
      // (events for teams they belong to via role OR as a parent of an assigned child,
      //  plus club-level events with no team_id)
      if (clubId && user?.id) {
        const [rolesRes, childrenRes] = await Promise.all([
          supabase
            .from("user_roles")
            .select("team_id")
            .eq("user_id", user.id)
            .eq("club_id", clubId)
            .not("team_id", "is", null),
          supabase
            .from("children")
            .select("id, child_team_assignments!inner(team_id, teams!inner(club_id))")
            .eq("parent_id", user.id)
            .eq("child_team_assignments.teams.club_id", clubId),
        ]);

        const teamIds = new Set<string>();
        (rolesRes.data || []).forEach((r: any) => { if (r.team_id) teamIds.add(r.team_id); });
        (childrenRes.data || []).forEach((c: any) => {
          (c.child_team_assignments || []).forEach((a: any) => { if (a.team_id) teamIds.add(a.team_id); });
        });
        const teamIdArr = Array.from(teamIds);

        // Club-level events (no team_id) for this club
        const { data: clubEvents } = await supabase
          .from("events")
          .select("id, title, event_date, start_time, location_name, location, type, opponent, mini_league_id, is_cancelled, team_id")
          .eq("club_id", clubId)
          .eq("is_cancelled", false)
          .gte("event_date", today)
          .is("team_id", null)
          .order("event_date", { ascending: true })
          .limit(50);

        let teamEvents: any[] = [];
        if (teamIdArr.length > 0) {
          const { data } = await supabase
            .from("events")
            .select("id, title, event_date, start_time, location_name, location, type, opponent, mini_league_id, is_cancelled, team_id")
            .in("team_id", teamIdArr)
            .eq("is_cancelled", false)
            .gte("event_date", today)
            .order("event_date", { ascending: true })
            .limit(50);
          teamEvents = data || [];
        }

        return [...(clubEvents || []), ...teamEvents]
          .sort((a, b) => {
            const dateCmp = (a.event_date || "").localeCompare(b.event_date || "");
            if (dateCmp !== 0) return dateCmp;
            return (a.start_time || "").localeCompare(b.start_time || "");
          })
          .slice(0, 50);
      }

      return [];
    },
    enabled: open && !!(teamId || clubId) && !!user?.id,
    staleTime: 60 * 1000,
  });

  const filtered = useMemo(() => {
    if (!events) return [];
    if (!search.trim()) return events;
    const q = search.toLowerCase();
    return events.filter(e =>
      e.title?.toLowerCase().includes(q) ||
      e.opponent?.toLowerCase().includes(q)
    );
  }, [events, search]);

  const handleSelect = (eventId: string) => {
    onSelectEvent(eventId);
    onOpenChange(false);
    setSearch("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="!left-0 !right-0 !top-auto !bottom-0 !w-full !max-w-none !translate-x-0 !translate-y-0 !rounded-t-[10px] !rounded-b-none !border-x-0 !border-b-0 !p-0 !gap-0 !h-[85vh] !max-h-[85vh] !overflow-hidden !flex !flex-col"
      >
        <div className="mx-auto mt-2 h-1.5 w-[60px] rounded-full bg-muted shrink-0" />

        <DialogHeader className="px-4 pt-2 pb-3 space-y-0 shrink-0">
          <DialogTitle className="text-center">Share Event</DialogTitle>
        </DialogHeader>

        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search events..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
        </div>

        <div
          data-chat-scroll-lock="true"
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-6 space-y-1.5"
          style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
        >
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">
              {search ? "No events match your search" : "No upcoming events"}
            </p>
          ) : (
            filtered.map(event => {
              const eventDate = parseISO(event.event_date);
              const typeLabel = getEventTypeLabel(event.type, { miniLeagueId: event.mini_league_id });
              const loc = event.location_name || event.location;

              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => handleSelect(event.id)}
                  className="flex items-center gap-2.5 w-full rounded-lg border border-border/50 p-2.5 text-left transition-colors active:bg-muted/50 hover:bg-muted/30 touch-manipulation"
                >
                  <div className="flex flex-col items-center justify-center rounded-lg bg-primary/10 p-1.5 min-w-[38px]">
                    <span className="text-[10px] font-semibold text-primary uppercase leading-none">
                      {format(eventDate, "EEE")}
                    </span>
                    <span className="text-sm font-bold text-primary leading-tight">
                      {format(eventDate, "d")}
                    </span>
                    <span className="text-[9px] text-primary/70 uppercase leading-none">
                      {format(eventDate, "MMM")}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-primary uppercase">{typeLabel}</span>
                    </div>
                    <p className="text-sm font-medium truncate">
                      {event.title}
                      {shouldAppendOpponent(event) && (
                        <span className="text-muted-foreground font-normal"> vs {event.opponent}</span>
                      )}
                    </p>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      {event.start_time && (
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" />
                          {format(new Date(event.start_time), "h:mm a")}
                        </span>
                      )}
                      {loc && (
                        <span className="flex items-center gap-0.5 truncate max-w-[120px]">
                          <MapPin className="h-2.5 w-2.5 shrink-0" />
                          {loc}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
