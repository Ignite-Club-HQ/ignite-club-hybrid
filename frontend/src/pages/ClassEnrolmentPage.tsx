import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, UserPlus, Users, Clock, CalendarDays, AlertCircle, List } from "lucide-react";
import { format, getDay, startOfMonth, endOfMonth, eachDayOfInterval, parseISO } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { MobileSelect } from "@/components/ui/mobile-select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabClassEnrolment } from "@/lab/fixtureDataLayer";

type TeamType = "junior" | "senior" | "mixed";

export default function ClassEnrolmentPage() {
  const navigate = useNavigate();
  const { teamId } = useParams<{ teamId: string }>();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    const enrolment = getLocalLabClassEnrolment(teamId ?? "team-icp-001");
    return (
      <div className="container max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold">{enrolment.class_name}</h1>
        </div>
        <Alert>
          <AlertDescription>
            Showing synthetic ICP lab enrolment data. Submitting a new enrolment is disabled.
          </AlertDescription>
        </Alert>
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-sm">
              <span className="font-medium">Capacity:</span> {enrolment.capacity}
            </p>
            <p className="text-sm font-medium flex items-center gap-1"><Users className="h-4 w-4" /> Enrolled</p>
            <ul className="text-sm text-muted-foreground list-disc list-inside">
              {enrolment.enrolled.map((child) => (
                <li key={child.id}>{child.display_name}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <SupabaseClassEnrolmentPage />;
}

function SupabaseClassEnrolmentPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Auth gate: redirect unauthenticated users to login with return URL
  useEffect(() => {
    if (!authLoading && !user) {
      sessionStorage.setItem("redirectAfterAuth", `/clubs/${clubId}/enrol`);
      navigate("/auth", { replace: true });
    }
  }, [authLoading, user, clubId, navigate]);

  const [selectedTermId, setSelectedTermId] = useState<string>("");
  const [enrollingClassId, setEnrollingClassId] = useState<string | null>(null);

  // Fetch club info
  const { data: club } = useQuery({
    queryKey: ["club", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("name, logo_url, class_mode_enabled")
        .eq("id", clubId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
  });

  // Fetch active terms
  const { data: terms = [], isLoading: termsLoading } = useQuery({
    queryKey: ["terms", clubId, "active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("terms")
        .select("*")
        .eq("club_id", clubId!)
        .eq("is_active", true)
        .order("start_date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
  });

  // Auto-select first term
  const activeTerm = terms.find((t) => t.id === selectedTermId) || terms[0];
  const termId = activeTerm?.id;

  // Fetch classes (teams with class fields) for this club - include team_type
  const { data: classes = [], isLoading: classesLoading } = useQuery({
    queryKey: ["club-classes", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, class_day, class_time, class_duration_minutes, class_capacity, level_age, logo_url, team_type")
        .eq("club_id", clubId!)
        .eq("is_archived", false)
        .not("class_day", "is", null)
        .order("class_day")
        .order("class_time");
      if (error) throw error;
      return data as Array<{
        id: string;
        name: string;
        class_day: string | null;
        class_time: string | null;
        class_duration_minutes: number | null;
        class_capacity: number | null;
        level_age: string | null;
        logo_url: string | null;
        team_type: TeamType;
      }>;
    },
    enabled: !!clubId,
  });

  // Determine if any class allows child enrolment (junior or mixed)
  const hasChildClasses = classes.some((c) => c.team_type === "junior" || c.team_type === "mixed");
  // Determine if any class allows adult enrolment (senior or mixed)
  const hasAdultClasses = classes.some((c) => c.team_type === "senior" || c.team_type === "mixed");

  // Fetch user's children (only needed if there are junior/mixed classes)
  const { data: children = [] } = useQuery({
    queryKey: ["my-children", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("children")
        .select("*")
        .eq("parent_id", user!.id)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!user && hasChildClasses,
  });

  // Fetch existing child enrolments for the selected term
  const childIds = children.map((c) => c.id);
  const { data: childEnrolments = [] } = useQuery({
    queryKey: ["class-enrolments-children", termId, user?.id, childIds],
    queryFn: async () => {
      if (!termId || childIds.length === 0) return [];
      const { data, error } = await supabase
        .from("class_enrolments")
        .select("*")
        .eq("term_id", termId)
        .in("child_id", childIds);
      if (error) throw error;
      return data;
    },
    enabled: !!termId && childIds.length > 0,
  });

  // Fetch existing adult (self) enrolments for the selected term
  const { data: selfEnrolments = [] } = useQuery({
    queryKey: ["class-enrolments-self", termId, user?.id],
    queryFn: async () => {
      if (!termId || !user) return [];
      const { data, error } = await supabase
        .from("class_enrolments")
        .select("*")
        .eq("term_id", termId)
        .eq("user_id", user.id);
      if (error) throw error;
      return data;
    },
    enabled: !!termId && !!user && hasAdultClasses,
  });

  // Combined enrolments for display
  const allEnrolments = [...childEnrolments, ...selfEnrolments];

  // Fetch enrolment counts per class for capacity check
  const { data: enrolmentCounts = {} } = useQuery({
    queryKey: ["class-enrolment-counts", termId],
    queryFn: async () => {
      if (!termId) return {};
      const classIds = classes.map((c) => c.id);
      if (classIds.length === 0) return {};

      const { data, error } = await supabase
        .from("class_enrolments")
        .select("team_id, status")
        .eq("term_id", termId)
        .in("team_id", classIds)
        .eq("status", "enrolled");
      if (error) throw error;

      const counts: Record<string, number> = {};
      data?.forEach((e) => {
        counts[e.team_id] = (counts[e.team_id] || 0) + 1;
      });
      return counts;
    },
    enabled: !!termId && classes.length > 0,
  });

  // Enrol child mutation
  const enrolChildMutation = useMutation({
    mutationFn: async ({ childId, teamId }: { childId: string; teamId: string }) => {
      if (!termId) throw new Error("No term selected");

      const cls = classes.find((c) => c.id === teamId);
      const currentCount = enrolmentCounts[teamId] || 0;
      const isFull = cls?.class_capacity && currentCount >= cls.class_capacity;
      const status = isFull ? "waitlisted" : "enrolled";

      let waitlistPosition: number | null = null;
      if (status === "waitlisted") {
        const { count } = await supabase
          .from("class_enrolments")
          .select("*", { count: "exact", head: true })
          .eq("term_id", termId)
          .eq("team_id", teamId)
          .eq("status", "waitlisted");
        waitlistPosition = (count || 0) + 1;
      }

      const { error } = await supabase.from("class_enrolments").insert({
        child_id: childId,
        team_id: teamId,
        term_id: termId,
        status,
        waitlist_position: waitlistPosition,
      });
      if (error) throw error;
      return { status };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["class-enrolments-children"] });
      queryClient.invalidateQueries({ queryKey: ["class-enrolment-counts"] });
      setEnrollingClassId(null);
      toast({
        title: result.status === "enrolled" ? "Enrolled!" : "Added to waitlist",
        description: result.status === "enrolled"
          ? "Your child has been enrolled in the class."
          : "The class is full. Your child has been added to the waitlist.",
      });
    },
    onError: (error: any) => {
      setEnrollingClassId(null);
      const isDuplicate = error?.code === "23505" || error?.message?.includes("duplicate");
      toast({
        title: isDuplicate ? "Already enrolled" : "Enrolment failed",
        description: isDuplicate
          ? "Already enrolled in this class for the selected term."
          : "Please try again.",
        variant: "destructive",
      });
    },
  });

  // Enrol self (adult) mutation
  const enrolSelfMutation = useMutation({
    mutationFn: async ({ teamId }: { teamId: string }) => {
      if (!termId || !user) throw new Error("No term selected or not logged in");

      const cls = classes.find((c) => c.id === teamId);
      const currentCount = enrolmentCounts[teamId] || 0;
      const isFull = cls?.class_capacity && currentCount >= cls.class_capacity;
      const status = isFull ? "waitlisted" : "enrolled";

      let waitlistPosition: number | null = null;
      if (status === "waitlisted") {
        const { count } = await supabase
          .from("class_enrolments")
          .select("*", { count: "exact", head: true })
          .eq("term_id", termId)
          .eq("team_id", teamId)
          .eq("status", "waitlisted");
        waitlistPosition = (count || 0) + 1;
      }

      const { error } = await supabase.from("class_enrolments").insert({
        user_id: user.id,
        team_id: teamId,
        term_id: termId,
        status,
        waitlist_position: waitlistPosition,
      });
      if (error) throw error;
      return { status };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["class-enrolments-self"] });
      queryClient.invalidateQueries({ queryKey: ["class-enrolment-counts"] });
      setEnrollingClassId(null);
      toast({
        title: result.status === "enrolled" ? "Enrolled!" : "Added to waitlist",
        description: result.status === "enrolled"
          ? "You have been enrolled in the class."
          : "The class is full. You have been added to the waitlist.",
      });
    },
    onError: (error: any) => {
      setEnrollingClassId(null);
      const isDuplicate = error?.code === "23505" || error?.message?.includes("duplicate");
      toast({
        title: isDuplicate ? "Already enrolled" : "Enrolment failed",
        description: isDuplicate
          ? "You are already enrolled in this class for the selected term."
          : "Please try again.",
        variant: "destructive",
      });
    },
  });

  // Withdraw mutation
  const withdrawMutation = useMutation({
    mutationFn: async (enrolmentId: string) => {
      const { error } = await supabase
        .from("class_enrolments")
        .update({ status: "withdrawn", withdrawn_at: new Date().toISOString() })
        .eq("id", enrolmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["class-enrolments-children"] });
      queryClient.invalidateQueries({ queryKey: ["class-enrolments-self"] });
      queryClient.invalidateQueries({ queryKey: ["class-enrolment-counts"] });
      toast({ title: "Withdrawn from class" });
    },
  });

  const getChildEnrolment = (childId: string, teamId: string) =>
    childEnrolments.find((e) => e.child_id === childId && e.team_id === teamId && e.status !== "withdrawn");

  const getSelfEnrolment = (teamId: string) =>
    selfEnrolments.find((e) => (e as any).user_id === user?.id && e.team_id === teamId && e.status !== "withdrawn");

  const [selectedChildId, setSelectedChildId] = useState<string>("");
  const [dayFilter, setDayFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<Date>(new Date());
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());

  // Map day names to JS day indices (0=Sun, 1=Mon, ..., 6=Sat)
  const dayNameToIndex: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
  };

  // Days in the current calendar month that have classes (within term dates)
  const classDaysInMonth = useMemo(() => {
    if (!activeTerm || classes.length === 0) return new Set<string>();
    const termStart = parseISO(activeTerm.start_date);
    const termEnd = parseISO(activeTerm.end_date);
    const monthStart = startOfMonth(calendarMonth);
    const monthEnd = endOfMonth(calendarMonth);
    const rangeStart = termStart > monthStart ? termStart : monthStart;
    const rangeEnd = termEnd < monthEnd ? termEnd : monthEnd;
    if (rangeStart > rangeEnd) return new Set<string>();

    const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
    const classDayIndices = new Set(classes.map(c => c.class_day ? dayNameToIndex[c.class_day] : -1));
    const result = new Set<string>();
    days.forEach(d => {
      if (classDayIndices.has(getDay(d))) {
        result.add(format(d, "yyyy-MM-dd"));
      }
    });
    return result;
  }, [calendarMonth, activeTerm, classes]);

  // Classes for the selected date
  const selectedDayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][selectedCalendarDate.getDay()];
  const classesForSelectedDate = useMemo(() => {
    if (!activeTerm) return [];
    const dateStr = format(selectedCalendarDate, "yyyy-MM-dd");
    if (!classDaysInMonth.has(dateStr)) return [];
    return classes.filter(c => c.class_day === selectedDayName);
  }, [selectedCalendarDate, classDaysInMonth, classes, selectedDayName]);

  const isLoading = termsLoading || classesLoading;

  // Helper: does this class allow child enrolment?
  const allowsChildren = (teamType: TeamType) => teamType === "junior" || teamType === "mixed";
  // Helper: does this class allow adult self-enrolment?
  const allowsAdults = (teamType: TeamType) => teamType === "senior" || teamType === "mixed";

  if (isLoading) {
    return (
      <div className="py-6 space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="pb-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">Class Enrolment</h1>
          {club && <p className="text-sm text-muted-foreground">{club.name}</p>}
        </div>
      </div>

      {/* Alert: no children for junior/mixed classes */}
      {hasChildClasses && children.length === 0 && !hasAdultClasses && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            You need to{" "}
            <Button variant="link" className="h-auto p-0" onClick={() => navigate("/children")}>
              add a child profile
            </Button>{" "}
            before enrolling in classes.
          </AlertDescription>
        </Alert>
      )}

      {terms.length === 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>No active terms available for enrolment.</AlertDescription>
        </Alert>
      )}

      {/* Term Selector */}
      {terms.length > 0 && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Select Term</label>
          <MobileSelect
            value={selectedTermId || terms[0]?.id || ""}
            onValueChange={setSelectedTermId}
            options={terms.map((term) => ({
              value: term.id,
              label: term.name + (term.start_date && term.end_date ? ` (${format(new Date(term.start_date), "d MMM")} – ${format(new Date(term.end_date), "d MMM yyyy")})` : ""),
            }))}
            placeholder="Select a term"
            title="Select Term"
          />
        </div>
      )}

      {/* Child Selector - only shown if there are junior/mixed classes and user has children */}
      {hasChildClasses && children.length === 1 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border">
          <span className="text-sm text-muted-foreground">Enrolling for:</span>
          <span className="text-sm font-medium">{children[0].name}</span>
        </div>
      )}
      {hasChildClasses && children.length > 1 && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Select Child</label>
          <MobileSelect
            value={selectedChildId || children[0]?.id || ""}
            onValueChange={setSelectedChildId}
            options={children.map((child) => ({ value: child.id, label: child.name }))}
            placeholder="Select a child"
            title="Select Child"
          />
        </div>
      )}

      {/* View Mode Toggle */}
      {classes.length > 0 && (
        <div className="flex rounded-lg bg-muted p-1 gap-1">
          <button
            onClick={() => setViewMode("list")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
              viewMode === "list"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <List className="h-4 w-4" />
            List
          </button>
          <button
            onClick={() => setViewMode("calendar")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
              viewMode === "calendar"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <CalendarDays className="h-4 w-4" />
            Calendar
          </button>
        </div>
      )}

      {/* Classes List */}
      {classes.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <CalendarDays className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No classes have been set up yet.</p>
          </CardContent>
        </Card>
      ) : viewMode === "calendar" ? (
        /* Monthly Calendar View */
        <div className="space-y-4">
          <Card>
            <CardContent className="p-2">
              <Calendar
                mode="single"
                selected={selectedCalendarDate}
                onSelect={(date) => date && setSelectedCalendarDate(date)}
                month={calendarMonth}
                onMonthChange={setCalendarMonth}
                fromDate={activeTerm ? parseISO(activeTerm.start_date) : undefined}
                toDate={activeTerm ? parseISO(activeTerm.end_date) : undefined}
                modifiers={{
                  hasClass: (date) => classDaysInMonth.has(format(date, "yyyy-MM-dd")),
                }}
                modifiersClassNames={{
                  hasClass: "bg-primary/15 font-semibold text-primary",
                }}
              />
            </CardContent>
          </Card>

          {/* Classes for selected date */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">
              {format(selectedCalendarDate, "EEEE, d MMMM")}
              {classesForSelectedDate.length > 0 && (
                <span className="ml-1">({classesForSelectedDate.length} {classesForSelectedDate.length === 1 ? "class" : "classes"})</span>
              )}
            </h3>
            {classesForSelectedDate.length === 0 ? (
              <Card>
                <CardContent className="py-6 text-center">
                  <p className="text-sm text-muted-foreground">No classes on this day</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {classesForSelectedDate.map(cls => {
                  const count = enrolmentCounts[cls.id] || 0;
                  const isFull = cls.class_capacity ? count >= cls.class_capacity : false;
                  const teamType = cls.team_type || "mixed";
                  const canEnrolChild = allowsChildren(teamType);
                  const canEnrolSelf = allowsAdults(teamType);
                  const activeChild = selectedChildId || children[0]?.id;
                  const childExisting = canEnrolChild && activeChild ? getChildEnrolment(activeChild, cls.id) : null;
                  const selfExisting = canEnrolSelf ? getSelfEnrolment(cls.id) : null;
                  const isEnrolled = !!childExisting || !!selfExisting;

                  return (
                    <Card key={cls.id} className={`rounded-xl ${isEnrolled ? "border-primary/30 bg-primary/5" : ""}`}>
                      <CardContent className="py-2.5 px-3">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">{cls.name}</span>
                              {isEnrolled && <Badge variant="default" className="text-[10px] px-1.5 py-0 shrink-0">Enrolled</Badge>}
                              {!isEnrolled && isFull && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">Full</Badge>}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                              {cls.class_time && <span>{cls.class_time.slice(0, 5)}</span>}
                              {cls.class_duration_minutes && <span>{cls.class_duration_minutes} mins</span>}
                              {cls.level_age && <span>{cls.level_age}</span>}
                              <span className="flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {count}{cls.class_capacity ? `/${cls.class_capacity}` : ""}
                              </span>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Day filter chips - only show if classes span multiple days */}
          {(() => {
            const uniqueDays = [...new Set(classes.map(c => c.class_day).filter(Boolean))];
            if (uniqueDays.length > 1) {
              return (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  <Button
                    variant={dayFilter === "all" ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs shrink-0"
                    onClick={() => setDayFilter("all")}
                  >
                    All Days
                  </Button>
                  {uniqueDays.map(day => (
                    <Button
                      key={day}
                      variant={dayFilter === day ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs shrink-0"
                      onClick={() => setDayFilter(day!)}
                    >
                      {day}
                    </Button>
                  ))}
                </div>
              );
            }
            return null;
          })()}
          <h3 className="text-sm font-medium text-muted-foreground">Available Classes</h3>
          {classes.filter(cls => dayFilter === "all" || cls.class_day === dayFilter).map((cls) => {
            const teamType = cls.team_type || "mixed";
            const canEnrolChild = allowsChildren(teamType);
            const canEnrolSelf = allowsAdults(teamType);
            const activeChild = selectedChildId || children[0]?.id;
            const childExisting = canEnrolChild && activeChild ? getChildEnrolment(activeChild, cls.id) : null;
            const selfExisting = canEnrolSelf ? getSelfEnrolment(cls.id) : null;
            const count = enrolmentCounts[cls.id] || 0;
            const isFull = cls.class_capacity ? count >= cls.class_capacity : false;
            const isEnrolling = enrollingClassId === cls.id;

            return (
              <Card key={cls.id}>
                <CardContent className="py-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{cls.name}</p>
                        {teamType !== "mixed" && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {teamType === "junior" ? "Junior" : "Adult"}
                          </Badge>
                        )}
                      </div>
                      {cls.level_age && (
                        <p className="text-xs text-muted-foreground">{cls.level_age}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                        {cls.class_day && (
                          <span className="flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" />
                            {cls.class_day}
                          </span>
                        )}
                        {cls.class_time && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {cls.class_time.slice(0, 5)}
                          </span>
                        )}
                        {cls.class_duration_minutes && (
                          <span>{cls.class_duration_minutes} mins</span>
                        )}
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {count}{cls.class_capacity ? `/${cls.class_capacity}` : ""} enrolled
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Adult self-enrolment section */}
                  {canEnrolSelf && termId && (
                    <div className="flex items-center justify-between pt-1 border-t border-border/50">
                      <span className="text-sm text-muted-foreground">Your enrolment</span>
                      {selfExisting ? (
                        <div className="flex items-center gap-2">
                          <Badge variant={selfExisting.status === "enrolled" ? "default" : "secondary"}>
                            {selfExisting.status === "enrolled" ? "Enrolled" : `Waitlisted #${selfExisting.waitlist_position}`}
                          </Badge>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive h-7 text-xs"
                                disabled={withdrawMutation.isPending}
                              >
                                Withdraw
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Withdraw from class?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to withdraw from <strong>{cls.name}</strong>? You can re-enrol later if spots are available.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => withdrawMutation.mutate(selfExisting.id)}
                                >
                                  Withdraw
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      ) : (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant={isFull ? "outline" : "default"}
                              disabled={isEnrolling || enrolSelfMutation.isPending}
                            >
                              {isEnrolling ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <UserPlus className="h-4 w-4 mr-1" />
                                  {isFull ? "Join Waitlist" : "Enrol"}
                                </>
                              )}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{isFull ? "Join waitlist?" : "Confirm enrolment"}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {isFull
                                  ? <>The class <strong>{cls.name}</strong> is currently full. You will be added to the waitlist and notified when a spot becomes available.</>
                                  : <>Are you sure you want to enrol in <strong>{cls.name}</strong>?</>
                                }
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => {
                                  setEnrollingClassId(cls.id);
                                  enrolSelfMutation.mutate({ teamId: cls.id });
                                }}
                              >
                                {isFull ? "Join Waitlist" : "Enrol"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  )}

                  {/* Child enrolment section */}
                  {canEnrolChild && activeChild && termId && (
                    <div className="flex items-center justify-between pt-1 border-t border-border/50">
                      <span className="text-sm text-muted-foreground">
                        {children.find((c) => c.id === activeChild)?.name || "Child"}
                      </span>
                      {childExisting ? (
                        <div className="flex items-center gap-2">
                          <Badge variant={childExisting.status === "enrolled" ? "default" : "secondary"}>
                            {childExisting.status === "enrolled" ? "Enrolled" : `Waitlisted #${childExisting.waitlist_position}`}
                          </Badge>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive h-7 text-xs"
                                disabled={withdrawMutation.isPending}
                              >
                                Withdraw
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Withdraw from class?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to withdraw {children.find((c) => c.id === activeChild)?.name || "your child"} from <strong>{cls.name}</strong>? You can re-enrol later if spots are available.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => withdrawMutation.mutate(childExisting.id)}
                                >
                                  Withdraw
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      ) : (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant={isFull ? "outline" : "default"}
                              disabled={isEnrolling || enrolChildMutation.isPending}
                            >
                              {isEnrolling ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <UserPlus className="h-4 w-4 mr-1" />
                                  {isFull ? "Join Waitlist" : "Enrol"}
                                </>
                              )}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{isFull ? "Join waitlist?" : "Confirm enrolment"}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {isFull
                                  ? <>The class <strong>{cls.name}</strong> is currently full. {children.find((c) => c.id === activeChild)?.name || "Your child"} will be added to the waitlist.</>
                                  : <>Are you sure you want to enrol {children.find((c) => c.id === activeChild)?.name || "your child"} in <strong>{cls.name}</strong>?</>
                                }
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => {
                                  setEnrollingClassId(cls.id);
                                  enrolChildMutation.mutate({ childId: activeChild, teamId: cls.id });
                                }}
                              >
                                {isFull ? "Join Waitlist" : "Enrol"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  )}

                  {/* Show hint if no children added but class supports children */}
                  {canEnrolChild && !canEnrolSelf && children.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">
                      <Button variant="link" className="h-auto p-0 text-xs" onClick={() => navigate("/children")}>
                        Add a child profile
                      </Button>{" "}
                      to enrol.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
