import { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, MapPin, Bell, Calendar, FileText, DollarSign, ClipboardList, Users, UserPlus } from "lucide-react";
import { getEventTypeLabel } from "@/lib/eventTypeLabel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible";
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
import { useToast } from "@/hooks/use-toast";
import { friendlyMutationError } from "@/lib/friendlyMutationError";
import { type ClubEventRole } from "@/components/event/EventRoleAudienceSelect";
import { MoreEventOptions } from "@/components/event/MoreEventOptions";
import type { RsvpAudience } from "@/lib/rsvpAudience";
import { useAuth } from "@/hooks/useAuth";
import { refreshEventCaches } from "@/lib/eventCacheRefresh";
import { supabase } from "@/integrations/supabase/client";
import { type SavedLocation } from "@/components/AddressAutocomplete";
import { MobileCardSelect } from "@/components/MobileCardSelect";
import { EventAudienceSelector } from "@/components/event/EventAudienceSelector";
import { OpponentInput } from "@/components/OpponentInput";
import { DutyMemberSelect } from "@/components/DutyMemberSelect";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { EventSponsorSelector } from "@/components/EventSponsorSelector";
import { DEFAULT_MATCH_ARRIVAL_MINUTES } from "@/lib/matchArrivalTime";
import { validateEventTeamClubScope } from "@/lib/eventScopeValidation";
import { SeriesEndDateEditor } from "@/components/event/SeriesEndDateEditor";
import { EventEditScheduleSection } from "@/components/event/EventEditScheduleSection";
import { eventKeys } from "@/lab/eventQueryKeys";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalEvent, setLocalEventRecurrence, updateLocalEvent } from "@/lab/localEventsService";
import { personas } from "@/lab/syntheticIdentities.mjs";
import {
  EventDutyFields,
  EventLocationFields,
  EventSectionHeader,
  type EventRecurrencePattern,
} from "@/components/event/EventFormShared";

type EventType = "game" | "training" | "social";

const EVENT_TYPES = [
  { value: "training", label: "Training", icon: "🏃" },
  { value: "game", label: "Game", icon: "⚽" },
  { value: "social", label: "Social", icon: "🎉" },
];

export default function EditEventPage() {
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return <IcpEditEventPage />;
  }

  return <SupabaseEditEventPage />;
}

function toLocalDateTimeInput(ms: bigint): string {
  const date = new Date(Number(ms));
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 16) : "";
}

function IcpEditEventPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const requestedPersona = searchParams.get("persona");
  const localIcpPersona = requestedPersona && personas.includes(requestedPersona) ? requestedPersona : "club_admin";
  const navigate = useNavigate();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [recurrenceFrequency, setRecurrenceFrequency] = useState("none");
  const [recurrenceUntil, setRecurrenceUntil] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: event, error, isLoading } = useQuery({
    queryKey: ["icp-event-edit", localIcpPersona, id],
    queryFn: async () => {
      if (!id) throw new Error("Missing event ID");
      return getLocalEvent(localIcpPersona, id);
    },
    retry: false,
  });

  useEffect(() => {
    if (!event) return;
    setTitle(event.title);
    setDescription(event.description);
    setStartsAt(toLocalDateTimeInput(event.starts_at_ms));
  }, [event]);

  const handleIcpUpdate = async () => {
    if (!id || !event) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast({ title: "Missing event title", description: "Enter a title before saving." });
      return;
    }
    const start = new Date(startsAt);
    if (!Number.isFinite(start.getTime())) {
      toast({ title: "Invalid start time", description: "Choose a valid event date and time." });
      return;
    }
    const previousDuration = Math.max(60 * 60 * 1000, Number(event.ends_at_ms - event.starts_at_ms));
    const end = new Date(start.getTime() + previousDuration);
    setSaving(true);
    try {
      const updated = await updateLocalEvent(
        localIcpPersona,
        id,
        trimmedTitle,
        description.trim() || trimmedTitle,
        BigInt(start.getTime()),
        BigInt(end.getTime()),
      );
      if (recurrenceFrequency !== "none") {
        const until = new Date(recurrenceUntil);
        if (!Number.isFinite(until.getTime()) || until.getTime() <= start.getTime()) {
          throw new Error("Choose a recurrence end date after the event start.");
        }
        await setLocalEventRecurrence(localIcpPersona, id, recurrenceFrequency, BigInt(until.getTime()));
      }
      toast({ title: "Event updated in local ICP", description: updated.title });
      navigate(`/events/${id}?backend=icp&persona=${encodeURIComponent(localIcpPersona)}`);
    } catch (updateError) {
      toast({
        title: "Could not update ICP event",
        description: `${updateError instanceof Error ? updateError.message : String(updateError)} No Supabase fallback was used.`,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container max-w-lg mx-auto px-4 py-10">
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="text-center space-y-2">
            <Calendar className="h-10 w-10 mx-auto text-muted-foreground" />
            <h1 className="text-lg font-semibold">Edit local ICP event</h1>
            <p className="text-sm text-muted-foreground">
              This updates event fields and the recurrence rule in the local events canister. Series materialization, duties, reminders, payments, and notifications remain disabled.
            </p>
          </div>
          {isLoading && <Skeleton className="h-32 w-full" />}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error.message} No Supabase fallback was used.
            </p>
          )}
          {event && (
            <>
              <div className="space-y-2">
                <Label htmlFor="icp-edit-event-title">Title</Label>
                <Input id="icp-edit-event-title" value={title} onChange={(inputEvent) => setTitle(inputEvent.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="icp-edit-event-start">Start</Label>
                <Input id="icp-edit-event-start" type="datetime-local" value={startsAt} onChange={(inputEvent) => setStartsAt(inputEvent.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="icp-edit-event-description">Description</Label>
                <Textarea id="icp-edit-event-description" value={description} onChange={(inputEvent) => setDescription(inputEvent.target.value)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="icp-edit-event-recurrence">Recurrence</Label>
                  <Select value={recurrenceFrequency} onValueChange={setRecurrenceFrequency}>
                    <SelectTrigger id="icp-edit-event-recurrence"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Does not repeat</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {recurrenceFrequency !== "none" && (
                  <div className="space-y-2">
                    <Label htmlFor="icp-edit-event-recurrence-until">Repeat until</Label>
                    <Input id="icp-edit-event-recurrence-until" type="date" value={recurrenceUntil} onChange={(inputEvent) => setRecurrenceUntil(inputEvent.target.value)} />
                  </div>
                )}
              </div>
            </>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => navigate(`/events?backend=icp&persona=${encodeURIComponent(localIcpPersona)}`)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Cancel
            </Button>
            <Button onClick={handleIcpUpdate} disabled={!event || saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save in ICP
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SupabaseEditEventPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const editSeries = searchParams.get('series') === 'true';
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [type, setType] = useState<EventType>("training");
  const [eventDateTime, setEventDateTime] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [showSeriesDialog, setShowSeriesDialog] = useState(false);

  // Team/Club selection
  const [selectedClubId, setSelectedClubId] = useState<string>("");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");

  // Reminder settings
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderHours, setReminderHours] = useState(24);

  // Price for social events
  const [price, setPrice] = useState("");
  const [paidEvent, setPaidEvent] = useState(false);

  // Guest settings for social events
  const [allowGuests, setAllowGuests] = useState(false);
  const [maxGuestsPerMember, setMaxGuestsPerMember] = useState(2);

  // Recurring event state (for converting single event to recurring)
  const [enableRecurring, setEnableRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState<EventRecurrencePattern>("weekly");
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");

  // Duties for game events
  const [duties, setDuties] = useState<{ id?: string; name: string; assignedTo: string | null }[]>([]);
  const [newDutyName, setNewDutyName] = useState("");
  const [dutiesToDelete, setDutiesToDelete] = useState<string[]>([]);

  // Opponent for game events
  const [opponent, setOpponent] = useState("");
  const [isBye, setIsBye] = useState(false);

  // Arrival time before kickoff (matches only). Empty = use team default.
  const [arrivalMinutesBefore, setArrivalMinutesBefore] = useState<string>("");
  const [teamDefaultArrival, setTeamDefaultArrival] = useState<number | null>(null);
  const [rsvpAudience, setRsvpAudience] = useState<RsvpAudience | null>(null);
  const [teamDefaultRsvpAudience, setTeamDefaultRsvpAudience] = useState<RsvpAudience | null>(null);
  const [restrictedRoles, setRestrictedRoles] = useState<ClubEventRole[]>([]);
  const [adultsOnly, setAdultsOnly] = useState(false);
  const [rsvpGrouping, setRsvpGrouping] = useState<"" | "level" | "team">("");
  const [targetTeamIds, setTargetTeamIds] = useState<string[] | null>(null);

  // Types that support a club-wide ("All Club") scope and therefore team targeting.
  const supportsClubWideScope = type === "game" || type === "social" || type === "training";

  // Clear stale target_team_ids whenever the event moves out of the
  // club-wide window. See CreateEventPage for rationale.
  useEffect(() => {
    if (
      targetTeamIds !== null &&
      (selectedTeamId || (type !== "game" && type !== "social" && type !== "training"))
    ) {
      setTargetTeamIds(null);
    }
  }, [selectedTeamId, type, targetTeamIds]);


  // Collapsible sections state
  const [openSections, setOpenSections] = useState({
    details: true,
    schedule: true,
    assignment: false,
    duties: false,
    location: false,
    options: false,
  });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const addDuty = () => {
    const trimmed = newDutyName.trim();
    if (trimmed && !duties.some(d => d.name === trimmed)) {
      setDuties(prev => [...prev, { name: trimmed, assignedTo: null }]);
      setNewDutyName("");
    }
  };

  const removeDuty = (dutyName: string, dutyId?: string) => {
    setDuties(prev => prev.filter(d => d.name !== dutyName));
    if (dutyId) {
      setDutiesToDelete(prev => [...prev, dutyId]);
    }
  };

  const assignDuty = (dutyName: string, userId: string | null) => {
    setDuties(prev => prev.map(d =>
      d.name === dutyName ? { ...d, assignedTo: userId } : d
    ));
  };

  const toggleRecurrenceDay = (day: number) => {
    setRecurrenceDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const generateRecurringDates = (startDate: Date, endDate: Date): Date[] => {
    const dates: Date[] = [new Date(startDate)];
    let currentDate = new Date(startDate);

    while (currentDate < endDate) {
      if (recurrencePattern === "daily") {
        currentDate = new Date(currentDate.setDate(currentDate.getDate() + recurrenceInterval));
      } else if (recurrencePattern === "weekly") {
        if (recurrenceDays.length > 0) {
          let found = false;
          for (let i = 1; i <= 7 * recurrenceInterval && !found; i++) {
            const nextDate = new Date(currentDate);
            nextDate.setDate(nextDate.getDate() + i);
            if (recurrenceDays.includes(nextDate.getDay())) {
              currentDate = nextDate;
              found = true;
            }
          }
          if (!found) break;
        } else {
          currentDate = new Date(currentDate.setDate(currentDate.getDate() + 7 * recurrenceInterval));
        }
      } else if (recurrencePattern === "biweekly") {
        currentDate = new Date(currentDate.setDate(currentDate.getDate() + 14 * recurrenceInterval));
      } else if (recurrencePattern === "monthly") {
        currentDate = new Date(currentDate.setMonth(currentDate.getMonth() + recurrenceInterval));
      }

      if (currentDate <= endDate) {
        dates.push(new Date(currentDate));
      }
    }

    return dates;
  };

  const { data: event, isLoading } = useQuery({
    queryKey: ["event-edit", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*, teams (name, default_match_arrival_minutes, default_rsvp_audience), clubs!club_id (name), mini_leagues (id, name)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Check if this is a recurring event
  const isRecurring = event?.is_recurring || event?.parent_event_id;

  // Check if user has permission to edit
  const { data: canEdit } = useQuery({
    queryKey: ["can-edit-event", id, user?.id, event?.club_id, event?.team_id],
    queryFn: async () => {
      if (!event) return false;

      // Check for app_admin
      const { data: appAdmin } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();

      if (appAdmin) return true;

      // Check for club_admin / committee_member role (always applies to club events)
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

      // For mini-league (Match Day) events, league admins can edit
      if ((event as any).mini_league_id) {
        // Check mini_league_admins table (per-league admins)
        const { data: leagueAdmin } = await supabase
          .from("mini_league_admins")
          .select("id")
          .eq("user_id", user!.id)
          .eq("mini_league_id", (event as any).mini_league_id)
          .maybeSingle();
        if (leagueAdmin) return true;

        // Check club-scoped league_admin role (matches events RLS)
        const { data: clubLeagueAdmin } = await supabase
          .from("user_roles")
          .select("id")
          .eq("user_id", user!.id)
          .eq("club_id", event.club_id)
          .eq("role", "league_admin")
          .maybeSingle();
        if (clubLeagueAdmin) return true;
      }

      return false;
    },
    enabled: !!user && !!event,
  });

  // Check if club has Pro subscription (for sponsor feature)
  const { data: clubSubscription } = useQuery({
    queryKey: ["club-subscription-edit", event?.club_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("club_subscriptions")
        .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .eq("club_id", event!.club_id)
        .maybeSingle();
      return data;
    },
    enabled: !!event?.club_id,
  });

  const isPro = clubSubscription?.is_pro ||
    clubSubscription?.is_pro_football ||
    clubSubscription?.admin_pro_override ||
    clubSubscription?.admin_pro_football_override;

  // Fetch existing duties for this event
  const { data: existingDuties } = useQuery({
    queryKey: eventKeys.duties(id),
    queryFn: async () => {
      const { data } = await supabase
        .from("duties")
        .select("id, name, assigned_to, status")
        .eq("event_id", id!);
      return data || [];
    },
    enabled: !!id,
  });

  // Fetch members for duty assignment
  const { data: members } = useQuery({
    queryKey: ["event-members-for-duty", event?.club_id, event?.team_id],
    queryFn: async () => {
      // Get members from team if selected, otherwise from club
      const targetId = event?.team_id || event?.club_id;
      const idColumn = event?.team_id ? "team_id" : "club_id";

      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, profiles!inner(id, display_name, avatar_url)")
        .eq(idColumn, targetId!);

      if (!roles) return [];

      // Deduplicate by user_id
      const seen = new Set<string>();
      return roles.filter(r => {
        if (seen.has(r.user_id)) return false;
        seen.add(r.user_id);
        return true;
      }).map(r => ({
        id: r.user_id,
        display_name: (r.profiles as any)?.display_name || "Unknown",
        avatar_url: (r.profiles as any)?.avatar_url,
      }));
    },
    enabled: !!event?.club_id,
  });

  // Fetch saved locations from previous events for the club
  const { data: savedLocations } = useQuery({
    queryKey: ["saved-locations", event?.club_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("events")
        .select("address, suburb, state, postcode")
        .eq("club_id", event!.club_id)
        .not("address", "is", null)
        .neq("address", "")
        .order("event_date", { ascending: false })
        .limit(50);

      if (!data) return [];

      // Deduplicate by address
      const seen = new Set<string>();
      const uniqueLocations: SavedLocation[] = [];

      for (const e of data) {
        const key = e.address?.toLowerCase().trim();
        if (key && !seen.has(key)) {
          seen.add(key);
          uniqueLocations.push({
            address: e.address!,
            suburb: e.suburb,
            state: e.state,
            postcode: e.postcode,
          });
        }
        if (uniqueLocations.length >= 10) break;
      }

      return uniqueLocations;
    },
    enabled: !!event?.club_id,
  });

  // Fetch user's clubs and teams for selection
  const { data: userClubs } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["user-clubs-for-edit", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("club_id, clubs!club_id(id, name)")
        .eq("user_id", user!.id)
        .not("club_id", "is", null)
        .in("role", ["club_admin", "team_admin", "coach", "committee_member"]);

      if (!data) return [];
      const clubs = data.filter(r => r.clubs).map(r => r.clubs as { id: string; name: string });
      return Array.from(new Map<string, { id: string; name: string }>(clubs.map(c => [c.id, c])).values());
    },
    enabled: !!user,
  });

  const { data: userTeams } = useQuery({
    queryKey: ["user-teams-for-edit", user?.id, selectedClubId],
    queryFn: async () => {
      const query = supabase
        .from("user_roles")
        .select("team_id, teams(id, name, club_id, default_match_arrival_minutes)")
        .eq("user_id", user!.id)
        .not("team_id", "is", null)
        .in("role", ["team_admin", "coach"]);

      const { data } = await query;

      if (!data) return [];
      let teams = data.filter(r => r.teams).map(r => r.teams as { id: string; name: string; club_id: string; default_match_arrival_minutes: number | null });

      // Filter by selected club if set
      if (selectedClubId) {
        teams = teams.filter(t => t.club_id === selectedClubId);
      }

      return Array.from(new Map(teams.map(t => [t.id, t])).values());
    },
    enabled: !!user,
  });

  // All teams in the selected club — used by the target-teams picker and, for
  // club-level admins, as the authoritative team list for this club.
  const { data: allClubTeams } = useQuery({
    queryKey: ["all-club-teams-for-edit-target", selectedClubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("teams")
        .select("id, name, club_id, default_match_arrival_minutes")
        .eq("club_id", selectedClubId)
        .is("deleted_at", null)
        .order("name");
      return data ?? [];
    },
    enabled: !!selectedClubId,
  });

  // Club admins / committee members / app admins can manage any team in the
  // club even without a per-team role, so their selectable team list must not
  // be limited to teams they personally hold team_admin/coach on.
  const { data: isClubLevelAdmin } = useQuery({
    queryKey: ["edit-event-club-level-admin", user?.id, selectedClubId],
    queryFn: async () => {
      const { data: appAdmin } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .limit(1);
      if (appAdmin && appAdmin.length > 0) return true;

      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("club_id", selectedClubId!)
        .in("role", ["club_admin", "committee_member", "league_admin"])
        .limit(1);
      return !!data && data.length > 0;
    },
    enabled: !!user && !!selectedClubId,
  });

  // Authoritative team list for the club/team scope guard + team picker.
  // Always includes the event's own team when it belongs to the selected club,
  // so editing an existing event never fails closed on a stale role list.
  const selectableTeams = useMemo(() => {
    const base = isClubLevelAdmin ? (allClubTeams ?? []) : (userTeams ?? []);
    const merged = new Map<string, { id: string; name: string; club_id: string; default_match_arrival_minutes: number | null }>();
    for (const t of base as any[]) {
      merged.set(t.id, {
        id: t.id,
        name: t.name,
        club_id: t.club_id,
        default_match_arrival_minutes: t.default_match_arrival_minutes ?? null,
      });
    }
    const evTeam = (event as any)?.teams;
    if (event?.team_id && event.club_id === selectedClubId && !merged.has(event.team_id)) {
      merged.set(event.team_id, {
        id: event.team_id,
        name: evTeam?.name ?? "Current team",
        club_id: event.club_id,
        default_match_arrival_minutes: evTeam?.default_match_arrival_minutes ?? null,
      });
    }
    return Array.from(merged.values());
  }, [isClubLevelAdmin, allClubTeams, userTeams, event, selectedClubId]);


  // Populate form with existing data
  useEffect(() => {
    if (event) {
      setTitle(event.title);
      setType(event.type as EventType);
      setDescription(event.description || "");
      setAddress(event.address || "");
      setReminderEnabled(event.reminder_hours_before !== null);
      setReminderHours(event.reminder_hours_before || 24);
      setPrice(event.amount ? String(event.amount) : "");
      setPaidEvent(Number(event.amount ?? 0) > 0);
      setSelectedClubId(event.club_id);
      setSelectedTeamId(event.team_id || "");
      setOpponent((event as any).opponent || "");
      setIsBye((event as any).is_bye === true);
      setArrivalMinutesBefore((event as any).arrival_minutes_before != null ? String((event as any).arrival_minutes_before) : "");
      setTeamDefaultArrival((event as any).teams?.default_match_arrival_minutes ?? DEFAULT_MATCH_ARRIVAL_MINUTES);
      const evAud = (event as any).rsvp_audience;
      setRsvpAudience(
        evAud === "players_only" || evAud === "players_and_parents" || evAud === "parents_only"
          ? evAud
          : null,
      );
      const teamAud = (event as any).teams?.default_rsvp_audience;
      setTeamDefaultRsvpAudience(
        teamAud === "players_only" || teamAud === "players_and_parents" || teamAud === "parents_only"
          ? teamAud
          : "players_only",
      );
      setAllowGuests(event.allow_guests === true);
      setMaxGuestsPerMember(event.max_guests_per_member || 2);
      const rr = (event as any).restricted_to_roles;
      setRestrictedRoles(Array.isArray(rr) ? (rr as ClubEventRole[]) : []);
      setAdultsOnly((event as any).adults_only === true);
      const grp = (event as any).rsvp_grouping;
      setRsvpGrouping(grp === "level" || grp === "team" ? grp : "");
      const tti = (event as any).target_team_ids;
      setTargetTeamIds(Array.isArray(tti) && tti.length > 0 ? (tti as string[]) : null);

      const parsedEventDateTime = parseISO(event.event_date);
      setEventDateTime(format(parsedEventDateTime, "yyyy-MM-dd'T'HH:mm"));
    }
  }, [event]);

  useEffect(() => {
    if (!selectedTeamId) {
      setTeamDefaultArrival(DEFAULT_MATCH_ARRIVAL_MINUTES);
      return;
    }
    const selectedTeam = selectableTeams.find((team) => team.id === selectedTeamId);
    setTeamDefaultArrival(selectedTeam?.default_match_arrival_minutes ?? DEFAULT_MATCH_ARRIVAL_MINUTES);
  }, [selectedTeamId, selectableTeams]);

  // Load existing duties
  useEffect(() => {
    if (existingDuties) {
      setDuties(existingDuties.map(d => ({
        id: d.id,
        name: d.name,
        assignedTo: d.assigned_to,
      })));
    }
  }, [existingDuties]);

  const handleSubmit = async (updateSeries: boolean = false) => {
    // Prevent double-submission while a save is in flight
    if (saving) return;
    if (!title.trim() || !eventDateTime) {
      toast({
        title: "Missing information",
        description: "Please fill in all required fields.",
      });
      return;
    }

    // Training, games and socials may be club-wide or targeted at a subset of
    // teams. A subset must contain 2+ teams (mirrors the backend trigger).
    const isMiniLeagueEvent = !!(event as any)?.mini_league_id;
    if (!selectedTeamId && targetTeamIds !== null && targetTeamIds.length < 2) {
      toast({
        title: "Select at least 2 teams",
        description:
          "Pick two or more teams, or leave it club-wide. For a single team, select it in the Team dropdown.",
        variant: "destructive",
      });
      return;
    }


    // Frontend club/team scope guard — matches backend
    // validate_event_team_club_scope trigger. Fail closed if the team list
    // is unavailable or stale so we never submit an ambiguous combination.
    {
      const check = validateEventTeamClubScope(selectedTeamId, selectableTeams, selectedClubId);
      if (check.ok === false) {
        // Distinguish "you can't manage this team" (team is in the club, but you
        // don't coach/admin it) from a genuine cross-club mismatch.
        const teamIsInClub = (allClubTeams ?? []).some((t) => t.id === selectedTeamId);
        if (check.reason === "list_unavailable") {
          toast({
            title: "Just a moment",
            description: "We're still loading this club's teams — please try again in a second.",
          });
        } else if (teamIsInClub) {
          toast({
            title: "You don't have access to this team",
            description:
              "Only this team's coaches and admins (or a club admin) can edit its events. Ask a club admin if you need this changed.",
          });
        } else {
          toast({
            title: "Pick a team from this club",
            description: "That team isn't part of the selected club — choose one of this club's teams.",
          });
        }
        return;
      }
    }


    // Validate recurring settings if converting to recurring
    if (enableRecurring && !isRecurring && !recurrenceEndDate) {
      toast({
        title: "Missing end date",
        description: "Please set an end date for recurring events.",
      });
      return;
    }

    // Validate arrival time when provided (game only). Empty = no arrival info.
    if (type === "game" && arrivalMinutesBefore.trim() !== "") {
      const n = Number(arrivalMinutesBefore);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 480) {
        toast({
          title: "Invalid arrival time",
          description: "Enter a whole number between 1 and 480 minutes, or leave blank.",
          variant: "destructive",
        });
        return;
      }
    }

    setSaving(true);

    const parsedDateTime = new Date(eventDateTime);

    // Keep start_time / end_time in sync with the new event_date.
    // Preserve duration when both original timestamps existed.
    const newStartIso = parsedDateTime.toISOString();
    let newEndIso: string | null = null;
    if (event?.start_time && event?.end_time) {
      const durMs = new Date(event.end_time).getTime() - new Date(event.start_time).getTime();
      if (Number.isFinite(durMs) && durMs > 0) {
        newEndIso = new Date(parsedDateTime.getTime() + durMs).toISOString();
      }
    } else if (event?.end_time) {
      newEndIso = event.end_time;
    }

    try {
      const parsedPrice = price ? parseFloat(price) : null;
      const updateData = {
        title: title.trim(),
        type,
        address: address.trim() || null,
        description: description.trim() || null,
        reminder_hours_before: reminderEnabled ? reminderHours : null,
        reminder_sent: reminderEnabled ? (event?.reminder_hours_before === reminderHours ? event?.reminder_sent : false) : false,
        amount: type === "social" ? parsedPrice : null,
        club_id: selectedClubId,
        team_id: selectedTeamId || null,
        opponent: type === "game" && !isBye ? opponent.trim() || null : null,
        arrival_minutes_before: type === "game" && !isBye && arrivalMinutesBefore.trim() !== "" ? parseInt(arrivalMinutesBefore, 10) : null,
        rsvp_audience: rsvpAudience,
        is_bye: type === "game" ? isBye : false,
        allow_guests: type === "social" && allowGuests ? true : null,
        max_guests_per_member: type === "social" && allowGuests ? maxGuestsPerMember : null,
        restricted_to_roles:
          type === "social" && !selectedTeamId && restrictedRoles.length > 0 ? restrictedRoles : null,
        adults_only: adultsOnly,
        rsvp_grouping:
          !selectedTeamId && supportsClubWideScope && rsvpGrouping
            ? rsvpGrouping
            : null,
        target_team_ids:
          !selectedTeamId && supportsClubWideScope && targetTeamIds && targetTeamIds.length >= 2
            ? targetTeamIds
            : null,

      } as any;

      // If converting single event to recurring series.
      // Parent update + every child insert run inside one transactional RPC so
      // a failed child insertion can never leave the parent marked recurring.
      if (enableRecurring && !isRecurring) {
        const endDate = new Date(recurrenceEndDate);
        const dates = generateRecurringDates(parsedDateTime, endDate);

        const childEvents = dates.slice(1).map((date) => {
          const childDateTime = new Date(date);
          childDateTime.setHours(parsedDateTime.getHours(), parsedDateTime.getMinutes());
          const childEnd = newEndIso
            ? new Date(childDateTime.getTime() + (new Date(newEndIso).getTime() - parsedDateTime.getTime())).toISOString()
            : null;
          return {
            event_date: childDateTime.toISOString(),
            start_time: childDateTime.toISOString(),
            end_time: childEnd,
          };
        });

        const { data: convertResult, error: convertError } = await supabase.rpc(
          "convert_event_to_recurring_series",
          {
            p_event_id: id!,
            p_parent_updates: updateData as any,
            p_child_events: childEvents as any,
            p_parent_event_date: parsedDateTime.toISOString(),
            p_parent_start_time: newStartIso,
            p_parent_end_time: newEndIso,
            p_recurrence_end_date: recurrenceEndDate,
          },
        );
        if (convertError) throw convertError;

        const occurrences =
          (convertResult as { occurrence_count?: number } | null)?.occurrence_count ?? dates.length;

        toast({
          title: "Recurring series created",
          description: `Created ${occurrences} event${occurrences > 1 ? 's' : ''} in the series.`,
        });
      } else if (updateSeries) {

        // Route the entire-series update through a transactional RPC so the
        // selected event, its parent, and all siblings either all succeed or
        // all roll back. The RPC verifies caller permission server-side and
        // preserves each sibling's own event_date / start_time / end_time.
        const { error: rpcError } = await supabase.rpc("update_event_series", {
          p_event_id: id!,
          p_updates: updateData as any,
          p_selected_event_date: parsedDateTime.toISOString(),
          p_selected_start_time: newStartIso,
          p_selected_end_time: newEndIso,
        });
        if (rpcError) throw rpcError;
      } else {
        // Just update this single event — keep start_time/end_time aligned with the new event_date
        const { error } = await supabase
          .from("events")
          .update({
            ...updateData,
            event_date: parsedDateTime.toISOString(),
            start_time: newStartIso,
            end_time: newEndIso,
          })
          .eq("id", id!);
        if (error) throw error;
      }

      // Duty changes for game events are applied by a single transactional RPC:
      // every removal, edit and addition either commits together or rolls back,
      // and the RPC raises when RLS would silently skip a row.
      if (type === "game") {
        const { data: syncedRaw, error: dutyError } = await supabase.rpc("sync_event_duties", {
          p_event_id: id!,
          p_delete_ids: dutiesToDelete,
          p_duties: duties.map((duty, idx) => ({
            idx,
            id: duty.id ?? null,
            name: duty.name,
            assigned_to: duty.assignedTo,
          })) as any,
        });
        if (dutyError) throw Object.assign(dutyError, { __dutyStage: "sync" });

        setDutiesToDelete([]);
        const synced = (syncedRaw as { idx: number; id: string }[] | null) ?? [];
        if (synced.length > 0) {
          setDuties((prev) =>
            prev.map((d, idx) => {
              const match = synced.find((s) => s.idx === idx);
              return match && !d.id ? { ...d, id: match.id } : d;
            }),
          );
        }
      }


      // Event update notifications are now handled automatically by the
      // on_event_updated DB trigger → process-event-notifications edge function

      // Refresh event-derived caches so the pitch board picks up the new
      // start_time / opponent / title without waiting for staleTime.
      queryClient.invalidateQueries({ queryKey: eventKeys.pitchLinked(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.pitchTeamMembers() });
      queryClient.invalidateQueries({ queryKey: eventKeys.pitchGoingRsvps(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.detail(id) });
      refreshEventCaches(queryClient, user?.id);

      navigate(`/events/${id}`);

    } catch (error: any) {
      console.error("Error updating event:", error);
      if (error?.__dutyStage) {
        toast({
          title: "Event saved, duties not saved",
          description:
            (/row-level security|permission|not permitted/i.test(error?.message ?? "")
              ? "You don't have permission to change the duties on this event. "
              : `Something went wrong saving the duties: ${error?.message ?? "unknown error"}. `) +
            "No duty changes were applied. Your event changes were saved — tap Save again to retry the duties.",
          variant: "destructive",
        });
        return;
      }
      toast(friendlyMutationError(error, { description: "Failed to update event. Please try again." }));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveClick = () => {
    // If recurring, show the series dialog
    if (isRecurring && !editSeries) {
      setShowSeriesDialog(true);
    } else if (editSeries) {
      // Came from series selection
      handleSubmit(true);
    } else {
      // Single event
      handleSubmit(false);
    }
  };


  if (isLoading) {
    return (
      <div className="pb-6 space-y-4">
        <div className="flex items-center gap-3 py-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-8 w-32" />
        </div>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!event) {
    return <div className="py-6 text-center text-muted-foreground">Event not found</div>;
  }

  if (canEdit === false) {
    return <div className="py-6 text-center text-muted-foreground">You don't have permission to edit this event</div>;
  }

  return (
    <div className="pb-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">Edit {event?.title || getEventTypeLabel(event?.type)}</h1>
          <p className="text-sm text-muted-foreground">
            {event.clubs?.name} {event.teams?.name && `• ${event.teams.name}`}
          </p>
        </div>
      </div>

      {/* Event Type Selection */}
      <div className="grid grid-cols-3 gap-2">
        {EVENT_TYPES.map((eventType) => (
          <button
            key={eventType.value}
            type="button"
            onClick={() => setType(eventType.value as EventType)}
            className={cn(
              "flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all",
              type === eventType.value
                ? "border-primary bg-primary/10"
                : "border-border hover:border-muted-foreground/50"
            )}
          >
            <span className="text-2xl">{eventType.icon}</span>
            <span className="text-sm font-medium">{eventType.label}</span>
          </button>
        ))}
      </div>

      {/* Details Section */}
      <Card>
        <Collapsible open={openSections.details}>
          <EventSectionHeader
            icon={FileText}
            title="Event Details"
            isOpen={openSections.details}
            onClick={() => toggleSection('details')}
            badge="Required"
          />
          <CollapsibleContent>
            <CardContent className="pt-0 pb-4 px-4 space-y-4">
              {/* Title */}
              <div className="space-y-2">
                <Label htmlFor="title">Event Title</Label>
                <Input
                  id="title"
                  placeholder="e.g., Saturday Training"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={100}
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="Add any additional details..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  maxLength={1000}
                />
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Club/Team Assignment Section */}
      <Card>
        <Collapsible open={openSections.assignment}>
          <EventSectionHeader
            icon={Users}
            title="Club & Team"
            isOpen={openSections.assignment}
            onClick={() => toggleSection('assignment')}
          />
          <CollapsibleContent>
            <CardContent className="pt-0 pb-4 px-4 space-y-4">
              {/* Club & Team Selection */}
              <div className="flex flex-col gap-3">
                <MobileCardSelect
                  value={selectedClubId}
                  onValueChange={(value) => {
                    setSelectedClubId(value);
                    if (value !== selectedClubId) {
                      setSelectedTeamId("");
                    }
                  }}
                  options={userClubs?.map((club) => ({ value: club.id, label: club.name })) || []}
                  placeholder="Select club"
                  label="Club"
                  required
                />

                {(event as any)?.mini_league_id ? (
                  <div className="rounded-lg border p-3 bg-muted/30">
                    <div className="text-xs text-muted-foreground mb-0.5">Mini-League</div>
                    <div className="text-sm font-medium">
                      {(event as any)?.mini_leagues?.name || "Mini-League event"}
                    </div>
                  </div>

                ) : (
                  <EventAudienceSelector
                    teams={selectableTeams}
                    clubTeams={allClubTeams ?? undefined}
                    teamId={selectedTeamId}
                    onTeamIdChange={setSelectedTeamId}
                    targetTeamIds={targetTeamIds}
                    onTargetTeamIdsChange={setTargetTeamIds}
                    supportsClubWideScope={supportsClubWideScope}
                  />
                )}
              </div>

              {/* BYE toggle - only for game events */}
              {type === "game" && (
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="is-bye">Mark as BYE</Label>
                    <p className="text-xs text-muted-foreground">No opposition this round — cards will display "BYE".</p>
                  </div>
                  <Switch id="is-bye" checked={isBye} onCheckedChange={setIsBye} />
                </div>
              )}

              {/* Opponent - only for game events (hidden when BYE) */}
              {type === "game" && !isBye && (
                <OpponentInput
                  value={opponent}
                  onChange={setOpponent}
                  clubId={selectedClubId}
                  teamId={selectedTeamId}
                />
              )}

              {/* Arrival time - only for game events */}
              {type === "game" && !isBye && (
                <div className="space-y-2">
                  <Label htmlFor="arrival">Arrive before kickoff</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="arrival"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={480}
                      placeholder={teamDefaultArrival != null ? `${teamDefaultArrival} (team default)` : "e.g. 30"}
                      value={arrivalMinutesBefore}
                      onChange={(e) => setArrivalMinutesBefore(e.target.value)}
                      className="w-32"
                    />
                    <span className="text-sm text-muted-foreground">minutes before</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {teamDefaultArrival != null
                      ? "Leave blank to use the team default."
                      : "Optional. Tell players how early to arrive."}
                  </p>
                </div>
              )}

              <MoreEventOptions
                showGrouping={!selectedTeamId && supportsClubWideScope && !(event as any)?.mini_league_id}
                rsvpGrouping={rsvpGrouping}
                onRsvpGroupingChange={setRsvpGrouping}
                adultsOnly={adultsOnly}
                onAdultsOnlyChange={setAdultsOnly}
                showRoleRestriction={type === "social" && !selectedTeamId}
                restrictedRoles={restrictedRoles}
                onRestrictedRolesChange={setRestrictedRoles}
                extraSummary={type === "social" && allowGuests ? ["Guests allowed"] : undefined}
              >
                {/* Guest settings - only for social events */}
                {type === "social" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <Label htmlFor="allow-guests-edit" className="flex items-center gap-2">
                          <UserPlus className="h-4 w-4" />
                          Allow Guests
                        </Label>
                        <span className="text-xs text-muted-foreground">
                          Members can add non-member guests
                        </span>
                      </div>
                      <Switch
                        id="allow-guests-edit"
                        checked={allowGuests}
                        onCheckedChange={setAllowGuests}
                      />
                    </div>
                    {allowGuests && (
                      <div className="space-y-2 pl-6">
                        <Label htmlFor="max-guests-edit">Max guests per member</Label>
                        <Input
                          id="max-guests-edit"
                          type="number"
                          min={1}
                          max={20}
                          value={maxGuestsPerMember}
                          onChange={(e) => setMaxGuestsPerMember(parseInt(e.target.value) || 1)}
                          className="w-24 h-12"
                        />
                      </div>
                    )}
                  </div>
                )}
              </MoreEventOptions>

            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>


      {/* Schedule Section */}
      <EventEditScheduleSection
        isOpen={openSections.schedule}
        onToggle={() => toggleSection("schedule")}
        eventDateTime={eventDateTime}
        onEventDateTimeChange={setEventDateTime}
        isRecurring={!!isRecurring}
        enableRecurring={enableRecurring}
        onEnableRecurringChange={setEnableRecurring}
        recurrencePattern={recurrencePattern}
        recurrenceDays={recurrenceDays}
        recurrenceInterval={recurrenceInterval}
        recurrenceEndDate={recurrenceEndDate}
        onRecurrencePatternChange={setRecurrencePattern}
        onToggleRecurrenceDay={toggleRecurrenceDay}
        onRecurrenceIntervalChange={setRecurrenceInterval}
        onRecurrenceEndDateChange={setRecurrenceEndDate}
        recurringSeriesContent={isRecurring && event ? (
          <SeriesEndDateEditor
            eventId={id!}
            parentEventId={event.parent_event_id ?? id!}
            canEdit={!!canEdit}
            onUpdated={() => {
              queryClient.invalidateQueries({ queryKey: ["event-edit", id] });
              refreshEventCaches(queryClient, user?.id);
            }}
          />
        ) : null}
      />

      {/* Duties Section - Only for game events */}
      {type === "game" && (
        <Card>
          <Collapsible open={openSections.duties}>
            <EventSectionHeader
              icon={ClipboardList}
              title="Duties"
              isOpen={openSections.duties}
              onClick={() => toggleSection("duties")}
              badge={duties.length > 0 ? `${duties.length}` : "Optional"}
            />
            <CollapsibleContent>
              <EventDutyFields
                duties={duties}
                members={members || []}
                newDutyName={newDutyName}
                onNewDutyNameChange={setNewDutyName}
                onAddDuty={addDuty}
                onRemoveDuty={(duty) => removeDuty(duty.name, duty.id)}
                onAssignDuty={(duty, userId) => assignDuty(duty.name, userId)}
                onQuickAddDuty={(suggestion) => {
                  if (!duties.some((duty) => duty.name === suggestion)) {
                    setDuties((prev) => [...prev, { name: suggestion, assignedTo: null }]);
                  }
                }}
              />
            </CollapsibleContent>
          </Collapsible>
        </Card>
      )}

      {/* Location Section */}
      <Card>
        <Collapsible open={openSections.location}>
          <EventSectionHeader
            icon={MapPin}
            title="Location"
            isOpen={openSections.location}
            onClick={() => toggleSection("location")}
            badge={address ? "Set" : undefined}
          />
          <CollapsibleContent>
            <CardContent className="pt-0 pb-4 px-4 space-y-4">
              <EventLocationFields
                value={address}
                savedLocations={savedLocations}
                onChange={setAddress}
                mapWrapperClassName="rounded-lg overflow-hidden"
              />
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Options Section */}
      <Card>
        <Collapsible open={openSections.options}>
          <EventSectionHeader
            icon={Bell}
            title="Options"
            isOpen={openSections.options}
            onClick={() => toggleSection('options')}
          />
          <CollapsibleContent>
            <CardContent className="pt-0 pb-4 px-4 space-y-4">
              {/* Paid event - only for social events */}
              {type === "social" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <Label htmlFor="paid-event-edit" className="flex items-center gap-2 text-sm font-medium">
                        <DollarSign className="h-4 w-4" /> Paid event
                      </Label>
                      <p className="text-xs text-muted-foreground">Charge attendees to come along.</p>
                    </div>
                    <Switch
                      id="paid-event-edit"
                      checked={paidEvent}
                      onCheckedChange={(next) => {
                        setPaidEvent(next);
                        if (!next) setPrice("");
                      }}
                    />
                  </div>
                  {paidEvent && (
                    <div className="space-y-2">
                      <Label htmlFor="price">Price per person (AUD)</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                        <Input
                          id="price"
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={price}
                          onChange={(e) => setPrice(e.target.value)}
                          className="pl-7 h-12"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}


              {/* Auto Reminder */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-muted-foreground" />
                    <Label htmlFor="reminder">Auto RSVP Reminder</Label>
                  </div>
                  <Switch
                    id="reminder"
                    checked={reminderEnabled}
                    onCheckedChange={setReminderEnabled}
                  />
                </div>

                {reminderEnabled && (
                  <div className="space-y-2">
                    <Label>Send reminder</Label>
                    <Select
                      value={reminderHours.toString()}
                      onValueChange={(v) => setReminderHours(parseInt(v))}
                    >
                      <SelectTrigger className="h-12">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="6">6 hours before</SelectItem>
                        <SelectItem value="12">12 hours before</SelectItem>
                        <SelectItem value="24">24 hours before</SelectItem>
                        <SelectItem value="48">2 days before</SelectItem>
                        <SelectItem value="72">3 days before</SelectItem>
                        <SelectItem value="168">1 week before</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Members who haven't RSVPed will be automatically reminded
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Event Sponsors - Pro only */}
      {isPro && event && (
        <EventSponsorSelector eventId={event.id} clubId={event.club_id} />
      )}

      {/* Save Button */}
      <Button
        className="w-full h-12 text-base"
        onClick={handleSaveClick}
        disabled={saving || !title.trim() || !eventDateTime}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
      </Button>

      {/* Series Edit Dialog */}
      <AlertDialog open={showSeriesDialog} onOpenChange={setShowSeriesDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply changes to…</AlertDialogTitle>
            <AlertDialogDescription>
              This event is part of a recurring series. Apply your edits (title, time, location, duties, etc.) to just this occurrence or every event in the series?
              <br /><br />
              <span className="text-xs text-muted-foreground">Note: series end-date changes are saved separately from the "Recurring" section and are not affected by this choice.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                setShowSeriesDialog(false);
                handleSubmit(false);
              }}
              disabled={saving}
            >
              This Event Only
            </Button>
            <AlertDialogAction
              onClick={() => {
                setShowSeriesDialog(false);
                handleSubmit(true);
              }}
              disabled={saving}
            >
              Entire Series
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
