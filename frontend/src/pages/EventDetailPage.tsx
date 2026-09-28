import { useState, useEffect, useMemo, useRef } from "react";
import { useDeleteEvent } from "@/hooks/useDeleteEvent";
import { useEventDutyMutations } from "@/hooks/useEventDutyMutations";
import { useCancelEventMutation } from "@/hooks/useCancelEventMutation";
import { useEventReminderMutations } from "@/hooks/useEventReminderMutations";
import { useEventPaymentFlow } from "@/hooks/useEventPaymentFlow";
import { useEventRsvpMutations } from "@/hooks/useEventRsvpMutations";
import { useLocalAttendanceMutation } from "@/hooks/useLocalAttendanceMutation";
import { useParentLeaguePlayerRsvpMutation } from "@/hooks/useParentLeaguePlayerRsvpMutation";
import { useEventAttendanceViewModel } from "@/hooks/useEventAttendanceViewModel";
import { resolveEventCapabilities } from "@/features/events/eventCapabilities";
import { fetchEventDetail } from "@/features/events/eventDetailRepository";

import { abortAllInFlightRestGets } from "@/lib/supabaseAuthRetry";
import { Share } from "@capacitor/share";
import { Capacitor } from "@capacitor/core";
import { getShareUrl } from "@/lib/shareUtils";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { exportEventIcs } from "@/lib/icsExport";
import { getEventTypeLabel } from "@/lib/eventTypeLabel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { eventKeys } from "@/lab/eventQueryKeys";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { useEventGroupMap } from "@/hooks/useEventGroupMap";
import { useEventViewTracking } from "@/hooks/useEventViews";
import { resolveRsvpAudience } from "@/lib/rsvpAudience";
import { resolveRsvpChildren, resolveEventChildRoster } from "@/lib/resolveEventChildScope";
import { useNotificationNudge } from "@/hooks/useNotificationNudge";
import { NotificationNudgeBanner } from "@/components/NotificationNudgeBanner";
import { RsvpNoteSheet } from "@/components/rsvp/RsvpNoteSheet";
import { PostRsvpNotificationPrompt } from "@/components/PostRsvpNotificationPrompt";
import { EventNoteSection } from "@/components/event/EventNoteSection";
import { EventOverviewSection } from "@/components/event/EventOverviewSection";
import { EventDutiesSection } from "@/components/event/EventDutiesSection";
import { EventMatchAwardsSection } from "@/components/event/EventMatchAwardsSection";
import { EventPitchBoardPortal } from "@/components/event/EventPitchBoardPortal";
import { EventDetailActionDialogs } from "@/components/event/EventDetailActionDialogs";
import { EventRsvpResponseSection } from "@/components/event/EventRsvpResponseSection";
import { EventAttendanceRosterSection } from "@/components/event/EventAttendanceRosterSection";
import { EventDetailHeader } from "@/components/event/EventDetailHeader";


import {
  shouldRestorePitchBoardForCurrentPath,
} from "@/components/pitch/pitchBoardOpenFlag";
import { hasGameBoardSupport } from "@/lib/sportDetection";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import * as fixtureData from "@/lab/fixtureDataLayer";
import { getLocalEvent, isLocalEventsCanisterUnavailable, listLocalEventRsvps } from "@/lab/localEventsService";
import { personas } from "@/lab/syntheticIdentities.mjs";
import {
  fetchTargetedAttendanceRoster,
  mergeTargetedChildren,
  selectScopedChildRoster,
  selectTargetedReminderMembers,
  type ScopedAttendanceRosterRow,
  type TargetedAttendanceProvider,
} from "@/lab/hybridTargetedAttendanceRepository";
import {
  fetchEventDuties,
  fetchEventGuests,
  type EventSupportingReadsProvider,
} from "@/lab/hybridEventSupportingReadsRepository";
import {
  fetchEventRsvps,
  type EventRsvpProvider,
} from "@/lab/hybridEventRsvpRepository";
import {
  buildEventMemberRoster,
  filterEventMemberRoles,
  scopeEventAttendanceMembers,
  type EventMemberRoleRow,
} from "@/features/events/eventMemberRoster";

type RsvpStatus = "going" | "maybe" | "not_going";
type DutyStatus = "open" | "completed";

const PRESET_DUTIES = ["Canteen/BBQ", "Linesperson", "Linemarker", "Referee"];

const rsvpOptions: { value: RsvpStatus; label: string; icon: string }[] = [
  { value: "going", label: "Going", icon: "✅" },
  { value: "maybe", label: "Maybe", icon: "🤔" },
  { value: "not_going", label: "Can't Go", icon: "❌" },
];

const normalizeDutyName = (name: string | null | undefined) => name?.trim().toLowerCase() ?? "";

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, profile, refreshProfile } = useAuth();
  const useIcpLab = resolveLocalAuthMode(typeof window !== 'undefined' ? window.location.search : '', true);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPersona = searchParams.get("persona");
  const localIcpPersona = requestedPersona && personas.includes(requestedPersona) ? requestedPersona : "member";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addDutyOpen, setAddDutyOpen] = useState(false);
  const [newDutyName, setNewDutyName] = useState("");
  const [selectedPresetDuty, setSelectedPresetDuty] = useState<string>("");
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedDutyId, setSelectedDutyId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [showAllRoles, setShowAllRoles] = useState(false);
  
  // Rich RSVP state
  const [rsvpNotes, setRsvpNotes] = useState("");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [reminderDialogOpen, setReminderDialogOpen] = useState(false);
  const [resendDialogOpen, setResendDialogOpen] = useState(false);
  const [showPitchBoard, setShowPitchBoard] = useState(false);
  
  // Mini league player overrides for match generation
  const [playerOverrides, setPlayerOverrides] = useState<Record<string, boolean>>({});
  const isSharingEventRef = useRef(false);
  const [showPostRsvpNudge, setShowPostRsvpNudge] = useState(false);
  const [recentlyReminded, setRecentlyReminded] = useState<Map<string, string>>(new Map());

  // 24-hour reminder cooldown — fetch event_reminder notifications sent in the last 24h
  // so the "Reminded {time ago}" state persists across sessions/devices and we can block re-reminding.
  const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
  const { data: recentReminderMap } = useQuery({
    queryKey: eventKeys.recentReminders(id),
    enabled: !!id && !useIcpLab,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - REMINDER_COOLDOWN_MS).toISOString();
      const { data, error } = await supabase
        .from("notifications")
        .select("user_id, created_at")
        .eq("type", "event_reminder")
        .eq("related_id", id!)
        .gte("created_at", since)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const map = new Map<string, string>();
      for (const n of (data || []) as { user_id: string; created_at: string }[]) {
        // first occurrence is latest due to DESC order
        if (!map.has(n.user_id)) map.set(n.user_id, n.created_at);
      }
      return map;
    },
  });
  const notificationNudge = useNotificationNudge(user?.id, "event");

  // Track when user views this event
  useEventViewTracking(id, useIcpLab ? undefined : user?.id);

  const { data: event, isLoading, error: eventError, isFetching: isEventFetching } = useQuery({
    queryKey: ["event", useIcpLab ? "icp" : "supabase", localIcpPersona, id],
    queryFn: async () => {
      if (useIcpLab && id) {
        try {
          return await getLocalEvent(localIcpPersona, id);
        } catch (error) {
          if (isLocalEventsCanisterUnavailable(error)) {
            return fixtureData.getLocalLabEventList().find((fixtureEvent) => fixtureEvent.id === id) ?? null;
          }
          throw error;
        }
      }

      return fetchEventDetail(supabase, id!);
    },
    enabled: !!id,
    retry: (failureCount, err: any) => {
      // Telemetry: log every retry so we can quantify how often the transient
      // failure path (resume-race / 5xx / token rotation) is hit in the wild.
      try {
        console.warn("[EventDetailPage] event fetch retry", {
          eventId: id,
          userId: user?.id,
          attempt: failureCount + 1,
          code: err?.code,
          status: err?.status,
          message: err?.message,
        });
      } catch {}
      return failureCount < 3;
    },
    retryDelay: (attempt) => Math.min(500 * attempt, 2000),
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });

  // Watchdog: after an Android WebView background freeze the event fetch can
  // stay permanently pending (its abort timer was frozen), leaving this page
  // stuck on skeletons until a force-quit. While we have no event and are
  // still loading, abort zombie REST GETs and re-issue every 6s.
  const isStuckOnEventSpinner = !event && isLoading;
  useEffect(() => {
    if (!isStuckOnEventSpinner || !id) return;
    const kick = () => {
      const aborted = abortAllInFlightRestGets("event-detail-watchdog");
      console.warn("[EventDetailPage] watchdog-refetch", {
        t: new Date().toISOString(),
        eventId: id,
        abortedInFlight: aborted,
      });
      queryClient.refetchQueries({ queryKey: eventKeys.detail(id) });
    };
    const timer = setInterval(kick, 6000);
    return () => clearInterval(timer);
  }, [isStuckOnEventSpinner, id, queryClient]);




  const {
    data: rsvps,
    error: rsvpsError,
    isLoading: rsvpsLoading,
    isFetching: rsvpsFetching,
    refetch: refetchRsvps,
  } = useQuery({
    queryKey: eventKeys.rsvps(id),
    queryFn: async () => {
      if (useIcpLab) {
        if (!id) throw new Error("Missing event ID");
        return listLocalEventRsvps(localIcpPersona, id);
      }

      const provider: EventRsvpProvider = {
        async listRsvps(eventId) {
          const { data, error } = await supabase
            .from("rsvps")
            .select(`*, mini_league_players (id, name, child_id)`)
            .eq("event_id", eventId);
          if (error) throw error;
          return data ?? [];
        },
        async listChildren(childIds) {
          const { data, error } = await supabase
            .from("children")
            .select("id, name")
            .in("id", childIds);
          if (error) throw error;
          return data ?? [];
        },
      };

      const result = await fetchEventRsvps(
        provider,
        id!,
        async (userIds) => {
          const { data } = await selectCachedProfilesByIds(userIds);
          return data ?? [];
        },
      );

      // Enrichment (profile/child display names) is best-effort by design —
      // a failed lookup must never make a valid attendance row disappear —
      // but it is surfaced here rather than silently swallowed.
      if (result.profilesEnrichment.status === "unavailable") {
        console.warn("[EventDetailPage] RSVP profile enrichment unavailable", result.profilesEnrichment.error);
      }
      if (result.childrenEnrichment.status === "unavailable") {
        console.warn("[EventDetailPage] RSVP children enrichment unavailable", result.childrenEnrichment.error);
      }

      return result.rows;
    },
    enabled: !!id,
  });

  // Attendance read health. A failed RSVP read must never be presented as a
  // valid empty roster: we surface an alert + retry and disable every
  // attendance-dependent action until a successful read lands. Cached data is
  // kept visible (and stable) during a background refetch.
  const attendanceUnavailable = !!rsvpsError && !rsvps;
  const attendanceInitialLoading = (rsvpsLoading || (rsvpsFetching && !rsvps)) && !rsvpsError;
  const attendanceActionsDisabled = attendanceUnavailable || attendanceInitialLoading;

  const attendanceAlert = (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
    >
      <span>Attendance couldn’t be loaded. Check your connection and try again.</span>
      <Button
        variant="outline"
        size="sm"
        className="h-7"
        onClick={() => { void refetchRsvps(); }}
      >
        Try again
      </Button>
    </div>
  );



  // Fetch event guests for attending count and RSVP list
  const { data: eventGuests } = useQuery({
    queryKey: ["event-guests", id],
    queryFn: async () => {
      if (useIcpLab) return [];

      const provider: EventSupportingReadsProvider = {
        async listEventGuests(eventId) {
          const { data, error } = await supabase
            .from("event_guests")
            .select("*")
            .eq("event_id", eventId);
          if (error) throw error;
          return data ?? [];
        },
        async listEventDuties() {
          return [];
        },
      };

      const result = await fetchEventGuests(provider, id!, async (adderIds) => {
        const { data } = await selectCachedProfilesByIds(adderIds);
        return data ?? [];
      });
      return result.rows;
    },
    enabled: !!id,
  });

  // Adult players on this team — used to count "players attending" for
  // match/training events so the attending number doesn't include parents who
  // RSVP'd for themselves alongside their child.
  const { data: teamPlayerAdultIds } = useQuery({
    queryKey: ["team-player-adult-ids", (event as any)?.team_id],
    queryFn: async () => {
      if (useIcpLab) return new Set<string>();

      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("team_id", (event as any).team_id)
        .eq("role", "player");
      if (error) throw error;
      return new Set((data || []).map((r: any) => r.user_id as string));
    },
    enabled: !!(event as any)?.team_id && !useIcpLab,
    staleTime: 60_000,
  });

  // For club-wide events (no team_id), identify adult players via any
  // role='player' assignment within the club so we can exclude parents
  // from the "players attending" count.
  const { data: clubPlayerAdultIds } = useQuery({
    queryKey: ["club-player-adult-ids", (event as any)?.club_id, (event as any)?.team_id],
    queryFn: async () => {
      if (useIcpLab) return new Set<string>();

      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", (event as any).club_id)
        .eq("role", "player");
      if (error) throw error;
      return new Set((data || []).map((r: any) => r.user_id as string));
    },
    enabled: !!(event as any)?.club_id && !(event as any)?.team_id && !useIcpLab,
    staleTime: 60_000,
  });


  // Populate form with existing RSVP data
  const localAccountId = user?.id ?? localIcpPersona;
  const myRsvp = rsvps?.find((r) => r.user_id === (useIcpLab ? localAccountId : user?.id) && !r.child_id);
  const { localAttendanceMutation } = useLocalAttendanceMutation({ id, localIcpPersona, localAccountId });
  
  useEffect(() => {
    if (myRsvp) {
      setRsvpNotes((myRsvp as any).notes || "");
    }
  }, [myRsvp?.id]);

  const { data: duties, isLoading: isDutiesLoading } = useQuery({
    queryKey: eventKeys.duties(id),
    queryFn: async () => {
      if (useIcpLab) return [];

      const provider: EventSupportingReadsProvider = {
        async listEventGuests() {
          return [];
        },
        async listEventDuties(eventId) {
          const { data, error } = await supabase
            .from("duties")
            .select(`*, profiles:assigned_to (display_name, avatar_url)`)
            .eq("event_id", eventId);
          if (error) throw error;
          return data ?? [];
        },
      };

      return fetchEventDuties(provider, id!);
    },
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // Check if user is app admin (global override)
  const { data: isAppAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user && !useIcpLab,
  });

  // Check if user is admin for this event
  const { data: isAdmin } = useQuery({
    queryKey: ["event-admin-check", id, user?.id, event?.club_id, event?.team_id, event?.mini_league_id],
    queryFn: async () => {
      if (!event) return false;
      
      // First check for club_admin role (always applies to club events)
      const { data: clubAdminData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("club_id", event.club_id)
        .in("role", ["club_admin", "committee_member"])
        .limit(1);
      
      if (clubAdminData && clubAdminData.length > 0) return true;
      
      // For team-specific events, also check team_admin/coach roles
      if (event.team_id) {
        const { data: teamRoleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user!.id)
          .eq("team_id", event.team_id)
          .in("role", ["team_admin", "coach"]);
        
        if (teamRoleData && teamRoleData.length > 0) return true;
      }
      
      // For mini-league events, also check league_admin/coach roles
      if (event.mini_league_id) {
        const { data: leagueAdminData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user!.id)
          .eq("club_id", event.club_id)
          .in("role", ["league_admin", "coach", "committee_member"]);
        
        if (leagueAdminData && leagueAdminData.length > 0) return true;
      }
      
      return false;
    },
    enabled: !!user && !!event && !useIcpLab,
  });

  // Check if team has Pro Football subscription (for pitch board) or club has Pro Football
  const { data: hasProFootball, isLoading: isLoadingTeamPro } = useQuery({
    queryKey: ["team-pro-football-status", event?.team_id, event?.club_id],
    queryFn: async () => {
      if (!event?.team_id) return false;
      
      // Check team-level Pro Football
      const { data: teamSub } = await supabase
        .from("team_subscriptions")
        .select("is_pro_football, admin_pro_football_override")
        .eq("team_id", event.team_id)
        .maybeSingle();
      
      if (teamSub?.is_pro_football || teamSub?.admin_pro_football_override) return true;
      
      // Check club-level Pro Football
      if (event?.club_id) {
        const { data: clubSub } = await supabase
          .from("club_subscriptions")
          .select("is_pro_football, admin_pro_football_override")
          .eq("club_id", event.club_id)
          .maybeSingle();
        
        if (clubSub?.is_pro_football || clubSub?.admin_pro_football_override) return true;
      }
      
      return false;
    },
    enabled: !!event?.team_id && !useIcpLab,
  });
  
  // Check if team/club has Pro subscription (for other features like RSVP reminders)
  const { data: hasTeamPro, isLoading: isLoadingHasTeamPro } = useQuery({
    queryKey: ["team-pro-status", event?.team_id, event?.club_id],
    queryFn: async () => {
      // First check team-level subscription
      if (event?.team_id) {
        const { data: teamSub } = await supabase
          .from("team_subscriptions")
          .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .eq("team_id", event.team_id)
          .maybeSingle();
        if (teamSub?.is_pro || teamSub?.is_pro_football || teamSub?.admin_pro_override || teamSub?.admin_pro_football_override) {
          return true;
        }
      }
      
      // Then check club-level subscription
      if (event?.club_id) {
        const { data: clubSub } = await supabase
          .from("club_subscriptions")
          .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .eq("club_id", event.club_id)
          .maybeSingle();
        if (clubSub?.is_pro || clubSub?.is_pro_football || clubSub?.admin_pro_override || clubSub?.admin_pro_football_override) {
          return true;
        }
      }
      
      return false;
    },
    enabled: (!!event?.team_id || !!event?.club_id) && !useIcpLab,
  });

  // Pro feature check: duty points only for Pro clubs/teams or app_admin
  const canAwardDutyPoints = isAppAdmin || hasTeamPro === true;
  
  // Pro feature check for RSVP reminders - check team OR club subscription
  const canSendReminders = !isLoadingHasTeamPro && hasTeamPro === true;

  // Event sharing is available on Free and Pro — no gate.
  const canShareEvent = true;
  const gateEventShare = (): boolean => true;

  const gateReminders = (): boolean => {
    if (isLoadingHasTeamPro) return false;
    if (hasTeamPro === true) return true;
    toast({
      title: "Reminders are a Pro feature",
      description: event?.club_id
        ? "Upgrade your club to Pro to send reminders."
        : "Contact your club admin to upgrade to Pro.",
      variant: "destructive",
    });
    if (event?.club_id) navigate(`/clubs/${event.club_id}/upgrade`);
    return false;
  };


  // Check if club is soccer/football for pitch board
  const isSoccerClub = hasGameBoardSupport(event?.clubs?.sport);

  const localSubsManagerForEvent = !!duties?.some(
    (d: any) => normalizeDutyName(d.name) === "subs manager" && d.assigned_to === user?.id
  );
  const { data: directSubsManagerForEvent = false, isLoading: isDirectSubsManagerLoading } = useQuery({
    queryKey: ["event-subs-manager-direct", id, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("duties")
        .select("id, name")
        .eq("event_id", id!)
        .eq("assigned_to", user!.id);
      if (error) throw error;
      return (data || []).some((d: any) => normalizeDutyName(d.name) === "subs manager");
    },
    enabled: !!id && !!user && !useIcpLab,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const isSubsManagerForEvent = localSubsManagerForEvent || directSubsManagerForEvent;
  // Centralizes the isAdmin/isAppAdmin/isSubsManagerForEvent boolean composition that
  // this page previously repeated inline in ~20 places (see eventCapabilities.ts).
  const { canManageEvent, canOperateMatch: canManagePitchBoard } = resolveEventCapabilities({
    isEventManager: isAdmin,
    isAppAdmin,
    isSubsManagerForEvent,
  });
  const isPitchBoardAccessLoading = isLoadingTeamPro || isDirectSubsManagerLoading || isDutiesLoading;

  // Check if user can access pitch board (coach/admin/Subs Manager) - requires Pro Football for soccer.
  // Netball + basketball game boards archived — football-only build.
  const canAccessSoccerBoard = canManagePitchBoard && event?.type === 'game' && !!event?.team_id && !!isSoccerClub && hasProFootball === true;
  const canAccessNetballBoard = false;
  const canAccessBasketballBoard = false;
  const canAccessPitchBoard = canAccessSoccerBoard;

  const wantOpenPitchBoard =
    searchParams.get("openPitchBoard") === "1" ||
    shouldRestorePitchBoardForCurrentPath(window.location.pathname);


  // Check if user is a team member (for read-only pitch board access)
  const { data: isTeamMember } = useQuery({
    queryKey: ["is-team-member", event?.team_id, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("team_id", event!.team_id!)
        .limit(1)
        .maybeSingle();
      return !!data;
    },
    enabled: !!user && !!event?.team_id && !canAccessPitchBoard && !useIcpLab,
  });

  // Check if a game is currently in progress (for read-only spectator mode)
  const { data: activeGameSummary } = useQuery({
    queryKey: ["active-game-summary", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("game_summaries")
        .select("id, is_active, pitch_state, timer_state")
        .eq("event_id", id!)
        .eq("is_active", true)
        .maybeSingle();
      return data;
    },
    enabled: !!id && !!isTeamMember && !canAccessPitchBoard && !useIcpLab && event?.type === 'game' && !!isSoccerClub && hasProFootball === true,
    refetchInterval: 30000, // Poll every 30s to detect game start
  });

  const canViewPitchBoardReadOnly = !!isTeamMember && !canAccessPitchBoard && !!activeGameSummary;

  // Keep proven access sticky while the board is open. Native resume aborts
  // and restarts active queries; transient false/undefined access results must
  // not unmount the restored board and reveal the event page underneath it.
  const rawPitchBoardAccess = canAccessSoccerBoard || canViewPitchBoardReadOnly;
  const pitchBoardAccessEverGrantedRef = useRef(false);
  if (rawPitchBoardAccess) pitchBoardAccessEverGrantedRef.current = true;
  const pitchBoardAccessGranted =
    rawPitchBoardAccess || (showPitchBoard && pitchBoardAccessEverGrantedRef.current);

  // Fetch team members for pitch board (adults + children)
  // STRICT: Only includes players whose RSVP status is "going" for this event.
  // Players with status "maybe", "not_going", or no response are excluded.
  // Adults (coaches/admins) are always included so they can run the board.
  const { data: teamMembers, isLoading: isTeamMembersForPitchLoading } = useQuery({
    queryKey: eventKeys.pitchTeamMembers(event?.team_id, event?.id),
    queryFn: async () => {
      const [rolesResult, childrenResult, goingRsvpsResult] = await Promise.all([
        supabase
          .from("user_roles")
          .select("user_id, role, profiles:user_id (id, display_name, avatar_url)")
          .eq("team_id", event!.team_id!),
        supabase.rpc("get_team_children_for_pitch_board", {
          p_team_id: event!.team_id!,
        }),
        supabase
          .from("rsvps")
          .select("user_id, child_id, status")
          .eq("event_id", event!.id)
          .eq("status", "going"),
      ]);

      if (rolesResult.error) throw rolesResult.error;
      if (goingRsvpsResult.error) throw goingRsvpsResult.error;

      const goingChildIds = new Set(
        (goingRsvpsResult.data || [])
          .map(r => r.child_id)
          .filter((id): id is string => !!id)
      );
      const goingAdultIds = new Set(
        (goingRsvpsResult.data || [])
          .map(r => r.user_id)
          .filter((id): id is string => !!id)
      );

      // Adults: include coaches/admins always (they may run the board even if
      // not personally RSVP'd as players); include other roles (e.g. "player")
      // only when they have a "going" RSVP.
      const STAFF_ROLES = new Set(["team_admin", "coach", "club_admin", "app_admin"]);
      const adultMembers = (rolesResult.data || [])
        .filter(m => STAFF_ROLES.has(m.role) || goingAdultIds.has(m.user_id))
        .map(m => ({
          user_id: m.user_id,
          role: m.role,
          profiles: m.profiles,
        }));

      // Children: only include those with a "going" RSVP.
      const childMembers = (childrenResult.data || [])
        .filter(child => goingChildIds.has(child.child_id))
        .map(child => ({
          user_id: child.child_id,
          role: "player" as string,
          profiles: {
            id: child.child_id,
            display_name: child.child_name,
            avatar_url: null,
          },
        }));

      return [...adultMembers, ...childMembers];
    },
    enabled: !!event?.team_id && !!event?.id && !!(canAccessPitchBoard || canViewPitchBoardReadOnly),
  });

  // Auto-open the pitch board when navigated here from the home Next Up
  // Start Game CTA (or any other deep-link with ?openPitchBoard=1). Waits
  // for access flags + teamMembers to resolve so we don't open a board the
  // user can't actually use.
  useEffect(() => {
    if (!wantOpenPitchBoard) return;
    if (!event || !teamMembers) return;
    if (!(canAccessPitchBoard || canViewPitchBoardReadOnly)) return;
    setShowPitchBoard(true);
    const next = new URLSearchParams(searchParams);
    next.delete("openPitchBoard");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantOpenPitchBoard, event?.id, canAccessPitchBoard, canViewPitchBoardReadOnly, !!teamMembers]);

  // Fetch team subscription for pitch board settings
  const { data: teamSubscription } = useQuery({
    queryKey: ["team-subscription-for-pitch", event?.team_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_subscriptions")
        .select("*")
        .eq("team_id", event!.team_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!event?.team_id && !!(canAccessPitchBoard || canViewPitchBoardReadOnly) && !useIcpLab,
  });

  // Fetch team/club members for duty assignment and not responded list (with roles)
  const { data: membersWithRoles } = useQuery({
    queryKey: ["event-members-with-roles", event?.club_id, event?.team_id],
    queryFn: async () => {
      const query = supabase
        .from("user_roles")
        .select("user_id, role, team_id, profiles:user_id (id, display_name, avatar_url)");

      if (event?.team_id) {
        query.eq("team_id", event.team_id);
      } else {
        query.eq("club_id", event!.club_id);
      }

      // The club bot holds roles so it can post in chats, but it is not a
      // real member — never surface it in attendance lists.
      const [{ data, error }, { data: clubRow }] = await Promise.all([
        query,
        supabase.from("clubs").select("bot_user_id").eq("id", event!.club_id).maybeSingle(),
      ]);
      if (error) throw error;
      const botUserId = clubRow?.bot_user_id ?? null;

      
      return buildEventMemberRoster(
        (data ?? []) as EventMemberRoleRow[],
        botUserId,
      );

    },
    enabled: !!event && !useIcpLab,
  });

  // Fetch mini-league players for mini-league events (for not responded list).
  // We enrich each player with `is_pending` = no parent has accepted the app yet
  // (no parent_user_id, linked child has no parent_id, and no guardians).
  const { data: miniLeaguePlayers } = useQuery({
    queryKey: ["mini-league-players-for-event", event?.mini_league_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_players")
        .select("id, name, parent_user_id, child_id")
        .eq("mini_league_id", event!.mini_league_id!);
      if (error) throw error;
      const players = data || [];

      const childIds = Array.from(
        new Set(players.map((p: any) => p.child_id).filter((id: string | null): id is string => !!id)),
      );

      let childParentMap = new Map<string, string | null>();
      let guardianCountMap = new Map<string, number>();
      if (childIds.length > 0) {
        const [childrenRes, guardiansRes] = await Promise.all([
          supabase.from("children").select("id, parent_id").in("id", childIds),
          supabase.from("child_guardians").select("child_id").in("child_id", childIds),
        ]);
        (childrenRes.data || []).forEach((c: any) => childParentMap.set(c.id, c.parent_id));
        (guardiansRes.data || []).forEach((g: any) => {
          guardianCountMap.set(g.child_id, (guardianCountMap.get(g.child_id) || 0) + 1);
        });
      }

      return players.map((p: any) => {
        const childParent = p.child_id ? childParentMap.get(p.child_id) : null;
        const guardianCount = p.child_id ? (guardianCountMap.get(p.child_id) || 0) : 0;
        const is_pending = !p.parent_user_id && !childParent && guardianCount === 0;
        return { ...p, is_pending };
      });
    },
    enabled: !!event?.mini_league_id,
  });

  // Fetch adult profiles linked to this mini-league (parents of league players).
  // Used by the Attendance "Show all roles" toggle on mini-league events.
  const { data: miniLeagueAdults } = useQuery({
    queryKey: ["mini-league-adults-for-event", event?.mini_league_id],
    queryFn: async () => {
      const parentIds = Array.from(
        new Set<string>(
          (miniLeaguePlayers || [])
            .flatMap((player: any) =>
              typeof player.parent_user_id === "string" ? [player.parent_user_id] : [],
            ),
        ),
      );
      if (parentIds.length === 0) return [] as Array<{ id: string; display_name: string | null; avatar_url: string | null; roles: string[] }>;
      const { data, error } = await selectCachedProfilesByIds(parentIds);
      if (error) throw error;
      return (data || []).map((p: any) => ({ ...p, roles: ["parent"] }));
    },
    enabled: !!event?.mini_league_id && !!miniLeaguePlayers,
  });


  // Mini-league players owned by current parent (for self-serve per-player RSVP)
  const { data: myMiniLeaguePlayers } = useQuery({
    queryKey: ["my-mini-league-players-for-event", event?.mini_league_id, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_players")
        .select("id, name, child_id")
        .eq("mini_league_id", event!.mini_league_id!)
        .eq("parent_user_id", user!.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!event?.mini_league_id && !!user?.id,
  });

  const { parentLeaguePlayerRsvpMutation } = useParentLeaguePlayerRsvpMutation({ supabase, id, user, rsvps });

  // For social events, always show all members; for training/games, use toggle
  const isSocialEvent = event?.type === "social";
  const effectiveShowAll = isSocialEvent ? true : showAllRoles;
  const isMiniLeagueEvent = !!event?.mini_league_id;
  const eventTypeLabel = isMiniLeagueEvent ? "Match Day" : getEventTypeLabel(event?.type);

  const restrictedEventRoles = Array.isArray((event as any)?.restricted_to_roles)
    ? ((event as any).restricted_to_roles as string[])
    : [];
  const hasRestrictedEventRoles = restrictedEventRoles.length > 0;
  const roleRestrictedMembers = filterEventMemberRoles(
    membersWithRoles ?? [],
    hasRestrictedEventRoles ? restrictedEventRoles : [],
  );

  // Filter members based on showAllRoles toggle / event role restrictions
  const members = hasRestrictedEventRoles ? roleRestrictedMembers : membersWithRoles;
  const playerMembers = members?.filter((member) => member.roles.includes("player")) || [];

  // For club-wide events with target_team_ids, narrow the attendance roster
  // to users tied to one of the targeted teams (via user_roles.team_id) OR
  // club-level admins/committee (who can access every targeted event). Other
  // consumers (duty roster, admin queries) keep using the full `members` list.
  const attendanceMembers = useMemo(
    () =>
      scopeEventAttendanceMembers(members ?? [], {
        eventTeamId: event?.team_id,
        targetTeamIds: ((event as any)?.target_team_ids ?? null) as string[] | null,
      }),
    [members, event?.team_id, (event as any)?.target_team_ids],
  );

  const attendancePlayerMembers = attendanceMembers.filter((member) =>
    member.roles.includes("player"),
  );


  // Fetch mini league duty assignees (RSVP'd parents + club admins + league admins, excluding players)
  const { data: miniLeagueDutyAssignees } = useQuery({
    queryKey: ["mini-league-duty-assignees-session", event?.mini_league_id, id],
    queryFn: async () => {
      const miniLeagueId = event!.mini_league_id!;
      
      // Get mini league to find the club_id
      const { data: league, error: leagueError } = await supabase
        .from("mini_leagues")
        .select("club_id")
        .eq("id", miniLeagueId)
        .single();
      if (leagueError) throw leagueError;
      
      // Get RSVPs for this event (only user RSVPs, not children/players)
      const { data: eventRsvps, error: rsvpError } = await supabase
        .from("rsvps")
        .select("user_id")
        .eq("event_id", id!)
        .eq("status", "going")
        .not("user_id", "is", null);
      if (rsvpError) throw rsvpError;
      
      const rsvpUserIds = new Set(eventRsvps?.map(r => r.user_id).filter(Boolean) as string[]);
      
      // Get all parent user IDs from mini league players who RSVP'd
      const { data: playersData, error: playersError } = await supabase
        .from("mini_league_players")
        .select("parent_user_id")
        .eq("mini_league_id", miniLeagueId)
        .not("parent_user_id", "is", null);
      if (playersError) throw playersError;
      
      // Only include parents who RSVP'd going
      const parentIds = [...new Set(
        (playersData?.map(p => p.parent_user_id).filter(Boolean) as string[])
          .filter(parentId => rsvpUserIds.has(parentId))
      )];
      
      // Get club admins and league admins who RSVP'd
      const { data: adminRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", league.club_id)
        .in("role", ["club_admin", "league_admin"]);
      if (rolesError) throw rolesError;
      
      // Only include admins who RSVP'd going
      const adminIds = (adminRoles?.map(r => r.user_id) || [])
        .filter(adminId => rsvpUserIds.has(adminId));
      
      // Combine all unique IDs
      const allUserIds = [...new Set([...parentIds, ...adminIds])];
      
      // Exclude app admins from the list
      const { data: appAdmins } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "app_admin");
      const appAdminIds = new Set(appAdmins?.map(r => r.user_id) || []);
      const filteredUserIds = allUserIds.filter(id => !appAdminIds.has(id));
      if (!filteredUserIds.length) return [];
      
      // Fetch profiles for all these users
      const { data: profiles, error: profilesError } = await selectCachedProfilesByIds(filteredUserIds);
      if (profilesError) throw profilesError;

      return (profiles || []).slice().sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));
    },
    enabled: !!event?.mini_league_id && !!id,
  });

  // Fetch children for parent RSVP — scoped via the shared resolver:
  // team event → that team; targeted club-wide → intersection with targets;
  // unscoped club-wide → children in teams of this club only.
  const childrenTargetKey = useMemo(() => {
    if (event?.team_id) return "";
    const t = ((event as any)?.target_team_ids ?? null) as string[] | null;
    return Array.isArray(t) && t.length > 0 ? [...t].sort().join(",") : "";
  }, [event?.team_id, (event as any)?.target_team_ids]);
  const { data: childrenOnTeam } = useQuery({
    queryKey: [
      "children-on-team",
      event?.team_id,
      event?.club_id,
      (event as any)?.adults_only,
      (event as any)?.rsvp_audience,
      childrenTargetKey,
      user?.id,
    ],
    queryFn: () => useIcpLab
      ? [{ id: "child-icp-001", name: "ICP Junior", parent_id: user?.id ?? null }]
      : resolveRsvpChildren({
          event: event as any,
          userId: user?.id ?? null,
          teamDefaultAudience: (event as any)?.teams?.default_rsvp_audience ?? null,
        }),
    enabled: !!user && !!(event?.team_id || event?.club_id),
  });



  // Fetch ALL children assigned to this event's team (for not responded list).
  // For club-wide events with `target_team_ids`, fetch children across every
  // targeted team so their child players still appear in No Response.
  const targetTeamIdsForFetch = useMemo(() => {
    if (event?.team_id) return null;
    const t = ((event as any)?.target_team_ids ?? null) as string[] | null;
    return Array.isArray(t) && t.length > 0 ? t : null;
  }, [event?.team_id, (event as any)?.target_team_ids]);

  // Event managers (club admin / committee / target-team admin) cannot read
  // other members' `children` rows directly under RLS. A narrowly scoped
  // SECURITY DEFINER RPC returns the minimum roster for THIS event only.
  const scopedRosterQuery = useQuery({
    queryKey: ["targeted-event-roster", id],
    enabled: !!id && !!targetTeamIdsForFetch && !!canManageEvent && !useIcpLab,
    staleTime: 60_000,
    queryFn: async () => {
      const provider: TargetedAttendanceProvider = {
        async listTargetedAttendanceRoster(eventId) {
          const { data, error } = await supabase.rpc("get_targeted_event_attendance_roster", {
            p_event_id: eventId,
          });
          if (error) throw error;
          return (data ?? []) as ScopedAttendanceRosterRow[];
        },
      };
      return fetchTargetedAttendanceRoster(provider, id!);
    },
  });
  const scopedChildRoster = useMemo(
    () => selectScopedChildRoster(scopedRosterQuery.data),
    [scopedRosterQuery.data],
  );
  const scopedChildNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of scopedChildRoster) if (r.display_name) m.set(r.person_id, r.display_name);
    return m;
  }, [scopedChildRoster]);

  // Grouping for club-wide events (by age level or by team). For targeted
  // club-wide events, use the scoped roster RPC for person→team mappings so
  // client-side RLS on children/user_roles cannot collapse everyone to Other.
  const eventGrouping = (event as any)?.rsvp_grouping as
    | "level"
    | "team"
    | null
    | undefined;
  const eventTargetTeamIds = ((event as any)?.target_team_ids ?? null) as
    | string[]
    | null;
  const groupMap = useEventGroupMap({
    clubId: event?.club_id ?? null,
    grouping: eventGrouping ?? null,
    targetTeamIds: eventTargetTeamIds,
    scopedRosterRows: targetTeamIdsForFetch ? scopedRosterQuery.data ?? null : null,
    enabled: !!event && !event.team_id && !!event.club_id &&
      (eventGrouping === "level" || eventGrouping === "team") &&
      (!targetTeamIdsForFetch || scopedRosterQuery.isSuccess),
  });

  const { data: allChildrenOnTeamRaw } = useQuery({
    queryKey: [
      "all-children-on-team",
      event?.team_id,
      event?.club_id,
      (event as any)?.adults_only,
      (event as any)?.rsvp_audience,
      targetTeamIdsForFetch ? [...targetTeamIdsForFetch].sort().join(",") : "",
    ],
    queryFn: () => useIcpLab
      ? [{ id: "child-icp-001", name: "ICP Junior", parent_id: user?.id ?? null }]
      : resolveEventChildRoster({
          event: event as any,
          teamDefaultAudience: (event as any)?.teams?.default_rsvp_audience ?? null,
        }),
    enabled: !!event && !!(event.team_id || event.club_id),
  });


  // Merge the RLS-visible children with the scoped RPC roster so event
  // managers see every targeted player (and never "Unknown").
  const allChildrenOnTeam = useMemo(() => {
    const base = allChildrenOnTeamRaw || [];
    if (!targetTeamIdsForFetch || scopedChildRoster.length === 0) return base;
    return mergeTargetedChildren(base, scopedChildRoster);
  }, [allChildrenOnTeamRaw, scopedChildRoster, targetTeamIdsForFetch]);



  // Fetch guardians for children on this team (so guardians are excluded from "not responded" when their child has RSVP'd).
  // Club-scoped: guardians linked to the child at another club are not part of this event's audience.
  const childIdsOnTeam = (allChildrenOnTeam || []).map((c: any) => c.id);
  const { data: childGuardiansOnTeam } = useQuery({
    queryKey: ["child-guardians-on-team", event?.team_id, event?.club_id, childIdsOnTeam.join(",")],
    queryFn: async () => {
      if (childIdsOnTeam.length === 0) return [];
      if (!event?.club_id) return [];
      const { data, error } = await supabase.rpc("club_scoped_child_guardians", {
        p_child_ids: childIdsOnTeam,
        p_club_id: event.club_id,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: childIdsOnTeam.length > 0 && !useIcpLab,
  });

  // Adults linked to an in-scope child are part of the event audience even
  // when they hold NO `user_roles` row that the members query can see:
  //  - team events query user_roles by team_id, so a parent whose only role
  //    row is club-level (team_id IS NULL) or sits on another team is missing;
  //  - parents added via child linking may hold no role row at all.
  // Without this fetch those parents can never appear in the roster — which is
  // exactly the "not all parents showed even with Show all roles" report.
  const linkedAdultIdsForAttendance = useMemo(() => {
    const ids = new Set<string>();
    (allChildrenOnTeam || []).forEach((c: any) => {
      if (c.parent_id) ids.add(c.parent_id);
    });
    (childGuardiansOnTeam || []).forEach((cg: any) => {
      if (cg.guardian_id) ids.add(cg.guardian_id);
    });
    (membersWithRoles || []).forEach((m: any) => ids.delete(m.id));
    return Array.from(ids).sort();
  }, [allChildrenOnTeam, childGuardiansOnTeam, membersWithRoles]);

  const { data: linkedAdultProfiles } = useQuery({
    queryKey: ["event-linked-adult-profiles", event?.id, linkedAdultIdsForAttendance.join(",")],
    queryFn: async () => {
      if (linkedAdultIdsForAttendance.length === 0) return [];
      const { data, error } = await selectCachedProfilesByIds(linkedAdultIdsForAttendance);
      if (error) throw error;
      return (data || []).map((p: any) => ({
        ...p,
        roles: ["parent"],
        team_ids: [],
        role_team_pairs: [],
      }));
    },
    enabled: !!event && linkedAdultIdsForAttendance.length > 0 && !useIcpLab,
  });




  // Recipients for on-demand reminders. For a targeted club-wide event the
  // audience is NOT "everyone in the club": only members holding a role on a
  // targeted team, plus parents/guardians of children assigned to those teams.
  // Club-level admins/committee who have no tie to a targeted team are not
  // nagged (they can still see the event). Team / mini-league / untargeted
  // club-wide events keep the previous behaviour.
  const reminderMembers = useMemo(() => {
    // Parents linked only via a child (no visible role row) still owe a
    // response, so they must be reachable by reminders too.
    const roleless = linkedAdultProfiles || [];
    if (event?.team_id || !targetTeamIdsForFetch) return [...(members ?? []), ...roleless];
    return selectTargetedReminderMembers(
      [...(members ?? []), ...roleless],
      targetTeamIdsForFetch,
      allChildrenOnTeam,
      childGuardiansOnTeam,
    );
  }, [members, event?.team_id, targetTeamIdsForFetch, allChildrenOnTeam, childGuardiansOnTeam, linkedAdultProfiles]);


  // Get existing RSVPs for children (any guardian's RSVP for the child counts)
  const myChildIds = new Set((childrenOnTeam || []).map((c: any) => c.id));
  const childRsvps = rsvps?.filter((r) => r.child_id && myChildIds.has(r.child_id)) || [];

  // Fetch event payments (admin only)
  const { data: payments } = useQuery({
    queryKey: eventKeys.payments(id),
    queryFn: async () => {
      if (useIcpLab) return [];

      const { data, error } = await supabase
        .from("event_payments")
        .select("user_id")
        .eq("event_id", id!);
      if (error) throw error;
      return data || [];
    },
    enabled: !!id && !!canManageEvent && !useIcpLab,
  });

  // Create set of paid user IDs for quick lookup
  const paidUserIds = new Set(payments?.map(p => p.user_id) || []);

  // Match awards: captain, POTM, goalkeepers — used to show inline icons next to attendees
  const isGameEvent = event?.type === "game" && !!event?.team_id;
  const { data: matchCaptainRow } = useQuery({
    queryKey: ["match-captain", id, "marker"],
    enabled: !!id && isGameEvent && !useIcpLab,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("match_captains")
        .select("user_id, child_id")
        .eq("event_id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: potmRow } = useQuery({
    queryKey: ["player-of-match", id, "marker"],
    enabled: !!id && isGameEvent && !useIcpLab,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_of_match")
        .select("user_id, child_id")
        .eq("event_id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: goalkeeperRows = [] } = useQuery({
    queryKey: ["match-goalkeepers", id],
    enabled: !!id && isGameEvent && !useIcpLab,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("match_goalkeepers" as any)
        .select("user_id, child_id")
        .eq("event_id", id!);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });
  const captainUserId = matchCaptainRow?.user_id || null;
  const captainChildId = matchCaptainRow?.child_id || null;
  const potmUserId = potmRow?.user_id || null;
  const potmChildId = potmRow?.child_id || null;
  const gkUserIds = new Set((goalkeeperRows as any[]).map((g) => g.user_id).filter(Boolean));
  const gkChildIds = new Set((goalkeeperRows as any[]).map((g) => g.child_id).filter(Boolean));

  // Check if event has a price (social events only)
  const eventPrice = event?.type === "social" ? event?.amount : null;
  const showPaymentStatus = eventPrice && eventPrice > 0;

  // Check if user has paid
  const userHasPaid = user ? paidUserIds.has(user.id) : false;

  const { handlePayNow, isProcessingPayment } = useEventPaymentFlow({
    supabase, id, event, user, eventPrice, useIcpLab,
  });


  // Optional RSVP note (Heja-style): the RSVP itself stays one tap; the note is
  // an optional follow-up written after answering.
  const [noteTarget, setNoteTarget] = useState<
    { kind: "self" | "child"; childId?: string; subjectName: string } | null
  >(null);

  const {
    rsvpMutation,
    childRsvpMutation,
    saveRsvpNoteMutation,
    adminRsvpMutation,
    adminUpdateRsvpMutation,
    rsvpForMemberMutation,
    rsvpForChildMutation,
    togglePaymentMutation,
  } = useEventRsvpMutations({
    supabase, useIcpLab, id, localIcpPersona, event, user, profile,
    myRsvp, childRsvps, rsvpNotes, notificationNudge, setShowPostRsvpNudge,
    showPaymentStatus, userHasPaid, isProcessingPayment, handlePayNow,
  });

  const {
    addDutyMutation,
    claimDutyMutation,
    completeDutyMutation,
    uncompleteDutyMutation,
    deleteDutyMutation,
    assignDutyMutation,
  } = useEventDutyMutations({
    supabase, useIcpLab, id, localIcpPersona, event, duties, user, profile, selectedDutyId,
    setNewDutyName, setSelectedPresetDuty, setAddDutyOpen,
    setAssignDialogOpen, setSelectedDutyId, setSelectedUserId,
  });

  // ---- Event deletion ----------------------------------------------------
  // One awaited request per confirmation. The dialog stays open and disabled
  // while pending; navigation and the success toast happen only after the
  // database confirms the row is gone (see useDeleteEvent).
  const { deleteEvent, isPending: deletePending } = useDeleteEvent({
    entityLabel: eventTypeLabel,
    onDeleted: () => {
      setDeleteDialogOpen(false);
      navigate(-1);
    },
  });

  const handleConfirmDelete = (deleteType: 'single' | 'series') => {
    void deleteEvent(
      event
        ? { id: id!, is_recurring: event.is_recurring, parent_event_id: event.parent_event_id }
        : null,
      deleteType,
    );
  };

  const handleShareEvent = async () => {
    if (isSharingEventRef.current || !gateEventShare()) return;
    isSharingEventRef.current = true;
    const shareUrl = getShareUrl("event", id!);
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({ url: shareUrl, dialogTitle: "Share Event" });
      } else if (navigator.share) {
        await navigator.share({ url: shareUrl });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        toast({ title: "Link copied to clipboard!" });
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        await navigator.clipboard.writeText(shareUrl);
        toast({ title: "Link copied to clipboard!" });
      }
    } finally {
      isSharingEventRef.current = false;
    }
  };



  const { cancelEventMutation } = useCancelEventMutation({
    supabase, id, event, user, setCancelDialogOpen,
  });

  const {
    remindMutation,
    individualRemindMutation,
    handleShareReminderLink,
    resendInvitesMutation,
  } = useEventReminderMutations({
    supabase, id, event, gateEventShare, setRecentlyReminded, setResendDialogOpen,
  });

  const attendanceViewModel = useEventAttendanceViewModel({
    event,
    rsvps,
    playerMembers,
    effectiveShowAll,
    isMiniLeagueEvent,
    targetTeamIdsForFetch,
    allChildrenOnTeam,
    attendanceMembers,
    attendancePlayerMembers,
    childGuardiansOnTeam,
    scopedChildNames,
    miniLeaguePlayers,
    miniLeagueAdults,
    members,
    linkedAdultProfiles,
    reminderMembers,
    eventGuests,
  });

  if (isLoading) {
    return (
      <div className="py-6 space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!event) {
    // A real RLS-deny / deleted-row resolves the query with `data === null`
    // and no error. A transient network/auth race resolves with an error
    // after react-query's retries are exhausted. Show different copy so we
    // don't tell a legitimate team member their event is "not available"
    // when the lookup actually just failed.
    const transientFailure = !!eventError && !isEventFetching;
    return (
      <div className="py-12 text-center space-y-4 px-6">
        <div className="text-5xl">{transientFailure ? "⚠️" : "📋"}</div>
        <h2 className="text-xl font-bold text-foreground">
          {transientFailure ? "Couldn't load this event" : "Event Not Available"}
        </h2>
        <p className="text-muted-foreground max-w-sm mx-auto">
          {transientFailure
            ? "Something went wrong fetching this event. Check your connection and try again."
            : "This event may have been removed, or it's for a specific team or group you're not part of. If you think this is a mistake, check with your club admin."}
        </p>
        <div className="flex gap-2 justify-center mt-4">
          {transientFailure && (
            <Button
              variant="default"
              onClick={() => queryClient.invalidateQueries({ queryKey: eventKeys.detail(id) })}
            >
              Try again
            </Button>
          )}
          <Button variant="outline" onClick={() => navigate('/')}>Go Home</Button>
        </div>
      </div>
    );
  }

  const attendanceContent = (() => {
    if (attendanceUnavailable) return attendanceAlert;
    if (!rsvps && attendanceInitialLoading) {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading attendance…
        </div>
      );
    }
    return (
      <EventAttendanceRosterSection
        event={event}
        eventId={id!}
        model={attendanceViewModel}
        groupMap={groupMap}
        scopedRosterQuery={scopedRosterQuery}
        showAllRoles={showAllRoles}
        setShowAllRoles={setShowAllRoles}
        isSocialEvent={isSocialEvent}
        isMiniLeagueEvent={isMiniLeagueEvent}
        isGameEvent={isGameEvent}
        canManageEvent={canManageEvent}
        canSendReminders={canSendReminders}
        gateReminders={gateReminders}
        eventGuests={eventGuests}
        paidUserIds={paidUserIds}
        showPaymentStatus={showPaymentStatus}
        membersWithRoles={membersWithRoles}
        captainUserId={captainUserId}
        captainChildId={captainChildId}
        potmUserId={potmUserId}
        potmChildId={potmChildId}
        gkUserIds={gkUserIds}
        gkChildIds={gkChildIds}
        recentlyReminded={recentlyReminded}
        recentReminderMap={recentReminderMap}
        miniLeagueAdults={miniLeagueAdults}
        allChildrenOnTeam={allChildrenOnTeam}
        individualRemindMutation={individualRemindMutation}
        adminRsvpMutation={adminRsvpMutation}
        rsvpForChildMutation={rsvpForChildMutation}
        rsvpForMemberMutation={rsvpForMemberMutation}
        togglePaymentMutation={togglePaymentMutation}
        adminUpdateRsvpMutation={adminUpdateRsvpMutation}
        handleShareReminderLink={handleShareReminderLink}
      />
    );
  })();

  return (
    <div className="py-6 space-y-6">
      <EventDetailHeader
        event={event}
        eventTypeLabel={eventTypeLabel}
        canManageEvent={canManageEvent}
        canSendReminders={canSendReminders}
        isLoadingHasTeamPro={isLoadingHasTeamPro}
        onBack={() => navigate("/events")}
        onShare={handleShareEvent}
        onEdit={() => navigate(`/events/${id}/edit`)}
        onSendReminders={() => setReminderDialogOpen(true)}
        onResendInvites={() => setResendDialogOpen(true)}
        onCancel={() => setCancelDialogOpen(true)}
        onDelete={() => setDeleteDialogOpen(true)}
      />
      <EventDetailActionDialogs
        event={event}
        eventTypeLabel={eventTypeLabel}
        attendanceActionsDisabled={attendanceActionsDisabled}
        reminderDialogOpen={reminderDialogOpen}
        setReminderDialogOpen={setReminderDialogOpen}
        resendDialogOpen={resendDialogOpen}
        setResendDialogOpen={setResendDialogOpen}
        cancelDialogOpen={cancelDialogOpen}
        setCancelDialogOpen={setCancelDialogOpen}
        deleteDialogOpen={deleteDialogOpen}
        setDeleteDialogOpen={setDeleteDialogOpen}
        handleShareReminderLink={handleShareReminderLink}
        remindMutation={remindMutation}
        resendInvitesMutation={resendInvitesMutation}
        cancelEventMutation={cancelEventMutation}
        handleConfirmDelete={handleConfirmDelete}
        deletePending={deletePending}
      />

      <EventOverviewSection
        event={event}
        eventId={id!}
        rsvps={rsvps}
        eventGuests={eventGuests}
        playerMembers={playerMembers}
        attendanceUnavailable={attendanceUnavailable}
        eventPrice={eventPrice}
        isPitchBoardAccessLoading={isPitchBoardAccessLoading}
        canAccessPitchBoard={canAccessPitchBoard}
        isTeamMembersForPitchLoading={isTeamMembersForPitchLoading}
        isSoccerClub={isSoccerClub}
        teamMembers={teamMembers}
        setShowPitchBoard={setShowPitchBoard}
        canViewPitchBoardReadOnly={canViewPitchBoardReadOnly}
        isTeamMember={isTeamMember}
        canManageEvent={canManageEvent}
        canManagePitchBoard={canManagePitchBoard}
        isMiniLeagueEvent={isMiniLeagueEvent}
        playerOverrides={playerOverrides}
        toast={toast}
      />
      {/* Event Note (coach/admin pinned info, notifies attendees) */}
      <EventNoteSection
        eventId={id!}
        note={(event as any).coach_note}
        noteUpdatedAt={(event as any).coach_note_updated_at}
        noteAuthor={(event as any).coach_note_author}
        canEdit={canManageEvent}
      />


      {/* Notification Nudge for events */}
      {notificationNudge.shouldShowNudge && !myRsvp && (
        <NotificationNudgeBanner
          message="Turn on notifications so you never miss match updates"
          onDismiss={notificationNudge.dismiss}
          userId={user?.id}
        />
      )}

      <EventRsvpResponseSection
        event={event}
        userId={user?.id}
        useIcpLab={useIcpLab}
        isMiniLeagueEvent={isMiniLeagueEvent}
        hasRestrictedEventRoles={hasRestrictedEventRoles}
        teamPlayerAdultIds={teamPlayerAdultIds}
        clubPlayerAdultIds={clubPlayerAdultIds}
        childrenOnTeam={childrenOnTeam}
        childRsvps={childRsvps}
        myRsvp={myRsvp}
        rsvps={rsvps}
        myMiniLeaguePlayers={myMiniLeaguePlayers}
        rsvpOptions={rsvpOptions}
        attendanceActionsDisabled={attendanceActionsDisabled}
        showPaymentStatus={showPaymentStatus}
        userHasPaid={userHasPaid}
        eventPrice={eventPrice}
        isProcessingPayment={isProcessingPayment}
        canManageEvent={canManageEvent}
        childRsvpMutation={childRsvpMutation}
        rsvpMutation={rsvpMutation}
        localAttendanceMutation={localAttendanceMutation}
        parentLeaguePlayerRsvpMutation={parentLeaguePlayerRsvpMutation}
        setNoteTarget={setNoteTarget}
        handlePayNow={handlePayNow}
      />

      {/* Mini League Matches - rendered earlier for mini league events (moved above Responses) */}
      {!isMiniLeagueEvent && event.mini_league_id && null}

      <Separator />

      {/* Unified Attendance section — replaces standalone Responses + Event Views */}
      {attendanceContent}


      <EventMatchAwardsSection
        event={event}
        eventId={id!}
        rsvps={rsvps || []}
        childrenOnTeam={allChildrenOnTeam || childrenOnTeam}
        canManageEvent={canManageEvent}
        canAwardDutyPoints={canAwardDutyPoints}
        showProUpgrade={
          isAdmin &&
          !isAppAdmin &&
          !isLoadingHasTeamPro &&
          hasTeamPro !== true
        }
        onUpgrade={() => navigate(`/clubs/${event.club_id}/upgrade`)}
      />

      <EventDutiesSection
        event={event}
        duties={duties}
        userId={user?.id}
        members={members}
        miniLeagueDutyAssignees={miniLeagueDutyAssignees}
        isMiniLeagueEvent={isMiniLeagueEvent}
        isAdmin={isAdmin}
        showProUpgrade={
          event.type === "game" &&
          !isMiniLeagueEvent &&
          isAdmin &&
          !isAppAdmin &&
          !isLoadingHasTeamPro &&
          hasTeamPro !== true
        }
        canAwardDutyPoints={canAwardDutyPoints}
        onUpgrade={() => navigate(`/clubs/${event.club_id}/upgrade`)}
        addDutyOpen={addDutyOpen}
        setAddDutyOpen={setAddDutyOpen}
        assignDialogOpen={assignDialogOpen}
        setAssignDialogOpen={setAssignDialogOpen}
        selectedDutyId={selectedDutyId}
        setSelectedDutyId={setSelectedDutyId}
        selectedUserId={selectedUserId}
        setSelectedUserId={setSelectedUserId}
        addDutyMutation={addDutyMutation}
        claimDutyMutation={claimDutyMutation}
        completeDutyMutation={completeDutyMutation}
        uncompleteDutyMutation={uncompleteDutyMutation}
        deleteDutyMutation={deleteDutyMutation}
        assignDutyMutation={assignDutyMutation}
      />

      <EventPitchBoardPortal
        open={showPitchBoard}
        event={event}
        eventId={id}
        teamMembers={teamMembers}
        teamSubscription={teamSubscription}
        isSoccerClub={isSoccerClub}
        accessGranted={pitchBoardAccessGranted}
        canViewReadOnly={canViewPitchBoardReadOnly}
        isSubsManager={isSubsManagerForEvent}
        setOpen={setShowPitchBoard}
      />

      {/* Netball + Basketball Game Board modals archived — football-only build */}

      {/* Post-RSVP Notification Prompt - only show if push is NOT enabled */}
      {user && event && notificationNudge.hasPushEnabled === false && (
        <PostRsvpNotificationPrompt
          open={showPostRsvpNudge}
          onClose={() => setShowPostRsvpNudge(false)}
          userId={user.id}
          eventTitle={event.title}
        />
      )}

      {noteTarget && (() => {
        const targetRsvp = noteTarget.kind === "child"
          ? childRsvps.find((r) => r.child_id === noteTarget.childId)
          : myRsvp;
        const statusLabel = targetRsvp?.status
          ? rsvpOptions.find((o) => o.value === targetRsvp.status)?.label ?? null
          : null;
        return (
          <RsvpNoteSheet
            open
            onOpenChange={(open) => { if (!open) setNoteTarget(null); }}
            subjectName={noteTarget.subjectName}
            statusLabel={statusLabel}
            initialNote={(targetRsvp as any)?.notes ?? null}
            onSave={async (note) => {
              await saveRsvpNoteMutation.mutateAsync({ childId: noteTarget.childId, note });
            }}
          />
        );
      })()}

    </div>
  );
}
