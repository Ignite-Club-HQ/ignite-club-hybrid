import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { MapPin, Check, HelpCircle, X, Clock, ChevronRight, AlertCircle, Play, Eye, CheckCircle2 } from "lucide-react";
import { useCanStartGame } from "@/hooks/useCanStartGame";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { resolveRsvpChildren } from "@/lib/resolveEventChildScope";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { awardEarlyRsvpPoints } from "@/lib/earlyRsvpPoints";
import { Link } from "react-router-dom";
import useEmblaCarousel from "embla-carousel-react";
import { formatEventContextualDate, getEventUrgencyBadge, formatCompactDateTime } from "@/lib/eventRelativeDate";
import { formatMatchArrivalTime } from "@/lib/matchArrivalTime";
import { formatEventTitle } from "@/lib/eventTitle";
import { getEventDisplay } from "@/lib/eventDisplay";
import { TeamChip, getTeamRailColor } from "@/components/events/TeamChip";
import { NextUpHeroRsvpSection } from "@/components/events/NextUpHeroRsvpSection";
import { getEventTypeIcon, getEventTypeAccent, getEventTypeAccentClasses } from "@/lib/eventTypeIcon";
import { getEventTypeLabel } from "@/lib/eventTypeLabel";
import { hasGameBoardSupport } from "@/lib/sportDetection";

import { useEventMembership } from "@/hooks/useEventMembership";
import { isParentFirstEvent } from "@/lib/rsvpAudience";

type RsvpStatus = "going" | "maybe" | "not_going";

interface EventItem {
  id: string;
  title: string;
  type: string;
  event_date: string;
  start_time?: string | null;
  address: string | null;
  location_name: string | null;
  suburb: string | null;
  club_id: string;
  team_id: string | null;
  is_cancelled: boolean;
  is_bye?: boolean;
  opponent: string | null;
  arrival_minutes_before?: number | null;
  teams: { name: string; default_match_arrival_minutes?: number | null } | null;
  clubs: { name: string; sport: string | null };
}

interface NextUpCarouselProps {
  events: EventItem[];
  isLoading?: boolean;
  onReadyChange?: (ready: boolean) => void;
}

function StartGameCta({ event }: { event: EventItem }) {
  const navigate = useNavigate();
  const { canStart, phase } = useCanStartGame(event);
  // Gate by sport — the game board only supports football/soccer in this build.
  // Cricket, AFL, netball, basketball etc. have no board, so hide the CTA.
  const boardKind = hasGameBoardSupport(event.clubs?.sport);
  if (!canStart || !boardKind) return null;
  const label = phase === "live" ? "Open Match" : "Start Game";
  return (
    <div className="pt-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Button
        size="sm"
        className="w-full h-10 gap-2 font-semibold bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onClick={() => navigate(`/events/${event.id}?openPitchBoard=1`)}
      >
        <Play className="h-4 w-4" />
        {label}
      </Button>
    </div>
  );
}

/**
 * Shown to non-controllers (no team_admin/coach role and not Subs Manager)
 * when there is an active live game on the event's team. Opens the read-only
 * spectator view. Hidden for controllers — they already have Start/Open Match.
 */
function WatchLiveCta({ event }: { event: EventItem }) {
  const navigate = useNavigate();
  const { canStart } = useCanStartGame(event);

  // Only show within the live match window: 30 min before kickoff → 3 h after.
  // Prevents stale `active_games` rows from making "Watch Live" appear days
  // before a fixture.
  const inLiveWindow = (() => {
    const kickoffIso = event.start_time || event.event_date;
    if (!kickoffIso) return false;
    const kickoff = new Date(kickoffIso).getTime();
    if (Number.isNaN(kickoff)) return false;
    const now = Date.now();
    return now >= kickoff - 30 * 60 * 1000 && now <= kickoff + 3 * 60 * 60 * 1000;
  })();

  const boardKind = hasGameBoardSupport(event.clubs?.sport);
  const eligible =
    event.type === "game" &&
    !event.is_cancelled &&
    !event.is_bye &&
    !!event.team_id &&
    !!boardKind &&
    !canStart &&
    inLiveWindow;

  const { data: hasLive } = useQuery({
    queryKey: ["watch-live-active", event.team_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("active_games")
        .select("id")
        .eq("team_id", event.team_id!)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      return !!data;
    },
    enabled: eligible,
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  if (!eligible || !hasLive) return null;

  return (
    <div className="pt-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <Button
        size="sm"
        variant="outline"
        className="w-full h-10 gap-2 font-semibold border-destructive/40 text-destructive hover:bg-destructive/10"
        onClick={() => navigate(`/teams/${event.team_id}/watch-live`)}
      >
        <Eye className="h-4 w-4" />
        Watch Live
      </Button>
    </div>
  );
}

// Skeleton height matches the normal collapsed Next Up card. The live card is
// content-sized so it ends at "Your attendance" and only grows when expanded.
const NEXT_UP_CARD_SKELETON_HEIGHT = "h-[340px]";

function NextUpHeroCardSkeleton() {
  return (
    <Card className={`relative overflow-hidden w-full shrink-0 flex flex-col border-border/50 ${NEXT_UP_CARD_SKELETON_HEIGHT}`} aria-hidden="true">
      <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-muted" />
      <CardContent className="p-3.5 pl-4 pr-9 space-y-3 h-full flex flex-col">
        <div className="flex justify-end">
          <div className="h-5 w-16 rounded-full bg-muted animate-pulse" />
        </div>
        <div className="space-y-2">
          <div className="h-7 w-2/3 rounded bg-muted animate-pulse" />
          <div className="h-4 w-4/5 rounded bg-muted/80 animate-pulse" />
        </div>
        <div className="space-y-2 pt-1">
          <div className="h-4 w-3/5 rounded bg-muted/80 animate-pulse" />
          <div className="h-4 w-full rounded bg-muted/70 animate-pulse" />
        </div>
        <div className="mt-auto space-y-2 pt-2">
          <div className="h-4 w-1/2 rounded bg-muted/70 animate-pulse" />
          <div className="grid grid-cols-3 gap-2">
            <div className="h-9 rounded-full bg-muted animate-pulse" />
            <div className="h-9 rounded-full bg-muted animate-pulse" />
            <div className="h-9 rounded-full bg-muted animate-pulse" />
          </div>
          <div className="h-12 rounded-xl bg-muted/50 animate-pulse" />
          <div className="h-4 w-36 rounded bg-muted/60 animate-pulse" />
        </div>
      </CardContent>
    </Card>
  );
}

function formatContextualDate(dateStr: string) {
  return formatEventContextualDate(dateStr);
}

function getUrgencyBadge(dateStr: string) {
  return getEventUrgencyBadge(dateStr);
}

function useChildRsvps(eventId: string, userId: string | undefined) {
  return useQuery({
    queryKey: ["child-rsvps-card", eventId, userId],
    queryFn: async () => {
      const [ownChildren, guardianLinks] = await Promise.all([
        supabase.from("children").select("id").eq("parent_id", userId!),
        supabase.from("child_guardians").select("child_id").eq("guardian_id", userId!),
      ]);
      // Fail loudly on transient errors so React Query keeps prior data
      // (placeholderData) instead of caching an empty "success" that would
      // wipe household children from the RSVP card during a network blip.
      if (ownChildren.error) throw ownChildren.error;
      if (guardianLinks.error) throw guardianLinks.error;
      const childIds = [
        ...(ownChildren.data || []).map(c => c.id),
        ...(guardianLinks.data || []).map(g => g.child_id),
      ];
      if (childIds.length === 0) return [];

      const uniqueChildIds = [...new Set(childIds)];
      const { data, error } = await supabase
        .from("rsvps")
        .select("id, status, child_id, children:child_id(name)")
        .eq("event_id", eventId)
        .in("child_id", uniqueChildIds);
      if (error) throw error;

      return (data || []) as Array<{
        id: string;
        status: string;
        child_id: string;
        children: { name: string } | null;
      }>;
    },
    enabled: !!userId,
    staleTime: 30 * 1000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

function useChildrenForEvent(
  event: Pick<EventItem, "id" | "team_id" | "club_id"> & {
    mini_league_id?: string | null;
    adults_only?: boolean | null;
    target_team_ids?: string[] | null;
    restricted_to_roles?: string[] | null;
    rsvp_audience?: string | null;
  },
  userId: string | undefined,
) {
  const miniLeagueId = (event as any).mini_league_id as string | null | undefined;
  return useQuery({
    queryKey: [
      "event-children-card",
      event.id,
      event.team_id,
      event.club_id,
      miniLeagueId,
      (event as any).adults_only,
      ((event as any).target_team_ids ?? []).join(","),
      ((event as any).restricted_to_roles ?? []).join(","),
      (event as any).rsvp_audience,
      userId,
    ],
    queryFn: async () => {
      // Mini-league events keep their own roster rule: children rostered to
      // the league, which is not a team assignment.
      if (!event.team_id && miniLeagueId) {
        const [ownChildren, guardianLinks] = await Promise.all([
          supabase.from("children").select("id, name").eq("parent_id", userId!),
          supabase
            .from("child_guardians")
            .select("child_id, children!inner (id, name)")
            .eq("guardian_id", userId!),
        ]);
        if (ownChildren.error) throw ownChildren.error;
        if (guardianLinks.error) throw guardianLinks.error;
        const seen = new Set<string>();
        const merged = [
          ...(ownChildren.data || []),
          ...((guardianLinks.data || []) as any[]).map((g) => g.children).filter(Boolean),
        ].filter((child: any) => {
          if (!child?.id || seen.has(child.id)) return false;
          seen.add(child.id);
          return true;
        }) as Array<{ id: string; name: string }>;
        if (merged.length === 0) return merged;
        const { data: players, error: playersError } = await supabase
          .from("mini_league_players")
          .select("child_id")
          .eq("mini_league_id", miniLeagueId)
          .in("child_id", merged.map((c) => c.id));
        if (playersError) throw playersError;
        const allowed = new Set((players || []).map((p: any) => p.child_id).filter(Boolean));
        return merged.filter((c) => allowed.has(c.id));
      }

      // Everything else goes through the single source of truth, which
      // enforces adults-only / parents-only / role-restricted exclusions
      // BEFORE any team lookup, and only ever shows children actually
      // assigned to a team in this event's scope (so a club-wide event can
      // never surface children who belong to another club's teams).
      const children = await resolveRsvpChildren({
        event: {
          team_id: event.team_id,
          club_id: event.club_id,
          target_team_ids: ((event as any).target_team_ids ?? null) as string[] | null,
          rsvp_audience: ((event as any).rsvp_audience ?? null) as string | null,
          adults_only: ((event as any).adults_only ?? null) as boolean | null,
          restricted_to_roles: ((event as any).restricted_to_roles ?? null) as string[] | null,
        },
        userId,
      });
      return children.map((c) => ({ id: c.id, name: c.name }));
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}


function useRsvpSummary(eventId: string, eventType?: string) {
  const isSocial = eventType === "social";
  return useQuery({
    queryKey: ["rsvp-summary", eventId, eventType],
    queryFn: async () => {
      // First get the total count
      let countQuery = supabase
        .from("rsvps")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .eq("status", "going");
      
      if (!isSocial) {
        countQuery = countQuery.not("child_id", "is", null);
      }
      
      const { count } = await countQuery;

      // Then get a few for avatars
      let avatarQuery = supabase
        .from("rsvps")
        .select("id, status, user_id, child_id, mini_league_player_id, children:child_id(name), mini_league_players:mini_league_player_id(name)")
        .eq("event_id", eventId)
        .eq("status", "going");
      
      if (!isSocial) {
        avatarQuery = avatarQuery.not("child_id", "is", null);
      }
      
      const { data: rsvps, error } = await avatarQuery.limit(5);
      if (error) throw error;
      if (!rsvps || rsvps.length === 0) return { avatars: [], totalCount: 0 };

      const guardianUserIds: string[] = [];
      for (const rsvp of rsvps) {
        if (!rsvp.child_id && !rsvp.mini_league_player_id && typeof rsvp.user_id === "string") {
          if (!guardianUserIds.includes(rsvp.user_id)) guardianUserIds.push(rsvp.user_id);
        }
      }

      const profileMap = guardianUserIds.length > 0
        ? Object.fromEntries(
            ((await selectCachedProfilesByIds(guardianUserIds)).data || []).map((profile) => [profile.id, profile])
          )
        : {};

      return {
        avatars: rsvps.map(r => ({
          id: r.id,
          displayName:
            r.children?.name ||
            r.mini_league_players?.name ||
            profileMap[r.user_id]?.display_name ||
            "?",
          avatarUrl:
            r.child_id || r.mini_league_player_id
              ? null
              : profileMap[r.user_id]?.avatar_url || null,
        })),
        totalCount: count || rsvps.length,
      };
    },
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

function HouseholdRsvpSummary({ eventId, userId, currentStatus }: { eventId: string; userId: string | undefined; currentStatus: RsvpStatus | null }) {
  const { data: childRsvps } = useChildRsvps(eventId, userId);
  
  if (!childRsvps || childRsvps.length === 0) {
    return null;
  }

  const goingChildren = childRsvps.filter(r => r.status === "going");
  const maybeChildren = childRsvps.filter(r => r.status === "maybe");
  const notGoingChildren = childRsvps.filter(r => r.status === "not_going");
  const parentHasRsvpd = currentStatus !== null;

  const parts: React.ReactNode[] = [];
  
  // User status
  if (parentHasRsvpd && currentStatus === "going") parts.push(<span key="you" className="text-muted-foreground font-medium">Going</span>);
  else if (parentHasRsvpd && currentStatus === "maybe") parts.push(<span key="you" className="text-muted-foreground font-medium">Maybe</span>);
  else if (parentHasRsvpd && currentStatus === "not_going") parts.push(<span key="you" className="text-muted-foreground font-medium">Can't go</span>);

  if (goingChildren.length > 0) {
    const names = goingChildren.map(c => c.children?.name?.split(' ')[0] || "Child").join(", ");
    parts.push(
      <span key="going" className="flex items-center gap-0.5">
        <Check className="h-2.5 w-2.5 text-primary" />
        <span>{names}</span>
      </span>
    );
  }
  if (maybeChildren.length > 0) {
    const names = maybeChildren.map(c => c.children?.name?.split(' ')[0] || "Child").join(", ");
    parts.push(
      <span key="maybe" className="flex items-center gap-0.5">
        <HelpCircle className="h-2.5 w-2.5 text-warning" />
        <span>{names} maybe</span>
      </span>
    );
  }
  if (notGoingChildren.length > 0) {
    const names = notGoingChildren.map(c => c.children?.name?.split(' ')[0] || "Child").join(", ");
    parts.push(
      <span key="notgoing" className="flex items-center gap-0.5">
        <X className="h-2.5 w-2.5 text-destructive" />
        <span>{names} not going</span>
      </span>
    );
  }

  if (parts.length === 0) return null;

  return (
    <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-0.5">
          {i > 0 && <span className="text-border mx-0.5">·</span>}
          {part}
        </span>
      ))}
    </div>
  );
}

function AttendeeAvatars({ eventId, eventType }: { eventId: string; eventType?: string }) {
  const { data: summary } = useRsvpSummary(eventId, eventType);

  if (!summary || summary.totalCount === 0) return null;

  const visible = summary.avatars.slice(0, 3);
  const remaining = summary.totalCount - visible.length;

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground/70 font-medium uppercase tracking-wide">Attending</span>
      <div className="flex -space-x-1.5">
        {visible.map((rsvp) => (
          <Avatar key={rsvp.id} className="h-5 w-5 border-[1.5px] border-background">
              <AvatarImage src={rsvp.avatarUrl || undefined} />
            <AvatarFallback className="bg-primary/15 text-primary text-[8px] font-medium">
                {rsvp.displayName?.charAt(0)?.toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>
        ))}
      </div>
      {remaining > 0 && (
        <span className="text-[10px] text-muted-foreground">+{remaining}</span>
      )}
    </div>
  );
}

function HeroCard({ event, fullWidth, onNeedsRsvpChange, onReadyChange }: { event: EventItem; fullWidth?: boolean; onNeedsRsvpChange?: (eventId: string, needs: boolean) => void; onReadyChange?: (eventId: string, ready: boolean) => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { label: dateLabel, time: dateTime } = formatContextualDate(event.event_date);
  const compactWhen = formatCompactDateTime(event.event_date);
  // Full location — venue + pitch/court is critical info; never abbreviate or truncate.
  const locationDisplay = event.location_name || event.suburb || event.address?.split(',')[0] || "";
  const typeLabel = getEventTypeLabel(event.type, { miniLeagueId: (event as any).mini_league_id });
  const displayTitle = formatEventTitle(event);
  const eventDisplay = getEventDisplay(event);

  // Team / type visual identity — same system as schedule cards.
  const teamRailHex = getTeamRailColor(event.teams?.name) || `hsl(var(--primary))`;
  const typeAccent = getEventTypeAccent(event.type, {
    miniLeagueId: (event as any).mini_league_id,
    opponent: event.opponent,
  });
  const typeAccentClasses = getEventTypeAccentClasses(typeAccent);
  const isToday = (() => {
    try {
      const today = new Date();
      const evt = new Date(event.event_date);
      return today.toDateString() === evt.toDateString();
    } catch { return false; }
  })();

  const { data: myRsvp, isFetched: myRsvpFetched } = useQuery({
    queryKey: ["hero-rsvp", event.id, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rsvps")
        .select("id, status")
        .eq("event_id", event.id)
        .eq("user_id", user!.id)
        .is("child_id", null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    staleTime: 30 * 1000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });

  const { data: myDuties, isFetched: myDutiesFetched } = useQuery({
    queryKey: ["hero-my-duties", event.id, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("duties")
        .select("id, name, start_time, end_time, status")
        .eq("event_id", event.id)
        .eq("assigned_to", user!.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id && !event.is_cancelled,
    staleTime: 60 * 1000,
  });

  const currentStatus = (myRsvp?.status as RsvpStatus) ?? null;

  const [parentRsvpOpen, setParentRsvpOpen] = useState(false);
  const { data: childrenOnEvent, isFetched: childrenFetched } = useChildrenForEvent(event, user?.id);
  const { data: childRsvps, isFetched: childRsvpsFetched } = useChildRsvps(event.id, user?.id);
  const { data: rsvpSummary, isFetched: rsvpSummaryFetched } = useRsvpSummary(event.id, event.type);
  const { data: isEventMember = true, isFetched: membershipFetched } = useEventMembership({ id: event.id, team_id: event.team_id, club_id: event.club_id, target_team_ids: (event as any).target_team_ids });

  // Hold the card's interactive sections until per-event queries settle so the
  // card doesn't grow (Children's RSVP accordion appears, helper text disappears)
  // a moment after first paint and visibly push the rest of the home page down.
  // Also gates the "RSVP Required" pill so it never flashes before child
  // RSVPs hydrate (which would briefly show the pill on already-responded events).
  const dutiesReady = !user?.id || event.is_cancelled || myDutiesFetched;
  // Fallback timer: offline / very slow secondary queries can leave the six
  // hero queries in "pending" for tens of seconds (browser fetch has no short
  // timeout when the network is down), which strands the card as a skeleton
  // even though the parent events query hydrated instantly from localStorage
  // and the rest of the home page (My Teams, etc.) is fully painted. After
  // 1500ms, reveal with whatever data we have — RSVP buttons still work with
  // no cached `myRsvp`, and missing summary/children data just renders empty
  // instead of a skeleton. Matches the parent carousel's own 1500ms fallback.
  const [heroReadyTimedOut, setHeroReadyTimedOut] = React.useState(false);
  React.useEffect(() => {
    setHeroReadyTimedOut(false);
    const t = setTimeout(() => setHeroReadyTimedOut(true), 1500);
    return () => clearTimeout(t);
  }, [event.id]);
  const heroDataReady = !user || (myRsvpFetched && childrenFetched && childRsvpsFetched && rsvpSummaryFetched && membershipFetched && dutiesReady) || heroReadyTimedOut;

  React.useEffect(() => {
    onReadyChange?.(event.id, heroDataReady);
    return () => onReadyChange?.(event.id, false);
  }, [event.id, heroDataReady, onReadyChange]);

  const rsvpMutation = useMutation({
    mutationFn: async (status: RsvpStatus) => {
      let rsvpId: string | null = null;
      if (myRsvp) {
        const { error } = await supabase.from("rsvps").update({ status }).eq("id", myRsvp.id);
        if (error) throw error;
        rsvpId = myRsvp.id;
      } else {
        const { data: newRsvp, error } = await supabase
          .from("rsvps")
          .insert({ event_id: event.id, user_id: user!.id, status })
          .select("id")
          .single();
        if (error) throw error;
        rsvpId = newRsvp?.id || null;
      }
      // Fire-and-forget: don't block UI for points calculation
      if (status === "going" && rsvpId) {
        awardEarlyRsvpPoints({
          userId: user!.id,
          eventDate: event.event_date,
          rsvpId,
          clubId: event.club_id,
          clubName: event.clubs.name,
        }).catch(console.error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hero-rsvp", event.id] });
      queryClient.invalidateQueries({ queryKey: ["user-rsvps-home"] });
      queryClient.invalidateQueries({ queryKey: ["child-rsvps-card", event.id] });
      queryClient.invalidateQueries({ queryKey: ["rsvp-summary", event.id] });
      queryClient.invalidateQueries({ queryKey: ["next-up-pending-count"] });
    },
    onError: () => {
      toast({ title: "Failed to update RSVP", variant: "destructive" });
    },
  });

  const childRsvpMutation = useMutation({
    mutationFn: async ({ childId, status }: { childId: string; status: RsvpStatus }) => {
      // Server-authoritative lookup — do NOT trust the local cache to decide
      // UPDATE vs INSERT. A cold/stale childRsvps cache would otherwise cause
      // us to INSERT a row that already exists; skip_duplicate_rsvps rescues
      // that server-side, but a permission blip on that path silently no-ops
      // the write and the UI never learns. See mem note in commit.
      const { data: existingRow, error: lookupErr } = await supabase
        .from("rsvps")
        .select("id")
        .eq("event_id", event.id)
        .eq("child_id", childId)
        .maybeSingle();
      if (lookupErr) throw lookupErr;

      let rsvpId: string | null = existingRow?.id ?? null;

      if (rsvpId) {
        const { error } = await supabase
          .from("rsvps")
          .update({ status })
          .eq("id", rsvpId);
        if (error) throw error;
      } else {
        const { data: newRsvp, error } = await supabase
          .from("rsvps")
          .insert({
            event_id: event.id,
            child_id: childId,
            user_id: user!.id,
            status,
          })
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (newRsvp?.id) {
          rsvpId = newRsvp.id;
        } else {
          const { data: fallbackRow } = await supabase
            .from("rsvps")
            .select("id")
            .eq("event_id", event.id)
            .eq("child_id", childId)
            .maybeSingle();
          rsvpId = fallbackRow?.id ?? null;
        }
      }

      // Fire-and-forget: award early RSVP points for child
      if (status === "going" && rsvpId) {
        awardEarlyRsvpPoints({
          userId: user!.id,
          childId,
          eventDate: event.event_date,
          rsvpId,
          clubId: event.club_id,
          clubName: event.clubs?.name || "Your club",
        }).catch(console.error);
      }
    },
    onMutate: async ({ childId, status }) => {
      const key = ["child-rsvps-card", event.id, user?.id];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<any[]>(key);
      queryClient.setQueryData<any[]>(key, (prev) => {
        const list = prev ? [...prev] : [];
        const idx = list.findIndex((r) => r.child_id === childId);
        if (idx >= 0) list[idx] = { ...list[idx], status };
        else list.push({ id: `optimistic-${childId}`, status, child_id: childId, children: null });
        return list;
      });
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["child-rsvps-card", event.id] });
      queryClient.invalidateQueries({ queryKey: ["hero-rsvp", event.id] });
      queryClient.invalidateQueries({ queryKey: ["user-rsvps-home"] });
      queryClient.invalidateQueries({ queryKey: ["rsvp-summary", event.id] });
      queryClient.invalidateQueries({ queryKey: ["next-up-pending-count"] });
    },
    onError: (_err, _vars, context) => {
      // Roll back the optimistic write so the UI cannot show a "confirmed"
      // status that never persisted (root cause of the household-mismatch bug).
      if (context?.previous !== undefined) {
        queryClient.setQueryData(["child-rsvps-card", event.id, user?.id], context.previous);
      }
      queryClient.invalidateQueries({ queryKey: ["child-rsvps-card", event.id] });
      toast({ title: "Failed to update child RSVP", description: "Please try again.", variant: "destructive" });
    },
  });

  // RSVP buttons: selected state must read as locked-in and confirmed at a glance.
  const rsvpOptions: { status: RsvpStatus; label: string; icon: React.ReactNode; activeClass: string; inactiveHint: string }[] = [
    {
      status: "going",
      label: "Going",
      icon: <Check className="h-3.5 w-3.5" />,
      activeClass: "border-rsvp-selected bg-rsvp-selected text-rsvp-selected-foreground shadow-[0_2px_6px_-2px_hsl(var(--rsvp-selected)/0.35)] dark:shadow-[0_2px_6px_-2px_hsl(var(--rsvp-selected)/0.45)] hover:bg-rsvp-selected disabled:opacity-100",
      inactiveHint: "border-border/50 bg-transparent text-foreground/75 shadow-none hover:border-rsvp-selected/40 hover:bg-muted/30 hover:text-foreground disabled:opacity-45",
    },
    {
      status: "maybe",
      label: "Maybe",
      icon: <HelpCircle className="h-3.5 w-3.5" />,
      activeClass: "border-rsvp-selected bg-rsvp-selected text-rsvp-selected-foreground shadow-[0_2px_6px_-2px_hsl(var(--rsvp-selected)/0.35)] dark:shadow-[0_2px_6px_-2px_hsl(var(--rsvp-selected)/0.45)] hover:bg-rsvp-selected disabled:opacity-100",
      inactiveHint: "border-border/50 bg-transparent text-foreground/75 shadow-none hover:border-rsvp-selected/40 hover:bg-muted/30 hover:text-foreground disabled:opacity-45",
    },
    {
      status: "not_going",
      label: "Can't go",
      icon: <X className="h-3.5 w-3.5" />,
      activeClass: "border-rsvp-selected bg-rsvp-selected text-rsvp-selected-foreground shadow-[0_2px_6px_-2px_hsl(var(--rsvp-selected)/0.35)] dark:shadow-[0_2px_6px_-2px_hsl(var(--rsvp-selected)/0.45)] hover:bg-rsvp-selected disabled:opacity-100",
      inactiveHint: "border-border/50 bg-transparent text-foreground/75 shadow-none hover:border-rsvp-selected/40 hover:bg-muted/30 hover:text-foreground disabled:opacity-45",
    },
  ];

  const isMatchDay = !!(event as any).mini_league_id;

  // Guardian context: parent has one or more children rostered on this event's team.
  const hasGuardianChildren = !!(heroDataReady && childrenOnEvent && childrenOnEvent.length > 0);
  const guardianUnrespondedChildren = hasGuardianChildren
    ? childrenOnEvent!.filter((c) => !childRsvps?.find((r) => r.child_id === c.id))
    : [];
  const guardianUnrespondedCount = guardianUnrespondedChildren.length;

  // "Needs RSVP" — in guardian mode this means any child still needs a response;
  // otherwise it falls back to the parent's own un-actioned state.
  const needsRsvp =
    heroDataReady &&
    !event.is_cancelled &&
    !event.is_bye &&
    isEventMember &&
    (hasGuardianChildren
      ? guardianUnrespondedCount > 0
      : currentStatus === null && (childRsvps?.length ?? 0) === 0);

  // Report up to parent so the carousel "X need RSVP" badge stays in sync
  // with what each card actually shows (membership, BYE, guardian children).
  //
  // IMPORTANT: only report while the underlying per-card queries have TRULY
  // settled — never while we're on the 1500 ms `heroReadyTimedOut` fallback
  // branch. Otherwise we optimistically claim "needs RSVP" (currentStatus is
  // still null, childRsvps still empty) and the aggregate pill flashes
  // "1 needs RSVP" for a beat before myRsvp resolves as e.g. "going" and it
  // vanishes. Users read that as a broken/glitchy badge.
  const rsvpDataFullySettled =
    !user ||
    (myRsvpFetched &&
      childrenFetched &&
      childRsvpsFetched &&
      rsvpSummaryFetched &&
      membershipFetched &&
      dutiesReady);

  // Split into two effects so the "report false" cleanup only runs on
  // unmount (or when the card's event.id changes), NOT on every re-render
  // caused by `needsRsvp` toggling. Previously the combined cleanup fired
  // `false` on every dependency change, producing 2 → 1 → 2 flicker in the
  // aggregate count as sibling cards resolved on different frames.
  React.useEffect(() => {
    if (!rsvpDataFullySettled) return;
    onNeedsRsvpChange?.(event.id, !!needsRsvp);
  }, [needsRsvp, event.id, onNeedsRsvpChange, rsvpDataFullySettled]);

  React.useEffect(() => {
    const id = event.id;
    return () => onNeedsRsvpChange?.(id, false);
  }, [event.id, onNeedsRsvpChange]);

  // Only render the amber "RSVP Required" pill / primary-tinted border once
  // the underlying RSVP queries have truly settled. Otherwise the 1500 ms
  // `heroReadyTimedOut` fallback can force the card to reveal with
  // `myRsvp === undefined` / `childRsvps === undefined`, which momentarily
  // satisfies `needsRsvp` even for events the user has already RSVP'd to —
  // producing the ~1s flash of "RSVP Required" on cold start.
  const showNeedsRsvp = needsRsvp && rsvpDataFullySettled;

  const rsvpGroupNoun = event.type === "social" ? "members" : "players";
  const parentFirstEvent = isParentFirstEvent(event);

  const needsRsvpPillLabel = hasGuardianChildren
    ? (guardianUnrespondedCount === 1
        ? `${(guardianUnrespondedChildren[0].name.split(" ")[0] || guardianUnrespondedChildren[0].name)} needs RSVP`
        : `${guardianUnrespondedCount} ${rsvpGroupNoun} need RSVP`)
    : "RSVP Required";

  if (!heroDataReady) {
    return <NextUpHeroCardSkeleton />;
  }

  return (
    <Card
      className={`relative overflow-hidden shadow-md hover:shadow-lg transition-all cursor-pointer w-full shrink-0 min-h-[340px] h-full flex flex-col ${event.is_cancelled ? "opacity-60 border-border/50" : showNeedsRsvp ? "border-primary/40 bg-primary/[0.04]" : "border-border/50"}`}
      role="button"
      tabIndex={0}
      aria-label={`${displayTitle}, ${dateLabel} at ${dateTime}`}
      onClick={() => navigate(`/events/${event.id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/events/${event.id}`); } }}
    >
      {/* Team color rail — primary recognition cue, identical system to the schedule cards */}
      <span
        className="absolute left-0 top-0 bottom-0 w-0.5 pointer-events-none"
        style={{ backgroundColor: teamRailHex, opacity: isToday ? 0.35 : 0.22 }}
        aria-hidden="true"
      />
      {/* Right-edge tap affordance — hidden when RSVP pill is shown to avoid
          competing with the high-emphasis action marker. */}
      {!showNeedsRsvp && (
        <ChevronRight
          className="absolute right-2.5 top-3.5 h-4 w-4 text-muted-foreground/35 pointer-events-none z-10"
          aria-hidden="true"
        />
      )}
      <CardContent className="p-3.5 pl-4 pr-9 space-y-2 h-full flex flex-col">
        {/* Status row: Today badge + needs-RSVP pill + BYE + cancelled marker */}
        {(isToday || event.is_cancelled || event.is_bye || showNeedsRsvp) && (
          <div className="flex items-center justify-end gap-1.5 -mr-3">
            {showNeedsRsvp && !event.is_cancelled && !event.is_bye && (
              <span
                role="status"
                aria-label="RSVP required"
                className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10.5px] font-semibold uppercase tracking-wide bg-amber-500 text-white shadow-sm shadow-amber-500/30 animate-fade-in"
              >
                <AlertCircle className="h-3 w-3" aria-hidden="true" strokeWidth={2.5} />
                {needsRsvpPillLabel}
              </span>
            )}
            {event.is_bye && !event.is_cancelled && (
              <Badge variant="secondary" className="text-[9.5px] h-[18px] px-1.5 font-bold tracking-wider">
                BYE
              </Badge>
            )}
            {isToday && !event.is_cancelled && (
              <Badge
                variant="outline"
                className="text-[9.5px] h-[18px] px-1.5 font-bold uppercase tracking-wide bg-primary/10 text-primary border-primary/30"
              >
                Today
              </Badge>
            )}
            {event.is_cancelled && (
              <Badge variant="destructive" className="text-[9.5px] h-[18px] px-1.5">Cancelled</Badge>
            )}
          </div>
        )}

        {/* HIERARCHY: Team identity first (title-weight), then event context, then logistics */}
        {(() => {
          const TypeIcon = getEventTypeIcon(event.type, { miniLeagueId: (event as any).mini_league_id });
          const isSocial = event.type === "social";
          const hasTeam = !!event.teams?.name;

          if (isSocial) {
            return (
              <div className="space-y-1 min-w-0">
                <h3 className={`text-[17px] font-bold leading-snug text-foreground line-clamp-2 ${event.is_cancelled ? "line-through" : ""}`}>
                  {displayTitle}
                </h3>
                <div className="flex items-center gap-1.5 text-[12px]">
                  <TypeIcon className={`h-4 w-4 shrink-0 ${typeAccentClasses.text}`} aria-hidden="true" />
                  <span className={`font-medium ${typeAccentClasses.text}`}>{typeLabel}</span>
                  {hasTeam && (
                    <>
                      <span className="text-border">·</span>
                      <span className="text-muted-foreground truncate">{event.teams!.name}</span>
                    </>
                  )}
                </div>
              </div>
            );
          }

          const isGame =
            event.type === "game" ||
            event.type === "mini_league" ||
            !!(event as any).mini_league_id ||
            !!event.opponent;

          const isMiniLeagueOnly = !event.team_id && !!(event as any).mini_league_id;
          const isClubWideTitled = !event.team_id && !!displayTitle?.trim();

          return (
            <div className="space-y-1.5">
              {isMatchDay && (
                <span className={`text-[10px] font-bold uppercase tracking-wider ${typeAccentClasses.text}`}>
                  Match Day
                </span>
              )}
              {/* PRIMARY: team identity as title — or actual event title for club-wide/mini-league events with no team */}
              {isClubWideTitled || isMiniLeagueOnly ? (
                <h3 className={`text-[17px] font-bold leading-snug text-foreground line-clamp-2 ${event.is_cancelled ? "line-through" : ""}`}>
                  {displayTitle}
                </h3>
              ) : (
                <TeamChip
                  teamName={event.teams?.name}
                  fallbackLabel=""
                  size="lg"
                  asTitle
                />
              )}

              {/* SECONDARY: event context */}
              <div className={`min-w-0 ${event.is_cancelled ? "line-through" : ""}`}>
                <div className="flex items-center gap-1.5 text-[14px] font-medium leading-snug">
                  <TypeIcon className={`h-4 w-4 shrink-0 ${typeAccentClasses.text}`} aria-hidden="true" />
                  <span className={`min-w-0 truncate ${typeAccent === "default" ? "text-foreground/85" : typeAccentClasses.text}`}>
                    {isGame
                      ? (event.is_bye ? "BYE — no match" : (event.opponent ? `vs ${event.opponent}` : eventDisplay.primary))
                      : eventDisplay.primary}
                  </span>
                </div>
                {!isGame && eventDisplay.secondary && (
                  <p className="mt-0.5 text-[12px] text-muted-foreground/80 leading-snug truncate pl-5">
                    {eventDisplay.secondary}
                  </p>
                )}
              </div>
            </div>
          );
        })()}

        {/* TERTIARY (still highly visible): time + location.
            Location gets its OWN line so long pitch/court names stay fully visible —
            this is the question parents/coaches open the app to answer. */}
        <div className="space-y-0.5 pt-0.5">
          <div className="flex items-center gap-1.5 text-[13.5px] text-foreground font-semibold">
            <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              {compactWhen}
              {event.type === "game" && !event.is_bye && (() => {
                const arrivalTime = formatMatchArrivalTime(event);
                if (!arrivalTime) return null;
                return (
                  <span className="text-warning"> (Arrive {arrivalTime})</span>
                );
              })()}
            </span>
          </div>
          {locationDisplay && (
            <div className="flex items-start gap-1.5 text-[13px] text-foreground/90 pt-0.5">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
              <span className="min-w-0 font-medium leading-snug break-words">{locationDisplay}</span>
            </div>
          )}
        </div>


        {myDuties && myDuties.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 pt-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mr-0.5">
              Your duty:
            </span>
            {myDuties.map((d: any) => {
              const isDone = d.status === "completed";
              const range = d.start_time
                ? `${new Date(d.start_time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${d.end_time ? `–${new Date(d.end_time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`
                : null;
              return (
                <Badge
                  key={d.id}
                  variant="outline"
                  className={
                    isDone
                      ? "text-[10.5px] h-[18px] px-1.5 font-semibold bg-success/15 text-success border-success/30"
                      : "text-[10.5px] h-[18px] px-1.5 font-semibold bg-warning/15 text-warning border-warning/30"
                  }
                >
                  {isDone && <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />}
                  {d.name}{range ? ` · ${range}` : ""}
                </Badge>
              );
            })}
          </div>
        )}




        {/* RSVP Buttons — outline, status-tinted when selected. Lower visual weight than
            previous solid-primary "Going" so the team identity reads first, but tap targets
            stay generous (h-9 = 36px, full row width). */}
        <StartGameCta event={event} />
        <WatchLiveCta event={event} />
        {!event.is_cancelled && !event.is_bye && (
          <div
            className="space-y-2 pt-1"
            // Reserve enough vertical room for the tallest realistic RSVP
            // block (guardian single-child variant: title + buttons + summary
            // card + "Your attendance" disclosure) so the card never grows
            // when per-event queries hydrate a moment after first paint and
            // swap us from the simple-parent branch to the guardian branch.
            // Non-guardian users see a little extra whitespace below their
            // buttons — preferable to the whole page jolting downward.
            
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {/* Render RSVP buttons immediately — don't wait for per-event queries.
                Until heroDataReady, hasGuardianChildren is false so we fall into
                the simple parent-buttons branch with no active selection. When
                queries land we either swap to the guardian variant or light up
                the active state, all within the reserved 168px so nothing jolts. */}
            <NextUpHeroRsvpSection
              childrenOnEvent={childrenOnEvent ?? []}
              childRsvpPending={childRsvpMutation.isPending}
              childRsvpPendingChildId={childRsvpMutation.variables?.childId}
              childRsvpPendingStatus={childRsvpMutation.variables?.status}
              childRsvps={childRsvps}
              currentStatus={currentStatus}
              guardianUnrespondedCount={guardianUnrespondedCount}
              hasGuardianChildren={hasGuardianChildren}
              heroDataReady={heroDataReady}
              onChildRsvp={(childId, status) => childRsvpMutation.mutate({ childId, status })}
              onRsvp={(status) => rsvpMutation.mutate(status)}
              onToggleParentRsvp={() => setParentRsvpOpen((v) => !v)}
              parentFirstEvent={parentFirstEvent}
              parentRsvpOpen={parentRsvpOpen}
              rsvpGroupNoun={rsvpGroupNoun}
              rsvpOptions={rsvpOptions}
              rsvpPending={rsvpMutation.isPending}
              rsvpPendingStatus={rsvpMutation.variables}
              rsvpSummaryTotalCount={rsvpSummary?.totalCount || 0}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CompactCard({ event }: { event: EventItem }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { label: dateLabel, time: dateTime } = formatContextualDate(event.event_date);
  const compactWhen = formatCompactDateTime(event.event_date);

  // Full location — keep pitch/court details visible.
  const locationDisplay = event.location_name || event.suburb || event.address?.split(',')[0] || "";
  const typeLabel = getEventTypeLabel(event.type, { miniLeagueId: (event as any).mini_league_id });
  const displayTitle = formatEventTitle(event);
  const eventDisplay = getEventDisplay(event);

  const { data: myRsvp } = useQuery({
    queryKey: ["hero-rsvp", event.id, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rsvps")
        .select("id, status")
        .eq("event_id", event.id)
        .eq("user_id", user!.id)
        .is("child_id", null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    staleTime: 30 * 1000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });

  const { data: myDuties } = useQuery({
    queryKey: ["hero-my-duties", event.id, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("duties")
        .select("id, name, start_time, end_time, status")
        .eq("event_id", event.id)
        .eq("assigned_to", user!.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id && !event.is_cancelled,
    staleTime: 60 * 1000,
  });

  const currentStatus = (myRsvp?.status as RsvpStatus) ?? null;


  const rsvpIndicator = currentStatus ? (
    <div className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${
      currentStatus === "going" ? "bg-primary/10" :
      currentStatus === "maybe" ? "bg-warning/10" :
      "bg-destructive/10"
    }`}>
      {currentStatus === "going" && <><Check className="h-3 w-3 text-primary" /><span className="text-primary font-medium">Going</span></>}
      {currentStatus === "maybe" && <><HelpCircle className="h-3 w-3 text-warning" /><span className="text-warning font-medium">Maybe</span></>}
      {currentStatus === "not_going" && <><X className="h-3 w-3 text-destructive" /><span className="text-destructive font-medium">Can't go</span></>}
    </div>
  ) : (
    <div className="text-[10px] text-muted-foreground/50 italic">Tap to RSVP</div>
  );

  return (
    <Card
      className="relative cursor-pointer border-border/50 hover:border-primary/30 hover:shadow-md shadow-sm transition-all min-w-[220px] w-[65vw] max-w-[280px] shrink-0"
      role="button"
      tabIndex={0}
      aria-label={`${displayTitle}, ${dateLabel} at ${dateTime}`}
      onClick={() => navigate(`/events/${event.id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/events/${event.id}`); } }}
    >
      <ChevronRight
        className="absolute right-3 top-4 h-4 w-4 text-muted-foreground/35 pointer-events-none z-10"
        aria-hidden="true"
      />
      <CardContent className="p-3.5 pr-7 space-y-2">
        {/* Status: BYE / Cancelled */}
        {(event.is_cancelled || event.is_bye) && (
          <div className="flex items-center justify-end gap-1.5">
            {event.is_bye && !event.is_cancelled && (
              <Badge variant="secondary" className="text-[10px] h-5 font-bold tracking-wider">BYE</Badge>
            )}
            {event.is_cancelled && (
              <Badge variant="destructive" className="text-[10px] h-5">Cancelled</Badge>
            )}
          </div>
        )}

        {/* Social/club events lead with the event name; structured events lead with team. */}
        {(() => {
          const TypeIcon = getEventTypeIcon(event.type, { miniLeagueId: (event as any).mini_league_id });
          const isSocial = event.type === "social";
          const hasTeam = !!event.teams?.name;

          if (isSocial) {
            return (
              <div className="space-y-0.5 min-w-0">
                <h3 className={`text-[14px] font-semibold leading-snug text-foreground line-clamp-2 ${event.is_cancelled ? "line-through" : ""}`}>
                  {displayTitle}
                </h3>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground min-w-0">
                  <TypeIcon className="h-3 w-3 shrink-0 opacity-80" aria-hidden="true" />
                  <span className="truncate">{typeLabel}</span>
                  {hasTeam && (
                    <>
                      <span className="text-border">·</span>
                      <span className="truncate">{event.teams!.name}</span>
                    </>
                  )}
                </div>
              </div>
            );
          }

          const isTrainingType = event.type === "training";
          // Club-wide events (no team) — including targeted multi-team and mini-league-only —
          // surface their actual title rather than the generic "Club event" chip.
          const isClubWideTitled = !event.team_id && !!displayTitle?.trim();
          return (
            <div className="space-y-1 min-w-0">
              {isClubWideTitled ? (
                <h3 className={`text-[14px] font-semibold leading-snug text-foreground line-clamp-2 ${event.is_cancelled ? "line-through" : ""}`}>
                  {displayTitle}
                </h3>
              ) : (
                <TeamChip teamName={event.teams?.name} fallbackLabel="" size="md" />
              )}

              <div className={`min-w-0 ${event.is_cancelled ? "line-through" : ""}`}>
                <div className={`flex items-center gap-1 text-[13px] min-w-0 ${isTrainingType ? "font-medium text-foreground/75" : "font-semibold text-foreground"}`}>
                  <TypeIcon className={`h-3 w-3 shrink-0 ${isTrainingType ? "opacity-55" : "opacity-80"}`} aria-hidden="true" />
                  <span className="truncate">{eventDisplay.primary}</span>
                </div>
                {eventDisplay.secondary && (
                  <p className={`mt-0.5 text-[11px] leading-snug truncate pl-4 ${isTrainingType ? "text-muted-foreground/65" : "text-muted-foreground"}`}>
                    {eventDisplay.secondary}
                  </p>
                )}
              </div>
            </div>
          );
        })()}

        {/* Compact date + time on one line */}
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 text-[12px]">
            <Clock className="h-3 w-3 shrink-0 text-muted-foreground/45" aria-hidden="true" />
            <span className="font-normal text-foreground/80">
              {compactWhen}
              {event.type === "game" && !event.is_bye && (() => {
                const arrivalTime = formatMatchArrivalTime(event);
                if (!arrivalTime) return null;
                return (
                  <span className="text-warning"> (Arrive {arrivalTime})</span>
                );
              })()}
            </span>
          </div>
          {locationDisplay && (
            <div className="flex items-start gap-1.5 text-[12.5px] pt-0.5">
              <MapPin className="h-3 w-3 shrink-0 text-muted-foreground/60 mt-0.5" aria-hidden="true" />
              <span className="font-semibold text-foreground leading-snug break-words">{locationDisplay}</span>
            </div>
          )}
        </div>


        {/* RSVP Status */}
        {myDuties && myDuties.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {myDuties.map((d: any) => {
              const isDone = d.status === "completed";
              const range = d.start_time
                ? `${new Date(d.start_time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${d.end_time ? `–${new Date(d.end_time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`
                : null;
              return (
                <Badge
                  key={d.id}
                  variant="outline"
                  className={
                    isDone
                      ? "text-[10px] h-[18px] px-1.5 font-semibold bg-success/15 text-success border-success/30"
                      : "text-[10px] h-[18px] px-1.5 font-semibold bg-warning/15 text-warning border-warning/30"
                  }
                >
                  {isDone && <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />}
                  {d.name}{range ? ` · ${range}` : ""}
                </Badge>
              );
            })}
          </div>
        )}
        {!event.is_cancelled && !event.is_bye && rsvpIndicator}

      </CardContent>
    </Card>
  );
}

export function NextUpCarousel({ events, isLoading, onReadyChange }: NextUpCarouselProps) {
  const { user } = useAuth();
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    slidesToScroll: 1,
  });
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [scrollSnaps, setScrollSnaps] = React.useState<number[]>([]);
  const allEvents = React.useMemo(() => (events || []).slice(0, 6), [events]);
  const readyTargetIds = React.useMemo(() => allEvents.map((event) => event.id), [allEvents]);
  const [readyIds, setReadyIds] = React.useState<Set<string>>(new Set());

  const onSelect = React.useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  React.useEffect(() => {
    if (!emblaApi) return;
    setScrollSnaps(emblaApi.scrollSnapList());
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", () => {
      setScrollSnaps(emblaApi.scrollSnapList());
      onSelect();
    });
    onSelect();
    return () => { emblaApi.off("select", onSelect); };
  }, [emblaApi, onSelect]);

  // Aggregate "needs RSVP" count — driven by each card's own needsRsvp signal
  // so this badge can never disagree with what's actually shown on the cards
  // (membership, BYE, guardian-children, parent-first events all factor in).
  const carouselEventIds = React.useMemo(
    () => allEvents.filter(e => !e.is_cancelled && !e.is_bye).map(e => e.id),
    [allEvents],
  );

  const [pendingIds, setPendingIds] = React.useState<Set<string>>(new Set());

  const handleHeroReadyChange = React.useCallback((eventId: string, ready: boolean) => {
    setReadyIds(prev => {
      const has = prev.has(eventId);
      if (ready && !has) {
        const next = new Set(prev);
        next.add(eventId);
        return next;
      }
      if (!ready && has) {
        const next = new Set(prev);
        next.delete(eventId);
        return next;
      }
      return prev;
    });
  }, []);

  const handleNeedsRsvpChange = React.useCallback((eventId: string, needs: boolean) => {
    setPendingIds(prev => {
      const has = prev.has(eventId);
      if (needs && !has) {
        const next = new Set(prev);
        next.add(eventId);
        return next;
      }
      if (!needs && has) {
        const next = new Set(prev);
        next.delete(eventId);
        return next;
      }
      return prev;
    });
  }, []);

  // Drop any stale ids no longer in the visible carousel.
  React.useEffect(() => {
    const allowed = new Set(carouselEventIds);
    setPendingIds(prev => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach(id => { if (allowed.has(id)) next.add(id); else changed = true; });
      return changed ? next : prev;
    });
  }, [carouselEventIds]);

  React.useEffect(() => {
    const allowed = new Set(readyTargetIds);
    setReadyIds(prev => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach(id => { if (allowed.has(id)) next.add(id); else changed = true; });
      return changed ? next : prev;
    });
  }, [readyTargetIds]);

  // Section is "ready" once the root events query has resolved AND the first
  // visible HeroCard's per-card queries (RSVP, children, summary, membership,
  // duties) have settled. Without this gate, the unified Home reveal would fire
  // as soon as the events list arrived, but the hero card's body would still
  // be visibly hydrating (pills appearing, helper text swapping) for a beat
  // after My Teams had already painted — which read as "Next Up is slower".
  // Safety: 1500ms fallback so a slow/failed secondary query can never hold
  // back the whole Home reveal.
  const firstEventId = allEvents[0]?.id;
  const firstHeroReady = !firstEventId || readyIds.has(firstEventId);
  const [firstHeroTimedOut, setFirstHeroTimedOut] = React.useState(false);
  React.useEffect(() => {
    if (!firstEventId) return;
    setFirstHeroTimedOut(false);
    const t = setTimeout(() => setFirstHeroTimedOut(true), 1500);
    return () => clearTimeout(t);
  }, [firstEventId]);
  const sectionReady = !isLoading && (firstHeroReady || firstHeroTimedOut);

  React.useEffect(() => {
    onReadyChange?.(sectionReady);
  }, [onReadyChange, sectionReady]);

  const pendingCount = pendingIds.size;

  // Show skeleton while loading to reserve space and prevent layout shift.
  // Height matches live card (340) + dot row reservation (pt-3 + h-6 = 36)
  // so My Teams below does not move when the live card mounts.
  if (isLoading) {
    return (
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="h-6 w-24 rounded bg-muted animate-pulse" />
          <div className="h-4 w-16 rounded bg-muted animate-pulse" />
        </div>
        <div className="rounded-lg bg-muted animate-pulse h-[340px]" />
        <div className="h-[24px]" aria-hidden="true" />
      </section>
    );
  }

  if (!events || events.length === 0) return null;

  const showCarousel = allEvents.length > 1;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-lg font-semibold">Next Up</h2>
          {pendingCount > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] h-5 font-semibold bg-amber-500 text-white shadow-sm shadow-amber-500/30 animate-fade-in shrink-0"
              aria-label={`${pendingCount} ${pendingCount === 1 ? "event needs" : "events need"} your RSVP`}
            >
              <AlertCircle className="h-3 w-3" aria-hidden="true" strokeWidth={2.5} />
              {pendingCount} {pendingCount === 1 ? "needs RSVP" : "need RSVP"}
            </span>
          )}
        </div>
        <Link to="/events" className="text-xs text-muted-foreground/60 hover:text-primary transition-colors shrink-0">
          View all →
        </Link>
      </div>

      {showCarousel ? (
        <div className="relative min-h-[340px]">
          {/* Carousel */}
          <div ref={emblaRef} className="overflow-hidden">
            <div className="flex items-stretch">
              {allEvents.map((event, index) => (
                <div
                  key={event.id}
                  className="flex-[0_0_96%] min-w-0 pr-2 transition-transform duration-300 flex"
                  style={{
                    transform: selectedIndex === index ? "scale(1)" : "scale(0.95)",
                    opacity: selectedIndex === index ? 1 : 0.85,
                    transformOrigin: "center center",
                  }}
                >
                  <div className="min-h-[340px] h-full w-full flex">
                    <HeroCard event={event} fullWidth onNeedsRsvpChange={handleNeedsRsvpChange} onReadyChange={handleHeroReadyChange} />
                  </div>
                </div>
              ))}

            </div>

            {/* Right edge fade gradient */}
            <div className="pointer-events-none absolute top-0 right-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent z-10" />
          </div>

          {/* Pagination dots — always reserve row height so My Teams below
              does not shift when Embla finishes initialising. */}
          <div className="flex items-center justify-center gap-1.5 pt-3 h-[24px]">
            {scrollSnaps.length > 1 &&
              scrollSnaps.map((_, index) => (
                <button
                  key={index}
                  className={`rounded-full transition-all duration-300 ${
                    index === selectedIndex
                      ? "w-5 h-1.5 bg-primary"
                      : "w-1.5 h-1.5 bg-muted-foreground/25 hover:bg-muted-foreground/40"
                  }`}
                  onClick={() => emblaApi?.scrollTo(index)}
                  aria-label={`Go to event ${index + 1}`}
                />
              ))}
          </div>
        </div>
      ) : (
        <div className="min-h-[340px] flex">
          <HeroCard event={allEvents[0]} fullWidth onNeedsRsvpChange={handleNeedsRsvpChange} onReadyChange={handleHeroReadyChange} />
        </div>
      )}
    </section>
  );
}
