import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, MapPin, Bell, Calendar, FileText, DollarSign, ClipboardList, X, Star, Trash2, UserPlus } from "lucide-react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useClubTheme } from "@/hooks/useClubTheme";
import { cn } from "@/lib/utils";
import { DEFAULT_MATCH_ARRIVAL_MINUTES } from "@/lib/matchArrivalTime";
import { validateEventTeamClubScope } from "@/lib/eventScopeValidation";
import {
  evaluateTrainingConflicts,
  CONFLICT_CHECK_ERROR_TITLE,
  CONFLICT_CHECK_ERROR_DESCRIPTION,
  type ConflictCheckResult,
} from "@/features/events/trainingConflictPolicy";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { createLocalEvent, setLocalEventRecurrence } from "@/lab/localEventsService";
import { eventKeys } from "@/lab/eventQueryKeys";
import { personas } from "@/lab/syntheticIdentities.mjs";
import {
  EventDutyFields,
  EventLocationFields,
  EventSectionHeader,
  type EventRecurrencePattern,
} from "@/components/event/EventFormShared";
import { EventScheduleSection } from "@/components/event/EventScheduleSection";

type EventType = "game" | "training" | "social" | "mini_league";

const EVENT_TYPES = [
  { value: "training", label: "Training", icon: "🏃" },
  { value: "game", label: "Game", icon: "⚽" },
  { value: "social", label: "Social", icon: "🎉" },
  // Mini League tab removed — matches are created from the mini league profile.
  // The mini_league type still works when pre-filled via query params (isFromMiniLeague).
];

export default function CreateEventPage() {
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return <IcpCreateEventPage />;
  }

  return <SupabaseCreateEventPage />;
}

function IcpCreateEventPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const requestedPersona = searchParams.get("persona");
  const localIcpPersona = requestedPersona && personas.includes(requestedPersona) ? requestedPersona : "club_admin";
  const [title, setTitle] = useState(searchParams.get("prefill_title") ?? "");
  const [description, setDescription] = useState("");
  const [clubId, setClubId] = useState(searchParams.get("club_id") ?? "club-icp-001");
  const [teamId, setTeamId] = useState(searchParams.get("team_id") ?? "team-icp-001");
  const [startsAt, setStartsAt] = useState(() => {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() + 1);
    return now.toISOString().slice(0, 16);
  });
  const [saving, setSaving] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState("none");
  const [recurrenceUntil, setRecurrenceUntil] = useState("");

  const handleIcpSubmit = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || !clubId.trim()) {
      toast({ title: "Missing event details", description: "Enter a title and club ID." });
      return;
    }
    const start = new Date(startsAt);
    if (!Number.isFinite(start.getTime())) {
      toast({ title: "Invalid start time", description: "Choose a valid event date and time." });
      return;
    }
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    setSaving(true);
    try {
      const event = await createLocalEvent(
        localIcpPersona,
        clubId.trim(),
        teamId.trim() || null,
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
        await setLocalEventRecurrence(localIcpPersona, event.id, recurrenceFrequency, BigInt(until.getTime()));
      }
      toast({ title: "Event created in local ICP", description: event.title });
      navigate(`/events/${event.id}?backend=icp&persona=${encodeURIComponent(localIcpPersona)}`);
    } catch (error) {
      toast({
        title: "Could not create ICP event",
        description: `${error instanceof Error ? error.message : String(error)} No Supabase fallback was used.`,
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
            <h1 className="text-lg font-semibold">Create local ICP event</h1>
            <p className="text-sm text-muted-foreground">
              This writes an event to the local events canister. Recurrence is supported; duties, reminders, payments, and notifications remain disabled.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="icp-event-title">Title</Label>
            <Input id="icp-event-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="icp-event-club">Club ID</Label>
            <Input id="icp-event-club" value={clubId} onChange={(event) => setClubId(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="icp-event-team">Team ID (optional)</Label>
            <Input id="icp-event-team" value={teamId} onChange={(event) => setTeamId(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="icp-event-start">Start</Label>
            <Input id="icp-event-start" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="icp-event-description">Description</Label>
            <Textarea id="icp-event-description" value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="icp-event-recurrence">Recurrence</Label>
              <Select value={recurrenceFrequency} onValueChange={setRecurrenceFrequency}>
                <SelectTrigger id="icp-event-recurrence"><SelectValue /></SelectTrigger>
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
                <Label htmlFor="icp-event-recurrence-until">Repeat until</Label>
                <Input id="icp-event-recurrence-until" type="date" value={recurrenceUntil} onChange={(event) => setRecurrenceUntil(event.target.value)} />
              </div>
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => navigate("/events?backend=icp")}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Cancel
            </Button>
            <Button onClick={handleIcpSubmit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create in ICP
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SupabaseCreateEventPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { activeClubFilter } = useClubTheme();

  // Read query params for pre-filling from mini league
  const presetType = searchParams.get("type") as EventType | null;
  const presetClubId = searchParams.get("club_id");
  const presetMiniLeagueId = searchParams.get("mini_league_id");
  const prefillTitle = searchParams.get("prefill_title");
  const prefillDate = searchParams.get("prefill_date");
  const isFromMiniLeague = presetType === "mini_league" && !!presetMiniLeagueId;

  const [title, setTitle] = useState(prefillTitle || "");
  const [type, setType] = useState<EventType>(presetType || (localStorage.getItem("lastEventType") as EventType) || "training");
  const [clubId, setClubId] = useState(presetClubId || "");
  const [teamId, setTeamId] = useState("");
  const [miniLeagueId, setMiniLeagueId] = useState(presetMiniLeagueId || "");
  const [eventDateTime, setEventDateTime] = useState(() => {
    if (prefillDate) return prefillDate;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}T09:00`;
  });
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  // Event + duties are written atomically by create_event_with_duties, so no
  // partial-write retry state is needed.

  // End time / duration state
  const [endTime, setEndTime] = useState("");
  const [duration, setDuration] = useState("");
  const [endTimeMode, setEndTimeMode] = useState<"end_time" | "duration">("duration");

  // Recurring event state
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState<EventRecurrencePattern>("weekly");
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");

  // Reminder settings
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderHours, setReminderHours] = useState(24);

  // Price for social events
  const [price, setPrice] = useState("");
  const [paidEvent, setPaidEvent] = useState(false);

  // Guest settings for social events
  const [allowGuests, setAllowGuests] = useState(false);
  const [maxGuestsPerMember, setMaxGuestsPerMember] = useState(2);

  // Duties for game events
  const [duties, setDuties] = useState<{ name: string; assignedTo: string | null }[]>([]);
  const [newDutyName, setNewDutyName] = useState("");

  // Opponent for game events
  const [opponent, setOpponent] = useState("");
  const [arrivalMinutesBefore, setArrivalMinutesBefore] = useState<string>("");
  const [isBye, setIsBye] = useState(false);
  const [rsvpAudience, setRsvpAudience] = useState<RsvpAudience | null>(null);
  const [restrictedRoles, setRestrictedRoles] = useState<ClubEventRole[]>([]);
  const [adultsOnly, setAdultsOnly] = useState(false);
  const [rsvpGrouping, setRsvpGrouping] = useState<"" | "level" | "team">("");
  // Subset targeting for club-wide games/socials/trainings: null = all club, [...] = only those teams
  const [targetTeamIds, setTargetTeamIds] = useState<string[] | null>(null);

  // Types that support a club-wide ("All Club") scope and therefore team targeting.
  const supportsClubWideScope = type === "game" || type === "social" || type === "training";

  // Clear stale target_team_ids whenever the event moves out of the
  // club-wide window (team picked, unsupported type, club changed).
  useEffect(() => {
    if (
      targetTeamIds !== null &&
      (teamId || (type !== "game" && type !== "social" && type !== "training"))
    ) {
      setTargetTeamIds(null);
    }
  }, [teamId, type, clubId, targetTeamIds]);


  // Auto-calculate end time from duration or vice versa
  const getStartTimeStr = () => {
    if (!eventDateTime) return "";
    const d = new Date(eventDateTime);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // Convert a bare HH:mm time string to a full ISO timestamp using the event date
  const timeToTimestamp = (timeStr: string | null | undefined, baseDate: Date): string | null => {
    if (!timeStr) return null;
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return null;
    const d = new Date(baseDate);
    d.setHours(hours, minutes, 0, 0);
    return d.toISOString();
  };

  const handleDurationChange = (val: string) => {
    setDuration(val);
    if (val && eventDateTime) {
      const mins = parseInt(val);
      if (!isNaN(mins) && mins > 0) {
        const start = new Date(eventDateTime);
        const end = new Date(start.getTime() + mins * 60000);
        setEndTime(`${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`);
      }
    } else {
      setEndTime("");
    }
  };

  const handleEndTimeChange = (val: string) => {
    setEndTime(val);
    if (val && eventDateTime) {
      const start = new Date(eventDateTime);
      const [h, m] = val.split(":").map(Number);
      const endMins = h * 60 + m;
      const startMins = start.getHours() * 60 + start.getMinutes();
      let diff = endMins - startMins;
      if (diff <= 0) diff += 24 * 60; // next day
      setDuration(String(diff));
    } else {
      setDuration("");
    }
  };

  // Recalculate end time when start time changes (if duration is set)
  useEffect(() => {
    if (endTimeMode === "duration" && duration && eventDateTime) {
      const mins = parseInt(duration);
      if (!isNaN(mins) && mins > 0) {
        const start = new Date(eventDateTime);
        const end = new Date(start.getTime() + mins * 60000);
        setEndTime(`${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`);
      }
    }
  }, [eventDateTime]);


  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [conflictingEvents, setConflictingEvents] = useState<{ title: string; team_name?: string; start_time?: string }[]>([]);

  // Collapsible sections state - all expanded by default
  const [openSections, setOpenSections] = useState({
    details: true,
    schedule: true,
    duties: true,
    location: true,
    options: true,
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

  const removeDuty = (dutyToRemove: string) => {
    setDuties(prev => prev.filter(d => d.name !== dutyToRemove));
  };

  const assignDuty = (dutyName: string, userId: string | null) => {
    setDuties(prev => prev.map(d =>
      d.name === dutyName ? { ...d, assignedTo: userId } : d
    ));
  };

  const { data: clubs } = useQuery({
    queryKey: ["user-admin-clubs", user?.id],
    queryFn: async () => {
      const { data: clubRoles } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .in("role", ["club_admin", "committee_member"])
        .not("club_id", "is", null);

      const { data: teamRoles } = await supabase
        .from("user_roles")
        .select("team_id, teams!inner(club_id)")
        .eq("user_id", user!.id)
        .in("role", ["team_admin", "coach"])
        .not("team_id", "is", null);

      const clubIdsFromClubs = clubRoles?.map((r) => r.club_id).filter(Boolean) || [];
      const clubIdsFromTeams = teamRoles?.map((r) => (r.teams as any)?.club_id).filter(Boolean) || [];
      const clubIds = [...new Set([...clubIdsFromClubs, ...clubIdsFromTeams])];

      if (clubIds.length === 0) return [];

      const { data } = await supabase
        .from("clubs")
        .select("id, name, allow_guests_default, max_guests_per_member_default")
        .in("id", clubIds);

      return data || [];
    },
    enabled: !!user,
  });

  // Auto-select filtered club when active
  const filteredClubs = activeClubFilter
    ? clubs?.filter(c => c.id === activeClubFilter)
    : clubs;

  // Auto-select club: prefer activeClubFilter, fallback to single club
  useEffect(() => {
    if (clubId) return; // Already selected
    if (activeClubFilter && clubs?.some(c => c.id === activeClubFilter)) {
      setClubId(activeClubFilter);
    } else if (filteredClubs?.length === 1) {
      setClubId(filteredClubs[0].id);
    }
  }, [activeClubFilter, clubs, filteredClubs, clubId]);

  // Apply club guest defaults when club is selected
  useEffect(() => {
    if (clubId && clubs) {
      const selectedClub = clubs.find((c: any) => c.id === clubId);
      if (selectedClub) {
        setAllowGuests(selectedClub.allow_guests_default || false);
        setMaxGuestsPerMember(selectedClub.max_guests_per_member_default || 2);
      }
    }
  }, [clubId, clubs]);



  const { data: isClubAdminForSelectedClub } = useQuery({
    queryKey: ["is-club-admin-for-event", clubId, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("club_id", clubId)
        .eq("role", "club_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!clubId && !!user,
  });

  // Check if club has Pro Football access - use placeholderData to prevent flash
  const { data: hasProFootball, isLoading: isLoadingProFootball } = useQuery({
    queryKey: ["club-pro-football", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("club_subscriptions")
        .select("is_pro_football, admin_pro_football_override, expires_at")
        .eq("club_id", clubId)
        .maybeSingle();
      if (!data) return false;
      const hasAccess = data.is_pro_football || data.admin_pro_football_override;
      const notExpired = !data.expires_at || new Date(data.expires_at) > new Date();
      return hasAccess && notExpired;
    },
    enabled: !!clubId,
    placeholderData: false, // Prevent undefined state causing delayed render
  });

  // Fetch mini leagues for the selected club (Pro Football only)
  const fetchMiniLeagues = async (): Promise<{ id: string; name: string }[]> => {
    const { data, error } = await (supabase as any)
      .from("mini_leagues")
      .select("id, name")
      .eq("club_id", clubId)
      .order("name");
    if (error) throw error;
    return data || [];
  };

  const { data: miniLeagues } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["club-mini-leagues", clubId],
    queryFn: fetchMiniLeagues,
    enabled: !!clubId && !!hasProFootball,
  });

  // Fetch the specific mini league name when coming from a mini league
  const miniLeagueName = isFromMiniLeague
    ? miniLeagues?.find(ml => ml.id === presetMiniLeagueId)?.name
    : undefined;

  // Get teams user has direct membership in (team_admin, coach, or any team role)
  const { data: userTeamIds } = useQuery({
    queryKey: ["user-team-memberships", clubId, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("team_id")
        .eq("user_id", user!.id)
        .not("team_id", "is", null);

      return data?.map(r => r.team_id).filter(Boolean) || [];
    },
    enabled: !!clubId && !!user,
  });

  const { data: teams } = useQuery({
    queryKey: ["club-teams-for-event", clubId, user?.id, isClubAdminForSelectedClub, userTeamIds],
    queryFn: async () => {
      // If user is club admin but not a member of any team in this club,
      // only show teams they have direct membership in
      // If user is team admin/coach, they already have the team in userTeamIds

      // Get all teams in the club first
      const { data: allTeams } = await supabase
        .from("teams")
        .select("id, name, club_id")
        .eq("club_id", clubId)
        .is("deleted_at", null);

      if (!allTeams) return [];

      // Filter to only teams the user is a member of
      if (userTeamIds && userTeamIds.length > 0) {
        const teamsInClub = allTeams.filter(t =>
          userTeamIds.includes(t.id)
        );
        return teamsInClub;
      }

      // If no team memberships, return empty (club admin without team membership can't create team events)
      return [];
    },
    enabled: !!clubId && userTeamIds !== undefined,
  });

  // All teams in the selected club — used by the target-teams picker
  // (independent of the caller's team memberships).
  const { data: allClubTeams } = useQuery({
    queryKey: ["all-club-teams-for-target", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("teams")
        .select("id, name")
        .eq("club_id", clubId!)
        .is("deleted_at", null)
        .order("name");
      return data ?? [];
    },
    enabled: !!clubId,
  });

  // Check if user is committee-only for the selected club (no admin/coach/team roles)
  const isCommitteeOnlyForClub = useMemo(() => {
    if (!clubId || !user) return false;
    if (isClubAdminForSelectedClub) return false;
    // Wait for teams to finish loading before deciding
    if (teams === undefined) return false;
    if (teams.length > 0) return false;
    return true;
  }, [clubId, user, isClubAdminForSelectedClub, teams]);

  // Committee-only users may create club-wide games or socials.
  // Force them off training / mini_league only.
  useEffect(() => {
    if (
      isCommitteeOnlyForClub &&
      type !== "social" &&
      type !== "game" &&
      !isFromMiniLeague
    ) {
      setType("social");
    }
  }, [isCommitteeOnlyForClub, type, isFromMiniLeague]);

  const { data: members } = useQuery({
    queryKey: ["event-members-for-duty", clubId, teamId],
    queryFn: async () => {
      // Get members from team if selected, otherwise from club
      const targetId = teamId || clubId;
      const idColumn = teamId ? "team_id" : "club_id";

      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, profiles!inner(id, display_name, avatar_url)")
        .eq(idColumn, targetId);

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
    enabled: !!clubId,
  });

  // Fetch saved locations from previous events for the selected club
  const { data: savedLocations } = useQuery({
    queryKey: ["saved-locations", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("events")
        .select("address, suburb, state, postcode")
        .eq("club_id", clubId)
        .not("address", "is", null)
        .neq("address", "")
        .order("event_date", { ascending: false })
        .limit(50);

      if (!data) return [];

      // Deduplicate by address
      const seen = new Set<string>();
      const uniqueLocations: SavedLocation[] = [];

      for (const event of data) {
        const key = event.address?.toLowerCase().trim();
        if (key && !seen.has(key)) {
          seen.add(key);
          uniqueLocations.push({
            address: event.address!,
            suburb: event.suburb,
            state: event.state,
            postcode: event.postcode,
          });
        }
        if (uniqueLocations.length >= 10) break;
      }

      return uniqueLocations;
    },
    enabled: !!clubId,
  });

  // Fetch favorite event titles
  const queryClient = useQueryClient();
  const { data: favoriteTitles } = useQuery({
    queryKey: ["favorite-event-titles", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("favorite_event_titles")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!user,
  });

  const saveFavoriteTitle = async () => {
    if (!user || !title.trim()) return;

    const { error } = await supabase
      .from("favorite_event_titles")
      .insert({
        user_id: user.id,
        title: title.trim(),
        event_type: type,
      });

    if (error) {
      if (error.code === "23505") {
        toast({ title: "Already saved", description: "This title is already in your favorites" });
      } else {
        toast({ title: "Error", description: "Failed to save favorite", variant: "destructive" });
      }
    } else {
      toast({ title: "Saved!", description: "Title added to favorites" });
      queryClient.invalidateQueries({ queryKey: ["favorite-event-titles"] });
    }
  };

  const deleteFavoriteTitle = async (id: string) => {
    const { error } = await supabase
      .from("favorite_event_titles")
      .delete()
      .eq("id", id);

    if (!error) {
      queryClient.invalidateQueries({ queryKey: ["favorite-event-titles"] });
    }
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

  // Check for conflicting events at the same day, time, and location.
  // Returns an explicit result — a failed read is NEVER treated as "no conflict".
  const checkForConflicts = useCallback(async (): Promise<ConflictCheckResult> => {
    if (type !== "training" || !clubId || !eventDateTime || !address.trim()) {
      return { status: "clear" }; // Only check training events with a location set
    }

    const parsedDateTime = new Date(eventDateTime);
    const eventDateStr = parsedDateTime.toISOString().split("T")[0];

    // Query all events for the same club on the same date (includes recurring child events)
    const directDateQuery = await supabase
      .from("events")
      .select("id, title, event_date, address, team_id, teams(name)")
      .eq("club_id", clubId)
      .eq("is_cancelled", false)
      .gte("event_date", `${eventDateStr}T00:00:00`)
      .lte("event_date", `${eventDateStr}T23:59:59`);

    if (directDateQuery.error) return { status: "error" };

    // Also check recurring parent events whose children might not yet exist on this date
    // (e.g. if the new event date is beyond existing generated children)
    const recurringParentQuery = await supabase
      .from("events")
      .select("id, title, event_date, address, team_id, teams(name), recurrence_end_date")
      .eq("club_id", clubId)
      .eq("is_recurring", true)
      .eq("is_cancelled", false)
      .not("address", "is", null)
      .lte("event_date", parsedDateTime.toISOString())
      .or(`recurrence_end_date.gte.${eventDateStr},recurrence_end_date.is.null`);

    if (recurringParentQuery.error) return { status: "error" };

    const result = evaluateTrainingConflicts({
      targetDateTime: parsedDateTime,
      address,
      directDateQuery: directDateQuery as any,
      recurringParentQuery: recurringParentQuery as any,
    });

    if (result.status === "conflict") setConflictingEvents(result.conflicts);
    return result;
  }, [type, clubId, eventDateTime, address]);


  const handleSubmit = async (skipConflictCheck = false) => {
    // Prevent double-submission
    if (saving) return;

    if (!title.trim() || !clubId || !eventDateTime) {
      toast({
        title: "Missing information",
        description: "Please fill in all required fields.",
      });
      return;
    }

    // Remember last used event type
    localStorage.setItem("lastEventType", type);

    // Training, games and socials may be club-wide ("All Club") or targeted at
    // a subset of teams. When a subset is chosen it must contain 2+ teams.
    if (!teamId && targetTeamIds !== null && targetTeamIds.length < 2) {
      toast({
        title: "Select at least 2 teams",
        description:
          "Pick two or more teams, or choose All Club members. For a single team, select it in the Team dropdown.",
        variant: "destructive",
      });
      return;
    }


    // Guard against a stale team selection: if the team was soft-deleted
    // (possibly from another device) the event — and its auto "event created"
    // system message — would land in a dead chat thread.
    if (teamId) {
      const { data: teamRow, error: teamCheckError } = await supabase
        .from("teams")
        .select("id, deleted_at")
        .eq("id", teamId)
        .maybeSingle();
      if (teamCheckError || !teamRow || (teamRow as any).deleted_at) {
        toast({
          title: "Team no longer available",
          description: teamCheckError
            ? "Could not verify the selected team. Please try again."
            : "The selected team has been deleted. Please pick a current team.",
          variant: "destructive",
        });
        return;
      }
    }

    // Frontend club/team scope guard — matches the backend
    // validate_event_team_club_scope trigger. Fail closed if the team list
    // is unavailable or stale so we never submit an ambiguous combination.
    {
      const check = validateEventTeamClubScope(teamId, teams, clubId);
      if (check.ok === false) {
        const reason = check.reason;
        toast({
          title:
            reason === "list_unavailable"
              ? "Team list unavailable"
              : "Team does not belong to selected club",
          description:
            reason === "list_unavailable"
              ? "Please reselect the club so we can load its teams before creating the event."
              : "The selected team is not part of the selected club. Please choose a team from this club.",
          variant: "destructive",
        });
        return;
      }
    }

    if (!address.trim()) {
      setOpenSections((s) => ({ ...s, location: true }));
      toast({
        title: "Location required",
        description: "Please add a location for this event.",
        variant: "destructive",
      });
      return;
    }

    // Require mini league selection for mini league events
    if (type === "mini_league" && !miniLeagueId) {
      toast({
        title: "Mini League required",
        description: "Please select a mini league for this event.",
      });
      return;
    }

    if (isRecurring && !recurrenceEndDate) {
      toast({
        title: "Missing end date",
        description: "Please set an end date for recurring events.",
        variant: "destructive",
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
    // Check for conflicts before saving
    if (!skipConflictCheck && type === "training") {
      const conflictResult = await checkForConflicts();
      if (conflictResult.status === "error") {
        // Fail closed: never treat a failed read as "no conflict".
        setConflictDialogOpen(false);
        setConflictingEvents([]);
        toast({
          title: CONFLICT_CHECK_ERROR_TITLE,
          description: CONFLICT_CHECK_ERROR_DESCRIPTION,
          variant: "destructive",
        });
        return;
      }
      if (conflictResult.status === "conflict") {
        setConflictDialogOpen(true);
        return;
      }
    }


    setSaving(true);

    const parsedDateTime = new Date(eventDateTime);
    const parsedPrice = price ? parseFloat(price) : null;
    const baseEventData = {
      title: title.trim(),
      type: type === "mini_league" ? "game" : type, // Store mini_league as game type
      club_id: clubId,
      team_id: type === "mini_league" ? null : (teamId || null),
      mini_league_id: type === "mini_league" ? miniLeagueId : null,
      address: address.trim() || null,
      suburb: null,
      state: null,
      postcode: null,
      description: description.trim() || null,
      created_by: user!.id,
      is_recurring: isRecurring,
      recurrence_end_date: isRecurring ? recurrenceEndDate : null,
      reminder_hours_before: reminderEnabled ? reminderHours : null,
      reminder_sent: false,
      amount: type === "social" ? parsedPrice : null,
      opponent: type === "game" && !isBye ? opponent.trim() || null : null,
      arrival_minutes_before: type === "game" && !isBye && arrivalMinutesBefore.trim() !== "" ? parseInt(arrivalMinutesBefore, 10) : null,
      rsvp_audience: rsvpAudience,
      is_bye: type === "game" ? isBye : false,
      allow_guests: type === "social" && allowGuests ? true : null,
      max_guests_per_member: type === "social" && allowGuests ? maxGuestsPerMember : null,
      start_time: timeToTimestamp(getStartTimeStr(), parsedDateTime),
      end_time: timeToTimestamp(endTime, parsedDateTime),
      restricted_to_roles:
        type === "social" && !teamId && restrictedRoles.length > 0 ? restrictedRoles : null,
      adults_only: adultsOnly,
      rsvp_grouping:
        !teamId && supportsClubWideScope && rsvpGrouping ? rsvpGrouping : null,
      target_team_ids:
        !teamId && supportsClubWideScope && targetTeamIds && targetTeamIds.length >= 2
          ? targetTeamIds
          : null,

    } as any;

    // The event row, any recurring occurrences and the duties are written by a
    // single transactional RPC: either everything commits or nothing does, so a
    // duty failure can never leave an orphaned event behind.
    const dutyPayload =
      type === "game"
        ? duties.map((duty) => ({ name: duty.name, assigned_to: duty.assignedTo }))
        : [];

    try {
      let childDates: string[] | null = null;
      if (isRecurring) {
        const endDate = new Date(recurrenceEndDate);
        const dates = generateRecurringDates(parsedDateTime, endDate);
        childDates = dates.slice(1).map((date) => {
          const childDateTime = new Date(date);
          childDateTime.setHours(parsedDateTime.getHours(), parsedDateTime.getMinutes());
          return childDateTime.toISOString();
        });
        if (childDates.length === 0) childDates = null;
      }

      const { data: newEventId, error } = await supabase.rpc("create_event_with_duties", {
        p_event: {
          ...baseEventData,
          event_date: parsedDateTime.toISOString(),
        } as any,
        p_child_dates: childDates,
        p_duties: dutyPayload as any,
      });

      if (error) throw error;
      if (!newEventId) throw new Error("Event could not be created.");

      try {
        await queryClient.invalidateQueries({
          queryKey: eventKeys.home(user!.id),
        });
        // Also refresh every other event-derived surface (Schedule list, team
        // next-event) and drop the persisted localStorage snapshots so a cold
        // open cannot repaint a list that predates this event.
        refreshEventCaches(queryClient, user!.id);
      } catch (invalidationError) {
        console.warn("Next Up invalidation failed after event creation:", invalidationError);
      }

      navigate(`/events/${newEventId}`);
    } catch (error: any) {
      console.error("Error creating event:", error);




      const errorBlob = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`.toLowerCase();

      // Friendly message for the notification-dispatch trigger failure class
      if (
        /http_request_queue/.test(errorBlob) ||
        /null value in column "url"/.test(errorBlob) ||
        /compute_push_notification_url/.test(errorBlob) ||
        /send_push_notification/.test(errorBlob)
      ) {
        toast(friendlyMutationError(error, { description: "Failed to create event. Please try again." }));
        return;
      }

      // Build a more helpful error message
      let errorDescription = "Failed to create event. ";


      if (error?.message?.includes("row-level security")) {
        errorDescription += "You don't have permission to create events for this club/team.";
      } else if (
        error?.code === "23505" ||
        errorBlob.includes("events_unique_occurrence_idx") ||
        errorBlob.includes("duplicate key") ||
        errorBlob.includes("unique constraint")
      ) {
        errorDescription =
          isRecurring
            ? "Some dates in this recurring series already have a matching event (same title, type, team and date). Check your Schedule — a previous series may already cover these dates. Try a different title or adjust the date range."
            : "An event with the same title, type, team and date already exists. Open your Schedule to find it — a recurring series you previously created may already cover this date.";
      } else if (error?.message?.includes("violates check constraint")) {
        errorDescription += "Please check that all fields have valid values.";
      } else if (error?.code === "23502") {
        // Not null violation
        errorDescription += "Some required information is missing.";
      } else if (error?.message) {
        errorDescription += error.message;
      } else {
        // Provide guidance on what might be missing
        const missingFields: string[] = [];
        if (!title.trim()) missingFields.push("Event title");
        if (!clubId) missingFields.push("Club selection");
        if (!eventDateTime) missingFields.push("Date and time");
        if (!teamId && targetTeamIds !== null && targetTeamIds.length < 2) missingFields.push("Team selection");

        if (missingFields.length > 0) {
          errorDescription = `Missing required fields: ${missingFields.join(", ")}`;
        } else {
          errorDescription += "Please try again.";
        }
      }

      toast({
        title: "Error",
        description: errorDescription,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };


  // Check if user has any clubs to create events for (meaning they have admin/coach permission)
  const hasPermission = clubs && clubs.length > 0;

  // No permission fallback
  if (clubs !== undefined && !hasPermission) {
    return (
      <div className="pb-6 space-y-4">
        <div className="flex items-center gap-3 py-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/events")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold">New Event</h1>
        </div>
        <Card className="border-destructive/30">
          <CardContent className="py-8 text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <Calendar className="h-6 w-6 text-destructive" />
            </div>
            <h2 className="font-semibold">Permission Required</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Only club admins, team admins, and coaches can create events. Contact your club administrator if you need access.
            </p>
            <Button variant="outline" onClick={() => navigate("/events")} className="mt-2">
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="pb-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 py-4">
        <Button variant="ghost" size="icon" onClick={() => isFromMiniLeague ? navigate(-1) : navigate("/events")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{isFromMiniLeague ? "New Match Day" : "New Event"}</h1>
          {isFromMiniLeague && miniLeagueName && (
            <p className="text-sm text-muted-foreground">{miniLeagueName}</p>
          )}
        </div>
      </div>

      {/* Event Type Selection - hidden when coming from mini league */}
      {!isFromMiniLeague && ((clubId && isLoadingProFootball) ? (
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col items-center gap-1 p-3 rounded-xl border-2 border-border animate-pulse">
              <div className="w-8 h-8 rounded bg-muted" />
              <div className="w-12 h-3 rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : (
      <div className={cn("grid gap-2", isCommitteeOnlyForClub ? "grid-cols-2 max-w-[240px]" : "grid-cols-3")}>
        {EVENT_TYPES.map((eventType) => {
          // Committee-only users can create club-wide games or socials.
          if (isCommitteeOnlyForClub && eventType.value !== "social" && eventType.value !== "game") return null;


          return (
            <button
              key={eventType.value}
              type="button"
              onClick={() => {
                setType(eventType.value as EventType);
                // Clear mini league if switching away
                if (eventType.value !== "mini_league") {
                  setMiniLeagueId("");
                }
                // Clear team if switching to mini league
                if (eventType.value === "mini_league") {
                  setTeamId("");
                }
              }}
              className={cn(
                "flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all",
                type === eventType.value
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-muted-foreground/50"
              )}
            >
              <span className="text-2xl">{eventType.icon}</span>
              <span className="text-xs font-medium">{eventType.label}</span>
            </button>
          );
        })}
      </div>
      ))}


      {/* Details Section */}
      <Card>
        <Collapsible open={openSections.details}>
          <EventSectionHeader
            icon={FileText}
            title={isFromMiniLeague ? "Match Day Details" : "Event Details"}
            isOpen={openSections.details}
            onClick={() => toggleSection('details')}
            badge="Required"
          />
          <CollapsibleContent>
            <CardContent className="pt-0 pb-4 px-4 space-y-4">
              {/* Title */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="title">{isFromMiniLeague ? "Match Day Title" : "Event Title"}</Label>
                  <div className="flex items-center gap-1">
                    {favoriteTitles && favoriteTitles.length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                            <Star className="h-3 w-3" />
                            Favorites
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                          {favoriteTitles.map((fav) => (
                            <DropdownMenuItem
                              key={fav.id}
                              className="flex items-center justify-between gap-2"
                              onSelect={() => {
                                setTitle(fav.title);
                                setType(fav.event_type as EventType);
                              }}
                            >
                              <span className="flex-1 truncate">
                                {fav.title}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 hover:bg-destructive/10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  deleteFavoriteTitle(fav.id);
                                }}
                              >
                                <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                              </Button>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {title.trim() && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={saveFavoriteTitle}
                      >
                        <Star className="h-3 w-3" />
                        Save
                      </Button>
                    )}
                  </div>
                </div>
                <div className="relative">
                  <Input
                    id="title"
                    placeholder={isFromMiniLeague ? "e.g., Round 1" : "e.g., Saturday Training"}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={100}
                    className={title ? "pr-8" : ""}
                  />
                  {title && (
                    <button
                      type="button"
                      onClick={() => setTitle("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Club & Team/Mini League */}
              <div className="flex flex-col gap-3">
                {!isFromMiniLeague && (
                <MobileCardSelect
                  value={clubId}
                  onValueChange={(v) => {
                    setClubId(v);
                    setTeamId("");
                    setMiniLeagueId("");
                  }}
                  options={filteredClubs?.map((club) => ({ value: club.id, label: club.name })) || []}
                  placeholder="Select club"
                  label="Club"
                  required
                  disabled={!!activeClubFilter}
                />
                )}

                {/* Audience selection — single control for club / one team / several teams */}
                {type !== "mini_league" && (
                  <EventAudienceSelector
                    teams={teams ?? undefined}
                    clubTeams={allClubTeams ?? undefined}
                    teamId={teamId}
                    onTeamIdChange={setTeamId}
                    targetTeamIds={targetTeamIds}
                    onTargetTeamIdsChange={setTargetTeamIds}
                    supportsClubWideScope={supportsClubWideScope}
                    disabled={!clubId}
                    defaultMode="team"
                  />
                )}




                {/* Mini League selection - only for mini_league events, hidden when pre-set */}
                {type === "mini_league" && !isFromMiniLeague && (
                  <MobileCardSelect
                    value={miniLeagueId}
                    onValueChange={setMiniLeagueId}
                    options={miniLeagues?.map((ml) => ({ value: ml.id, label: ml.name })) || []}
                    placeholder="Select mini league"
                    label="Mini League"
                    disabled={!clubId}
                    required
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
                  clubId={clubId}
                  teamId={teamId}
                />
              )}

              {type === "game" && !isBye && (
                <div className="space-y-2">
                  <Label htmlFor="arrival">Arrive before kickoff (optional)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="arrival"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={480}
                      placeholder="e.g. 30"
                      value={arrivalMinutesBefore}
                      onChange={(e) => setArrivalMinutesBefore(e.target.value)}
                      className="w-32"
                    />
                    <span className="text-sm text-muted-foreground">minutes before</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Leave blank to hide arrival time on this match.</p>
                </div>
              )}

              {/* Paid event - only for social events */}
              {type === "social" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <Label htmlFor="paid-event" className="text-sm font-medium">Paid event</Label>
                      <p className="text-xs text-muted-foreground">Charge attendees to come along.</p>
                    </div>
                    <Switch
                      id="paid-event"
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
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="price"
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={price}
                          onChange={(e) => setPrice(e.target.value)}
                          className="pl-9"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <MoreEventOptions
                showGrouping={!teamId && supportsClubWideScope}
                rsvpGrouping={rsvpGrouping}
                onRsvpGroupingChange={setRsvpGrouping}
                adultsOnly={adultsOnly}
                onAdultsOnlyChange={setAdultsOnly}
                showRoleRestriction={type === "social" && !teamId}
                restrictedRoles={restrictedRoles}
                onRestrictedRolesChange={setRestrictedRoles}
                extraSummary={type === "social" && allowGuests ? ["Guests allowed"] : undefined}
              >
                {/* Guest settings - only for social events, only for club admins */}
                {type === "social" && isClubAdminForSelectedClub && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <Label htmlFor="allow-guests" className="flex items-center gap-2">
                          <UserPlus className="h-4 w-4" />
                          Allow Guests
                        </Label>
                        <span className="text-xs text-muted-foreground">
                          Members can add non-member guests
                        </span>
                      </div>
                      <Switch
                        id="allow-guests"
                        checked={allowGuests}
                        onCheckedChange={setAllowGuests}
                      />
                    </div>
                    {allowGuests && (
                      <div className="space-y-2 pl-6">
                        <Label htmlFor="max-guests">Max guests per member</Label>
                        <Input
                          id="max-guests"
                          type="number"
                          min={1}
                          max={20}
                          value={maxGuestsPerMember}
                          onChange={(e) => setMaxGuestsPerMember(parseInt(e.target.value) || 1)}
                          className="w-24"
                        />
                      </div>
                    )}
                  </div>
                )}
              </MoreEventOptions>


              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Textarea
                  id="description"
                  placeholder="Add any additional details..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="resize-none"
                />
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Schedule Section */}
      <EventScheduleSection
        isOpen={openSections.schedule}
        onToggle={() => toggleSection('schedule')}
        isFromMiniLeague={isFromMiniLeague}
        eventDateTime={eventDateTime}
        onEventDateTimeChange={setEventDateTime}
        endTimeMode={endTimeMode}
        onEndTimeModeChange={setEndTimeMode}
        duration={duration}
        onDurationChange={handleDurationChange}
        endTime={endTime}
        onEndTimeChange={handleEndTimeChange}
        isRecurring={isRecurring}
        onIsRecurringChange={setIsRecurring}
        recurrencePattern={recurrencePattern}
        recurrenceDays={recurrenceDays}
        recurrenceInterval={recurrenceInterval}
        recurrenceEndDate={recurrenceEndDate}
        onRecurrencePatternChange={setRecurrencePattern}
        onToggleRecurrenceDay={toggleRecurrenceDay}
        onRecurrenceIntervalChange={setRecurrenceInterval}
        onRecurrenceEndDateChange={setRecurrenceEndDate}
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
                onRemoveDuty={(duty) => removeDuty(duty.name)}
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
            badge={address.trim() ? "Set" : "Required"}
          />
          <CollapsibleContent>
            <CardContent className="pt-0 pb-4 px-4 space-y-3">
              <EventLocationFields
                value={address}
                savedLocations={savedLocations}
                onChange={setAddress}
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
            title="Reminders"
            isOpen={openSections.options}
            onClick={() => toggleSection('options')}
            badge={reminderEnabled ? "On" : "Off"}
          />
          <CollapsibleContent>
            <CardContent className="pt-0 pb-4 px-4 space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">Auto RSVP Reminder</span>
                  <span className="text-xs text-muted-foreground">
                    Remind members who haven't responded
                  </span>
                </div>
                <Switch
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
                    <SelectTrigger className="h-12 text-base">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" sideOffset={4}>
                      <SelectItem value="6" className="py-3 text-base">6 hours before</SelectItem>
                      <SelectItem value="12" className="py-3 text-base">12 hours before</SelectItem>
                      <SelectItem value="24" className="py-3 text-base">24 hours before</SelectItem>
                      <SelectItem value="48" className="py-3 text-base">2 days before</SelectItem>
                      <SelectItem value="72" className="py-3 text-base">3 days before</SelectItem>
                      <SelectItem value="168" className="py-3 text-base">1 week before</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Submit Button - Sticky on mobile */}
      <div className="sticky bottom-0 z-20 -mx-4 border-t border-border bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button
          className="w-full h-12 text-base font-semibold shadow-lg disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground"
          onClick={() => handleSubmit()}
          disabled={saving || !title.trim() || !clubId || !eventDateTime || !address.trim()}
        >
          {saving ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            isFromMiniLeague ? "Create Match Day" : "Create Event"
          )}
        </Button>
      </div>


      {/* Conflict Detection Dialog */}
      <AlertDialog open={conflictDialogOpen} onOpenChange={setConflictDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Training Already Scheduled</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>There {conflictingEvents.length === 1 ? "is" : "are"} already {conflictingEvents.length} training session{conflictingEvents.length > 1 ? "s" : ""} at the same time and location:</p>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  {conflictingEvents.map((evt, i) => (
                    <li key={i}>
                      <span className="font-medium">{evt.title}</span>
                      {evt.team_name && <span className="text-muted-foreground"> — {evt.team_name}</span>}
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-muted-foreground pt-1">This is fine if multiple teams share the venue. Just confirming you're aware.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go Back</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConflictDialogOpen(false); handleSubmit(true); }}>
              Continue & Create
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
