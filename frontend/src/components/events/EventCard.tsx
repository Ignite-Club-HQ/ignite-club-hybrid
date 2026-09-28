import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useDeleteEvent } from "@/hooks/useDeleteEvent";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { RecurringEventActionDialog } from "@/components/RecurringEventActionDialog";
import { CancelEventConfirmDialog } from "@/components/CancelEventConfirmDialog";
import { RecurringCancelEventDialog } from "@/components/RecurringCancelEventDialog";
import { Clock, MapPin, Pencil, Bell, XCircle, Trash2, CheckCircle2, HelpCircle, X, ChevronRight, Users, MoreVertical, AlertCircle } from "lucide-react";
import { getEventTypeLabel } from "@/lib/eventTypeLabel";
import { supabase } from "@/integrations/supabase/client";
import { useViewerIsAdultPlayer } from "@/hooks/useViewerIsAdultPlayer";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { friendlyMutationError } from "@/lib/friendlyMutationError";
import { formatEventContextualDate, formatCompactDateTime } from "@/lib/eventRelativeDate";
import { formatMatchArrivalTime } from "@/lib/matchArrivalTime";
import { formatEventTitle } from "@/lib/eventTitle";
import { getEventDisplay } from "@/lib/eventDisplay";
import { TeamChip, getTeamRailColor } from "@/components/events/TeamChip";
import { getEventTypeIcon, getEventTypeAccent, getEventTypeAccentClasses } from "@/lib/eventTypeIcon";

import { buildPersonalRsvpLine } from "@/lib/personalRsvpLine";
import { useEventMembership } from "@/hooks/useEventMembership";
import {
  resolveRsvpAudience,
  shouldPromptPlayer,
  shouldPromptSelf,
  type RsvpAudience,
} from "@/lib/rsvpAudience";
import { awardEarlyRsvpPoints } from "@/lib/earlyRsvpPoints";
import { getEventEligibleTeamIds, eventTargetTeamKey } from "@/lib/eventAudience";

type RsvpStatus = "going" | "maybe" | "not_going";

export interface EventCardEvent {
  id: string;
  title: string;
  type: "game" | "training" | "social";
  event_date: string;
  start_time?: string | null;
  address: string | null;
  suburb: string | null;
  location_name: string | null;
  club_id: string;
  team_id: string | null;
  mini_league_id: string | null;
  is_cancelled: boolean;
  is_bye?: boolean | null;
  is_recurring: boolean;
  parent_event_id: string | null;
  opponent: string | null;
  arrival_minutes_before?: number | null;
  rsvp_audience?: string | null;
  teams: {
    name: string;
    default_match_arrival_minutes?: number | null;
    default_rsvp_audience?: string | null;
  } | null;
  clubs: { name: string; sport: string | null };
}


interface EventCardProps {
  event: EventCardEvent;
  isAdmin: boolean;
  hasViewed?: boolean;
  /** Index in stacked list — used for subtle zebra tinting to break the wall-of-cards effect. */
  stackIndex?: number;
}

function formatContextualDate(dateStr: string) {
  const { label, time } = formatEventContextualDate(dateStr);
  return `${label} · ${time}`;
}

function buildFamilyRsvpSummary(
  parentStatus: RsvpStatus | null,
  parentName: string | undefined,
  childRsvps: Array<{ id: string; status: string; child_id: string; children: { name: string } | null }> | undefined
) {
  // Build a family line like "You + Archie, Teddy" or "Archie going, Teddy maybe"
  const goingNames: string[] = [];
  const maybeNames: string[] = [];
  const notGoingNames: string[] = [];

  if (parentStatus === "going") goingNames.push("You");
  else if (parentStatus === "maybe") maybeNames.push("You");
  else if (parentStatus === "not_going") notGoingNames.push("You");

  childRsvps?.forEach((rsvp) => {
    const name = rsvp.children?.name?.split(" ")[0] || "Child";
    if (rsvp.status === "going") goingNames.push(name);
    else if (rsvp.status === "maybe") maybeNames.push(name);
    else if (rsvp.status === "not_going") notGoingNames.push(name);
  });

  return { goingNames, maybeNames, notGoingNames };
}

export function EventCard({ event, isAdmin, hasViewed = true, stackIndex = 0 }: EventCardProps) {
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [remindDialogOpen, setRemindDialogOpen] = useState(false);
  const [nonRsvpCount, setNonRsvpCount] = useState<number | null>(null);

  const isRecurring = event.is_recurring || event.parent_event_id;
  const typeLabel = getEventTypeLabel(event.type, { miniLeagueId: event.mini_league_id });
  // Location: full visibility — pitch/court details are operationally critical.
  // Do NOT abbreviate; let the dedicated row wrap if needed.
  const locationDisplay = event.location_name || event.suburb || event.address?.split(",")[0] || "";
  const displayTitle = formatEventTitle(event);
  const eventDisplay = getEventDisplay(event);
  const compactWhen = formatCompactDateTime(event.event_date);

  // Team / type visual identity — drives the left color rail and accent tints.
  const teamRailColor = getTeamRailColor(event.teams?.name);
  const typeAccent = getEventTypeAccent(event.type, {
    miniLeagueId: event.mini_league_id,
    opponent: event.opponent,
  });
  const typeAccentClasses = getEventTypeAccentClasses(typeAccent);

  // Fetch final score for past match events to display inline.
  const isPastMatch =
    event.type === "game" &&
    !event.is_cancelled &&
    !event.is_bye &&
    new Date(event.event_date).getTime() < Date.now();
  const { data: matchScore } = useQuery({
    queryKey: ["event-card-score", event.id],
    enabled: isPastMatch,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("game_results")
        .select("home_score, away_score, home_label, away_label")
        .eq("event_id", event.id)
        .maybeSingle();
      return data;
    },
  });
  // "Today" boost — full-strength rail; otherwise dim slightly so today reads first.
  const isToday = (() => {
    try {
      const today = new Date();
      const evt = new Date(event.event_date);
      return today.toDateString() === evt.toDateString();
    } catch { return false; }
  })();
  const railOpacity = isToday ? 1 : 0.7;
  const railHex = teamRailColor || `hsl(var(--primary))`;
  // Zebra: barely-perceptible alternation for stacked lists
  const zebraBg = stackIndex % 2 === 1 ? "bg-card/60" : "bg-card";




  const { data: hasPro } = useQuery({
    queryKey: ["event-pro-status", event.team_id, event.club_id],
    queryFn: async () => {
      if (event.team_id) {
        const { data: teamSub } = await supabase
          .from("team_subscriptions")
          .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .eq("team_id", event.team_id)
          .maybeSingle();
        if (teamSub?.is_pro || teamSub?.is_pro_football || teamSub?.admin_pro_override || teamSub?.admin_pro_football_override) return true;
      }
      const { data: clubSub } = await supabase
        .from("club_subscriptions")
        .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .eq("club_id", event.club_id)
        .maybeSingle();
      return clubSub?.is_pro || clubSub?.is_pro_football || clubSub?.admin_pro_override || clubSub?.admin_pro_football_override;
    },
  });

  // Fetch user's own RSVP
  const { data: myRsvp, isLoading: myRsvpLoading } = useQuery({
    queryKey: ["card-rsvp", event.id, user?.id],
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
    enabled: !!user && !event.is_cancelled,
  });

  // Resolve effective RSVP audience (event override → team default → players_only)
  const audience: RsvpAudience = resolveRsvpAudience(
    event.rsvp_audience,
    event.teams?.default_rsvp_audience,
  );
  const { data: viewerIsAdultPlayer } = useViewerIsAdultPlayer({
    team_id: event.team_id,
    club_id: event.club_id,
    target_team_ids: (event as any).target_team_ids ?? null,
  });
  const promptParent = shouldPromptSelf(audience, viewerIsAdultPlayer);
  const promptPlayer = shouldPromptPlayer(audience);

  // Fetch full household children (so we can show "Louie needs RSVP" even when no row exists yet)
  const { data: householdChildren, isLoading: childRsvpsLoading } = useQuery({
    queryKey: [
      "card-child-rsvps",
      event.id,
      user?.id,
      event.team_id,
      eventTargetTeamKey(event as any),
      event.mini_league_id,
      (event as any).adults_only,
    ],
    queryFn: async () => {
      if ((event as any).adults_only) return [] as any[];
      const [ownChildren, guardianLinks] = await Promise.all([
        supabase.from("children").select("id, name").eq("parent_id", user!.id),
        supabase
          .from("child_guardians")
          .select("child_id, children:child_id(id, name)")
          .eq("guardian_id", user!.id),
      ]);
      const merged: Array<{ id: string; name: string }> = [
        ...((ownChildren.data || []) as any[]).map((c) => ({ id: c.id, name: c.name })),
        ...((guardianLinks.data || []) as any[])
          .map((g) => g.children)
          .filter(Boolean)
          .map((c: any) => ({ id: c.id, name: c.name })),
      ];
      const seen = new Set<string>();
      let children = merged.filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
      if (children.length === 0) return [];

      // CRITICAL: only show children actually rostered to this event's
      // team(s)/league. Multi-team targeted events (team_id NULL +
      // target_team_ids) must intersect against every targeted team — never
      // fall through to "no filter".
      const childIds = children.map((c) => c.id);
      const eligibleTeamIds = getEventEligibleTeamIds(event as any);
      if (eligibleTeamIds) {
        const { data: assigns } = await supabase
          .from("child_team_assignments")
          .select("child_id")
          .in("team_id", eligibleTeamIds)
          .in("child_id", childIds);
        const allowed = new Set((assigns || []).map((a: any) => a.child_id));
        children = children.filter((c) => allowed.has(c.id));
      } else if (event.mini_league_id) {
        const { data: players } = await supabase
          .from("mini_league_players")
          .select("child_id")
          .eq("mini_league_id", event.mini_league_id)
          .in("child_id", childIds);
        const allowed = new Set((players || []).map((p: any) => p.child_id).filter(Boolean));
        children = children.filter((c) => allowed.has(c.id));
      } else {
        // Club-wide event with no team scope — don't show child rows (can't verify roster).
        children = [];
      }

      if (children.length === 0) return [];

      const { data: rsvpRows } = await supabase
        .from("rsvps")
        .select("id, status, child_id")
        .eq("event_id", event.id)
        .in(
          "child_id",
          children.map((c) => c.id),
        );
      const byChild = new Map<string, { id: string; status: string }>();
      (rsvpRows || []).forEach((r: any) => {
        if (r.child_id) byChild.set(r.child_id, { id: r.id, status: r.status });
      });
      return children.map((c) => ({
        child_id: c.id,
        name: c.name,
        rsvp: byChild.get(c.id) || null,
      }));
    },
    enabled: !!user && !event.is_cancelled,
  });






  // Fetch total event attendance counts
  // Social events: count everyone (parents + children)
  // Games/Training: count only players (child RSVPs)
  const isSocialEvent = event.type === "social";
  const { data: attendanceCounts } = useQuery({
    queryKey: ["card-attendance-counts", event.id, event.type],
    queryFn: async () => {
      let query = supabase
        .from("rsvps")
        .select("status")
        .eq("event_id", event.id);
      
      if (!isSocialEvent) {
        // For games/training, only count child (player) RSVPs
        query = query.not("child_id", "is", null);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      const counts = { going: 0, maybe: 0, not_going: 0 };
      (data || []).forEach((r) => {
        if (r.status === "going") counts.going++;
        else if (r.status === "maybe") counts.maybe++;
        else if (r.status === "not_going") counts.not_going++;
      });
      return counts;
    },
    enabled: !event.is_cancelled,
  });

  // My duties for this event — render a tag so the user sees what they're rostered for.
  const { data: myDuties } = useQuery({
    queryKey: ["card-my-duties", event.id, user?.id],
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

  const currentRsvpStatus = (myRsvp?.status as RsvpStatus) ?? null;
  const canSendReminders = hasPro === true;
  const { data: isEventMember = true } = useEventMembership({ id: event.id, team_id: event.team_id, club_id: event.club_id, target_team_ids: (event as any).target_team_ids });

  // Invalidate every cache key the household RSVP touches.
  const invalidateRsvpQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["card-rsvp", event.id] });
    queryClient.invalidateQueries({ queryKey: ["card-child-rsvps", event.id] });
    queryClient.invalidateQueries({ queryKey: ["card-attendance-counts", event.id] });
    queryClient.invalidateQueries({ queryKey: ["event-rsvps", event.id] });
    queryClient.invalidateQueries({ queryKey: ["event-rsvps-going", event.id] });
    queryClient.invalidateQueries({ queryKey: ["user-rsvps-home"] });
    queryClient.invalidateQueries({ queryKey: ["upcoming-events"] });
    queryClient.invalidateQueries({ queryKey: ["hero-rsvp", event.id] });
    queryClient.invalidateQueries({ queryKey: ["quick-rsvp", event.id] });
    queryClient.invalidateQueries({ queryKey: ["rsvp-summary", event.id] });
    // Also refresh the Next Up carousel's own RSVP caches so the home card
    // doesn't show "awaiting RSVP" after an RSVP made from the Schedule.
    queryClient.invalidateQueries({ queryKey: ["child-rsvps-card", event.id] });
    queryClient.invalidateQueries({ queryKey: ["event-children-card", event.id] });
    queryClient.invalidateQueries({ queryKey: ["next-up-pending-count"] });
  }, [queryClient, event.id]);

  // Self RSVP (parent attending too)
  const selfRsvpMutation = useMutation({
    mutationFn: async (status: RsvpStatus) => {
      let rsvpId: string | null = null;
      if (myRsvp) {
        const { error } = await supabase.from("rsvps").update({ status }).eq("id", myRsvp.id);
        if (error) throw error;
        rsvpId = myRsvp.id;
      } else {
        const { data, error } = await supabase
          .from("rsvps")
          .insert({ event_id: event.id, user_id: user!.id, status })
          .select("id")
          .single();
        if (error) throw error;
        rsvpId = data?.id || null;
      }
      if (status === "going" && rsvpId) {
        awardEarlyRsvpPoints({
          userId: user!.id,
          eventDate: event.event_date,
          rsvpId,
          clubId: event.club_id,
          clubName: event.clubs?.name,
        }).catch(console.error);
      }
    },
    onSuccess: invalidateRsvpQueries,
    onError: (e: Error) => toast({ title: "Failed to RSVP", description: e.message, variant: "destructive" }),
  });

  // Per-child RSVP
  const childRsvpMutation = useMutation({
    mutationFn: async ({ childId, status }: { childId: string; status: RsvpStatus }) => {
      const existing = (householdChildren || []).find((c) => c.child_id === childId)?.rsvp;
      let rsvpId: string | null = null;
      if (existing) {
        const { error } = await supabase.from("rsvps").update({ status }).eq("id", existing.id);
        if (error) throw error;
        rsvpId = existing.id;
      } else {
        const { data, error } = await supabase
          .from("rsvps")
          .insert({ event_id: event.id, user_id: user!.id, child_id: childId, status })
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (data?.id) {
          rsvpId = data.id;
        } else {
          const { data: existingRow } = await supabase
            .from("rsvps")
            .select("id")
            .eq("event_id", event.id)
            .eq("child_id", childId)
            .maybeSingle();
          rsvpId = existingRow?.id ?? null;
        }
      }
      if (status === "going" && rsvpId) {
        awardEarlyRsvpPoints({
          userId: user!.id,
          childId,
          eventDate: event.event_date,
          rsvpId,
          clubId: event.club_id,
          clubName: event.clubs?.name,
        }).catch(console.error);
      }
    },
    onSuccess: invalidateRsvpQueries,
    onError: (e: Error) => toast({ title: "Failed to RSVP", description: e.message, variant: "destructive" }),
  });



  // Shared reliable deletion: awaited, error-checked, cache-purged. The dialog
  // stays open and disabled until the database confirms.
  const { deleteEvent, isPending: deletePending } = useDeleteEvent({
    entityLabel: typeLabel,
    onDeleted: () => setDeleteDialogOpen(false),
  });

  const handleConfirmDelete = (deleteType: "single" | "series") => {
    void deleteEvent(
      { id: event.id, is_recurring: event.is_recurring, parent_event_id: event.parent_event_id },
      deleteType,
    );
  };



  const cancelEventMutation = useMutation({
    mutationFn: async ({ cancelType, customMessage, sendPushNotification }: { cancelType: "single" | "series"; customMessage?: string; sendPushNotification?: boolean }) => {
      if (cancelType === "series" && event.parent_event_id) {
        await supabase.from("events").update({ is_cancelled: true, chat_cancel_post_handled: true }).eq("parent_event_id", event.parent_event_id);
        await supabase.from("events").update({ is_cancelled: true, chat_cancel_post_handled: true }).eq("id", event.parent_event_id);
      } else if (cancelType === "series" && event.is_recurring) {
        await supabase.from("events").update({ is_cancelled: true, chat_cancel_post_handled: true }).eq("parent_event_id", event.id);
        await supabase.from("events").update({ is_cancelled: true, chat_cancel_post_handled: true }).eq("id", event.id);
      } else {
        const { error } = await supabase.from("events").update({ is_cancelled: true, chat_cancel_post_handled: true }).eq("id", event.id);
        if (error) throw error;
      }

      // Get members and post cancellation message
      let uniqueMembers: string[] = [];
      if (event.mini_league_id) {
        const { data: league } = await supabase.from("mini_leagues").select("club_id").eq("id", event.mini_league_id).single();
        if (league) {
          const { data: playersData } = await supabase.from("mini_league_players").select("parent_user_id").eq("mini_league_id", event.mini_league_id).not("parent_user_id", "is", null);
          const parentIds = (playersData?.map((p) => p.parent_user_id).filter(Boolean) as string[]) || [];
          const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("club_id", league.club_id).in("role", ["club_admin", "league_admin", "coach"]);
          const adminIds = adminRoles?.map((r) => r.user_id) || [];
          uniqueMembers = [...new Set([...parentIds, ...adminIds])];
        }
      } else {
        let memberQuery = supabase.from("user_roles").select("user_id");
        if (event.team_id) {
          memberQuery = memberQuery.eq("team_id", event.team_id);
        } else {
          memberQuery = memberQuery.eq("club_id", event.club_id);
        }
        const { data: members } = await memberQuery;
        uniqueMembers = [...new Set(members?.map((m) => m.user_id) || [])];
      }

      if (user) {
        const eventUrl = `${window.location.origin}/events/${event.id}`;
        const cancellationMessage = customMessage
          ? `📢 Event Cancelled: "${event.title}"\n\n${customMessage}\n\nView event: ${eventUrl}`
          : `📢 Event Cancelled: "${event.title}"\n\nView event: ${eventUrl}`;

        if (event.mini_league_id) {
          const { data: chatGroup } = await supabase.from("chat_groups").select("id").eq("mini_league_id", event.mini_league_id).maybeSingle();
          if (chatGroup) {
            await supabase.from("group_messages").insert({ group_id: chatGroup.id, author_id: user.id, text: cancellationMessage });
          }
        } else if (event.team_id) {
          await supabase.from("team_messages").insert({ team_id: event.team_id, author_id: user.id, text: cancellationMessage });
        } else {
          await supabase.from("club_messages").insert({ club_id: event.club_id, author_id: user.id, text: cancellationMessage });
        }
      }

      return uniqueMembers.length;
    },
    onSuccess: () => {
      setCancelDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (error) => {
      toast(friendlyMutationError(error, { title: "Failed to cancel event", description: "Please try again." }));
    },
  });

  const remindMutation = useMutation({
    mutationFn: async () => {
      const { data: rsvps } = await supabase.from("rsvps").select("user_id").eq("event_id", event.id);
      const rsvpUserIds = rsvps?.map((r) => r.user_id) || [];
      let memberQuery = supabase.from("user_roles").select("user_id");
      if (event.team_id) {
        memberQuery = memberQuery.eq("team_id", event.team_id);
      } else {
        memberQuery = memberQuery.eq("club_id", event.club_id);
      }
      const { data: members } = await memberQuery;
      const allMemberIds = [...new Set(members?.map((m) => m.user_id) || [])];
      const nonRsvpMembers = allMemberIds.filter((id) => !rsvpUserIds.includes(id));
      if (nonRsvpMembers.length === 0) throw new Error("Everyone has already RSVPed!");
      const { data: existingNotifications } = await supabase.from("notifications").select("user_id").eq("type", "event_reminder").eq("related_id", event.id).in("user_id", nonRsvpMembers);
      const existingNotificationUserIds = existingNotifications?.map((n) => n.user_id) || [];
      const membersToNotify = nonRsvpMembers.filter((id) => !existingNotificationUserIds.includes(id));
      if (membersToNotify.length === 0) throw new Error("All members have already been reminded!");
      const notifications = membersToNotify.map((userId) => ({
        user_id: userId,
        type: "event_reminder",
        message: `Reminder: Please RSVP for "${event.title}"`,
        related_id: event.id,
      }));
      const { error } = await supabase.from("notifications").insert(notifications);
      if (error) throw error;
      return membersToNotify.length;
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to send reminders", variant: "destructive" });
    },
  });

  const handleRemindClick = async () => {
    const { data: rsvps } = await supabase.from("rsvps").select("user_id").eq("event_id", event.id);
    const rsvpUserIds = rsvps?.map((r) => r.user_id) || [];
    let memberQuery = supabase.from("user_roles").select("user_id");
    if (event.team_id) {
      memberQuery = memberQuery.eq("team_id", event.team_id);
    } else {
      memberQuery = memberQuery.eq("club_id", event.club_id);
    }
    const { data: members } = await memberQuery;
    const allMemberIds = [...new Set(members?.map((m) => m.user_id) || [])];
    const count = allMemberIds.filter((id) => !rsvpUserIds.includes(id)).length;
    setNonRsvpCount(count);
    setRemindDialogOpen(true);
  };

  // Long-press to reveal three-dots admin button
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);
  const [showAdminDots, setShowAdminDots] = useState(false);

  const handlePointerDown = useCallback(() => {
    if (!isAdmin) return;
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setShowAdminDots(true);
    }, 500);
  }, [isAdmin]);

  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleCardClick = useCallback(() => {
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return; // Suppress navigation after long-press
    }
    navigate(`/events/${event.id}`);
  }, [navigate, event.id]);

  return (
    <Card
      className={`group relative overflow-hidden transition-all cursor-pointer border-border/50 hover:border-primary/40 hover:shadow-md shadow-sm ${zebraBg} ${event.is_cancelled ? "opacity-50" : ""} select-none`}
      onClick={handleCardClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onContextMenu={(e) => { if (isAdmin) { e.preventDefault(); setShowAdminDots(true); } }}
    >
      {/* Team color rail — primary recognition cue. Today = full strength, future = dimmed. */}
      <span
        className="absolute left-0 top-0 bottom-0 w-1 pointer-events-none"
        style={{ backgroundColor: railHex, opacity: railOpacity }}
        aria-hidden="true"
      />
      {/* Right-edge tap affordance — optically aligned to the title row, not floating mid-card */}
      <ChevronRight
        className="absolute right-2.5 top-3.5 h-4 w-4 text-muted-foreground/35 pointer-events-none"
        aria-hidden="true"
      />
      <CardContent className="p-3.5 pb-3 pr-9 pl-4 space-y-1.5">
        {/* Status chips only — section header already conveys the date.
             Positioned with extra right padding so the chevron isn't crowded. */}
        {(() => {
          if (!event.is_cancelled && !isToday && !event.is_bye) return null;
          return (
            <div className="flex items-center justify-end gap-1.5 -mr-3">
              {event.is_bye && !event.is_cancelled && (
                <Badge
                  variant="outline"
                  className="text-[9.5px] h-[18px] px-1.5 font-bold uppercase tracking-wide bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40"
                >
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
          );
        })()}

        {/* HIERARCHY:
            1. TEAM (title-weight, with color dot) — primary scanning anchor
            2. EVENT CONTEXT (type icon + opponent / training label) — secondary
            3. LOGISTICS (time + location) — kept high-contrast, full-size
            Social/club-wide events flip 1↔2 since the title carries the meaning. */}
        {(() => {
          const TypeIcon = getEventTypeIcon(event.type, { miniLeagueId: event.mini_league_id });
          const isSocial = event.type === "social";
          const hasTeam = !!event.teams?.name;
          const isMatchDay = !!event.mini_league_id;

          if (isSocial) {
            return (
              <div className="space-y-1 min-w-0">
                <h3 className={`text-[15px] font-bold leading-snug text-foreground line-clamp-2 ${event.is_cancelled ? "line-through" : ""}`}>
                  {displayTitle}
                </h3>
                <div className="flex items-center gap-1.5 text-[12px] min-w-0">
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

          // Club-wide events (no team) should surface their actual title rather than the generic "Club event" label.
          const isClubWideTitled = !event.team_id && !!event.title?.trim();
          return (
            <div className="space-y-1.5">
              {/* Match Day eyebrow — only competitive events earn extra vertical space */}
              {isMatchDay && (
                <span className={`text-[10px] font-bold uppercase tracking-wider ${typeAccentClasses.text}`}>
                  Match Day
                </span>
              )}
              {/* PRIMARY: team identity as title — or actual event title for club-wide events with no team */}
              {isClubWideTitled ? (
                <h3 className={`text-[15px] font-bold leading-snug text-foreground line-clamp-2 ${event.is_cancelled ? "line-through" : ""}`}>
                  {displayTitle}
                </h3>
              ) : (
                <TeamChip
                  teamName={event.teams?.name}
                  fallbackLabel={event.team_id ? "" : "Club event"}
                  size="md"
                  asTitle
                />
              )}

              {/* SECONDARY: event context */}
              <div className={`min-w-0 ${event.is_cancelled ? "line-through" : ""}`}>
                <div className={`flex items-center gap-1.5 text-[13px] font-medium`}>
                  <TypeIcon className={`h-4 w-4 shrink-0 ${typeAccentClasses.text}`} aria-hidden="true" />
                  <span className={`min-w-0 truncate ${typeAccent === "default" ? "text-foreground/80" : typeAccentClasses.text}`}>
                    {eventDisplay.primary}
                  </span>
                </div>
                {eventDisplay.secondary && (
                  <p className="mt-0.5 text-[12px] leading-snug truncate pl-5 text-muted-foreground">
                    {eventDisplay.secondary}
                  </p>
                )}
                {isPastMatch && matchScore && (matchScore.home_score != null || matchScore.away_score != null) && (() => {
                  const hs = matchScore.home_score ?? 0;
                  const as = matchScore.away_score ?? 0;
                  const teamName = event.teams?.name?.trim();
                  const homeLabel = matchScore.home_label?.trim();
                  const isTeamHome = !!teamName && !!homeLabel && homeLabel.toLowerCase() === teamName.toLowerCase();
                  const ourScore = isTeamHome ? hs : as;
                  const theirScore = isTeamHome ? as : hs;
                  const result = ourScore > theirScore ? "W" : ourScore < theirScore ? "L" : "D";
                  const resultClass =
                    result === "W"
                      ? "bg-success/15 text-success border-success/30"
                      : result === "L"
                      ? "bg-destructive/15 text-destructive border-destructive/30"
                      : "bg-muted text-muted-foreground border-border";
                  return (
                    <div className="mt-1 pl-5 flex items-center gap-1.5">
                      <Badge variant="outline" className={`text-[10.5px] h-[18px] px-1.5 font-bold ${resultClass}`}>
                        {result}
                      </Badge>
                      <span className="text-[13px] font-bold tabular-nums text-foreground">
                        {ourScore} – {theirScore}
                      </span>
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })()}

        {/* TERTIARY (still highly visible): time + location.
            Location gets its OWN line so long pitch/court names are never
            truncated — that's operationally critical info for sport. */}
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



        {/* RSVP block — child-anchored when responses are still needed; falls back to summary line once everyone responded. */}
        {!event.is_cancelled && (() => {
          const rsvpDataPending = myRsvpLoading || childRsvpsLoading;
          if (rsvpDataPending) {
            return <div className="pt-2 mt-1 border-t border-border/40 h-[26px]" aria-hidden="true" />;
          }

          // Build the household rows we want a status for.
          type Row =
            | { kind: "child"; child_id: string; label: string; status: RsvpStatus | null }
            | { kind: "self"; label: string; status: RsvpStatus | null };

          const rows: Row[] = [];
          if (promptPlayer) {
            (householdChildren || []).forEach((c) => {
              rows.push({
                kind: "child",
                child_id: c.child_id,
                label: c.name?.split(" ")[0] || "Child",
                status: (c.rsvp?.status as RsvpStatus) ?? null,
              });
            });
          }
          if (promptParent) {
            rows.push({ kind: "self", label: "You", status: currentRsvpStatus });
          }

          const outstanding = rows.filter((r) => r.status === null);
          const needsRsvp = outstanding.length > 0;

          // Past events: never show RSVP buttons (cannot RSVP after the fact).
          const isPastEvent = new Date(event.event_date).getTime() < Date.now();

          // Outstanding rows → inline buttons per row (child-anchored).
          if (needsRsvp && isEventMember && !isPastEvent) {
            const handleSet = (row: Row, status: RsvpStatus) => {
              if (row.kind === "child") {
                childRsvpMutation.mutate({ childId: row.child_id, status });
              } else {
                selfRsvpMutation.mutate(status);
              }
            };
            const isPending = (row: Row) =>
              row.kind === "child"
                ? childRsvpMutation.isPending &&
                  (childRsvpMutation.variables as any)?.childId === row.child_id
                : selfRsvpMutation.isPending;

            return (
              <div
                className="pt-2 mt-1 border-t border-border/40 space-y-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                {rows.map((row) => {
                  if (row.status !== null) {
                    // Already responded — show compact status line.
                    const tone =
                      row.status === "going"
                        ? "text-success"
                        : row.status === "maybe"
                        ? "text-warning"
                        : "text-muted-foreground";
                    const Icon =
                      row.status === "going" ? CheckCircle2 : row.status === "maybe" ? HelpCircle : X;
                    return (
                      <div
                        key={row.kind === "child" ? `c-${row.child_id}` : "self"}
                        className="flex items-center gap-1.5 text-[12px] min-w-0"
                      >
                        <Icon className={`h-3.5 w-3.5 shrink-0 ${tone}`} />
                        <span className="font-medium text-foreground truncate">{row.label}</span>
                        <span className={`${tone} truncate`}>
                          ·{" "}
                          {row.status === "going"
                            ? "Going"
                            : row.status === "maybe"
                            ? "Maybe"
                            : "Not going"}
                        </span>
                      </div>
                    );
                  }
                  const pending = isPending(row);
                  return (
                    <div
                      key={row.kind === "child" ? `c-${row.child_id}` : "self"}
                      className="flex items-center gap-2 min-w-0"
                    >
                      <span className="inline-flex items-center gap-1 text-[12px] min-w-0 flex-1 truncate">
                        <AlertCircle className="h-3 w-3 text-amber-500 shrink-0" />
                        <span className="font-semibold text-foreground truncate">{row.label}</span>
                        <span className="text-muted-foreground">needs RSVP</span>
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => handleSet(row, "going")}
                          className="h-7 px-2 text-[11px] font-semibold border-success/40 text-success hover:bg-success/10"
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Going
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => handleSet(row, "maybe")}
                          className="h-7 px-2 text-[11px] font-semibold border-warning/40 text-warning hover:bg-warning/10"
                        >
                          Maybe
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => handleSet(row, "not_going")}
                          className="h-7 px-2 text-[11px] font-semibold border-border text-muted-foreground hover:bg-muted"
                        >
                          No
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          }

          // Everyone responded — fall back to the personal-first summary line.
          const goingChildNames = (householdChildren || [])
            .filter((c) => c.rsvp?.status === "going")
            .map((c) => c.name?.split(" ")[0] || "Child");

          const summary = buildPersonalRsvpLine({
            parentStatus: currentRsvpStatus,
            goingChildNames,
            totalGoing: attendanceCounts?.going || 0,
          });

          if (!summary) {
            return <div className="pt-2 mt-1 border-t border-border/40 h-[26px]" aria-hidden="true" />;
          }

          const personal = goingChildNames.length > 0 || currentRsvpStatus === "going";

          return (
            <div className="flex items-center pt-2 mt-1 border-t border-border/40 gap-1.5 min-w-0">
              {personal ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
              ) : (
                <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
              <span className={`text-[12px] truncate ${personal ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                {summary}
              </span>
            </div>
          );
        })()}

      </CardContent>

      {/* Admin three-dots revealed by long-press */}
      {isAdmin && showAdminDots && (
        <div className="absolute top-12 right-2 z-10" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu open={adminMenuOpen} onOpenChange={(open) => {
            setAdminMenuOpen(open);
            if (!open) setShowAdminDots(false);
          }}>
            <DropdownMenuTrigger asChild>
              <button className="p-1.5 rounded-full bg-background/80 backdrop-blur-sm border border-border/50 shadow-sm hover:bg-muted transition-colors">
                <MoreVertical className="h-4 w-4 text-foreground/70" />
              </button>
            </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {!event.is_cancelled && (
              <>
                <DropdownMenuItem onClick={() => navigate(`/events/${event.id}/edit`)}>
                  <Pencil className="h-3.5 w-3.5 mr-2" />
                  Edit
                </DropdownMenuItem>
                {canSendReminders && (
                  <DropdownMenuItem onClick={handleRemindClick}>
                    <Bell className="h-3.5 w-3.5 mr-2" />
                    Send Reminders
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setCancelDialogOpen(true)} className="text-warning focus:text-warning">
                  <XCircle className="h-3.5 w-3.5 mr-2" />
                  Cancel Event
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onClick={() => setDeleteDialogOpen(true)} className="text-destructive focus:text-destructive">
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {/* Dialogs */}
      <div onClick={(e) => e.stopPropagation()}>
        {isRecurring ? (
          <RecurringCancelEventDialog
            open={cancelDialogOpen}
            onOpenChange={setCancelDialogOpen}
            eventTitle={event.title}
            teamId={event.team_id}
            clubId={event.club_id}
            miniLeagueId={event.mini_league_id}
            eventType={event.type}
            onSingleAction={(customMessage, sendPushNotification) => cancelEventMutation.mutate({ cancelType: "single", customMessage, sendPushNotification })}
            onSeriesAction={(customMessage, sendPushNotification) => cancelEventMutation.mutate({ cancelType: "series", customMessage, sendPushNotification })}
            isPending={cancelEventMutation.isPending}
          />
        ) : (
          <CancelEventConfirmDialog
            open={cancelDialogOpen}
            onOpenChange={setCancelDialogOpen}
            eventId={event.id}
            eventTitle={event.title}
            teamId={event.team_id}
            clubId={event.club_id}
            miniLeagueId={event.mini_league_id}
            eventType={event.type}
            onConfirm={(customMessage, sendPushNotification) => cancelEventMutation.mutate({ cancelType: "single", customMessage, sendPushNotification })}
            isPending={cancelEventMutation.isPending}
          />
        )}

        {isRecurring ? (
          <RecurringEventActionDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            title={`Delete ${typeLabel}?`}
            description={`This will permanently delete the ${typeLabel.toLowerCase()}(s). This action cannot be undone.`}
            actionLabel="Delete"
            actionVariant="destructive"
            onSingleAction={() => handleConfirmDelete("single")}
            onSeriesAction={() => handleConfirmDelete("series")}
            isPending={deletePending}
            keepOpenOnAction
          />
        ) : (
          <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {typeLabel}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete this {typeLabel.toLowerCase()}. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={(e) => { e.preventDefault(); handleConfirmDelete("single"); }} disabled={deletePending} className="bg-destructive text-destructive-foreground">
                  {deletePending ? "Deleting…" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        <AlertDialog open={remindDialogOpen} onOpenChange={setRemindDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Send Reminders?</AlertDialogTitle>
              <AlertDialogDescription>
                {nonRsvpCount === 0
                  ? "Everyone has already RSVPed to this event!"
                  : `This will send a reminder notification to ${nonRsvpCount} member${nonRsvpCount === 1 ? "" : "s"} who haven't RSVPed yet.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              {nonRsvpCount !== 0 && (
                <AlertDialogAction onClick={() => remindMutation.mutate()} disabled={remindMutation.isPending}>
                  Send Reminders
                </AlertDialogAction>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Card>
  );
}
