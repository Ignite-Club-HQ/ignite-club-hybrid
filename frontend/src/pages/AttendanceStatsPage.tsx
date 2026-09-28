import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Calendar, Users, BarChart3, Download, Filter, Check, X, HelpCircle, Lock, Crown } from "lucide-react";
import { format, subMonths, startOfMonth, endOfMonth, parseISO, isPast } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabAttendanceStats } from "@/lab/fixtureDataLayer";
import { exportLocalEventsState, isLocalEventsCanisterUnavailable } from "@/lab/localEventsService";

type EventType = "game" | "training" | "all";

interface PlayerStats {
  userId: string;
  childId: string | null;
  displayName: string;
  avatarUrl: string | null;
  isChild: boolean;
  parentName: string | null;
  totalEvents: number;
  going: number;
  maybe: number;
  notGoing: number;
  noResponse: number;
  attendanceRate: number;
}

interface AttendanceStatsPageProps {
  teamIdOverride?: string;
  embedded?: boolean; // when true, hide header/back button (parent renders it)
}

export default function AttendanceStatsPage({ teamIdOverride, embedded }: AttendanceStatsPageProps = {}) {
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return <IcpLabAttendanceStatsPage teamId={teamIdOverride ?? "team-icp-001"} embedded={embedded} navigate={navigate} />;
  }

  return <SupabaseAttendanceStatsPage teamIdOverride={teamIdOverride} embedded={embedded} />;
}

function IcpLabAttendanceStatsPage({
  teamId,
  embedded,
  navigate,
}: {
  teamId: string;
  embedded?: boolean;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { user } = useAuth();
  const persona = user?.id?.startsWith("icp-") ? user.id.slice(4) : "member";
  const { data, error, isLoading } = useQuery({
    queryKey: ["icp-attendance-stats", teamId, persona],
    queryFn: async () => {
      try {
        const state = await exportLocalEventsState(persona);
        const eventIds = new Set(state.events.filter((event) => event.team_id[0] === teamId).map((event) => event.id));
        const attendance = state.attendance.filter((item) => eventIds.has(item.event_id));
        const byAccount = new Map<string, { attended: number; missed: number }>();
        for (const item of attendance) {
          const current = byAccount.get(item.account_id) ?? { attended: 0, missed: 0 };
          if (item.present) current.attended += 1;
          else current.missed += 1;
          byAccount.set(item.account_id, current);
        }
        return {
          source: "icp" as const,
          rows: [...byAccount.entries()].map(([userId, counts]) => ({
            user_id: userId,
            display_name: userId,
            ...counts,
            rate: counts.attended + counts.missed ? counts.attended / (counts.attended + counts.missed) : 0,
          })),
        };
      } catch (error) {
        if (!isLocalEventsCanisterUnavailable(error)) throw error;
        const stats = getLocalLabAttendanceStats(teamId);
        return { source: "fixture" as const, rows: stats.rows };
      }
    },
  });

  const rows = data?.rows ?? [];
  return (
      <div className={embedded ? "py-4" : "container max-w-3xl mx-auto px-4 py-6"}>
        {!embedded && <h1 className="text-lg font-bold mb-4">Attendance</h1>}
        <p className="text-sm text-muted-foreground mb-3">
          {data?.source === "icp"
            ? "Loaded from the local events_domain canister. Exports and administrative mutations remain disabled."
            : "The local events_domain canister is not configured. Showing a synthetic read-only preview; no Supabase request was made."}
        </p>
        {isLoading && <Card><CardContent className="p-4">Loading attendance…</CardContent></Card>}
        {error && <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Unable to load attendance."}</p>}
        <div className="space-y-2">
          {rows.map((row) => (
            <Card key={row.user_id}>
              <CardContent className="p-4 flex items-center justify-between">
                <span className="text-sm font-medium">{row.display_name}</span>
                <span className="text-xs text-muted-foreground">{row.attended} attended / {row.missed} missed ({Math.round(row.rate * 100)}%)</span>
              </CardContent>
            </Card>
          ))}
        </div>
        {!embedded && (
          <Button variant="outline" className="mt-4" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Go back
          </Button>
        )}
      </div>
  );
}

function SupabaseAttendanceStatsPage({ teamIdOverride, embedded }: AttendanceStatsPageProps = {}) {
  const params = useParams<{ teamId: string }>();
  const teamId = teamIdOverride ?? params.teamId;
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Default to last 3 months
  const [startDate, setStartDate] = useState<Date>(startOfMonth(subMonths(new Date(), 3)));
  const [endDate, setEndDate] = useState<Date>(endOfMonth(new Date()));
  const [eventTypeFilter, setEventTypeFilter] = useState<EventType>("all");

  // Check if user is admin
  const { data: isAdmin, isLoading: loadingAdminCheck } = useQuery({
    queryKey: ["is-team-admin-attendance", user?.id, teamId],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role, team_id, club_id")
        .eq("user_id", user!.id);
      
      if (!data) return false;
      
      if (data.some(r => r.role === "app_admin")) return true;
      if (data.some(r => r.role === "team_admin" && r.team_id === teamId)) return true;
      if (data.some(r => r.role === "coach" && r.team_id === teamId)) return true;
      
      // Check if club admin for the team's club
      const { data: team } = await supabase
        .from("teams")
        .select("club_id")
        .eq("id", teamId!)
        .single();
      
      if (team && data.some(r => r.role === "club_admin" && r.club_id === team.club_id)) {
        return true;
      }
      
      return false;
    },
    enabled: !!user && !!teamId,
  });

  // Fetch team details
  const { data: team, isLoading: teamLoading, fetchStatus: teamFetchStatus } = useQuery({
    queryKey: ["team-attendance", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*, clubs!club_id (id, name)")
        .eq("id", teamId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!teamId,
  });

  // Check Pro access - same logic as TeamDetailPage
  const { data: teamSubscription, isLoading: teamSubLoading } = useQuery({
    queryKey: ["team-subscription-attendance", teamId],
    queryFn: async () => {
      const { data } = await supabase
        .from("team_subscriptions")
        .select("*")
        .eq("team_id", teamId!)
        .maybeSingle();
      return data;
    },
    enabled: !!teamId,
  });

  const { data: clubSubscription, isLoading: clubSubLoading } = useQuery({
    queryKey: ["club-subscription-attendance", team?.club_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("club_subscriptions")
        .select("*")
        .eq("club_id", team!.club_id)
        .maybeSingle();
      return data;
    },
    enabled: !!team?.club_id,
  });

  // Pro Access Logic (matches TeamDetailPage):
  // 1. If club has Pro → ALL teams inherit Pro
  // 2. If club does NOT have Pro → check team's individual subscription
  const clubHasPro = clubSubscription?.is_pro || clubSubscription?.is_pro_football || 
                     (clubSubscription as any)?.admin_pro_override || (clubSubscription as any)?.admin_pro_football_override;
  
  const teamHasIndividualPro = teamSubscription?.is_pro || teamSubscription?.is_pro_football ||
                               (teamSubscription as any)?.admin_pro_override || (teamSubscription as any)?.admin_pro_football_override;
  
  const isTeamPro = clubHasPro || (!clubHasPro && teamHasIndividualPro);

  // Fetch team members (players and parents with children)
  const { data: teamMembers = [] } = useQuery({
    queryKey: ["team-members-attendance", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select(`
          user_id,
          role,
          profiles:user_id (id, display_name, avatar_url)
        `)
        .eq("team_id", teamId!)
        .in("role", ["player", "parent", "coach", "team_admin"]);
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!teamId,
  });

  // Fetch children assigned to this team (use RPC to bypass RLS limits on child_team_assignments)
  const { data: teamChildren = [] } = useQuery({
    queryKey: ["team-children-attendance", teamId],
    queryFn: async () => {
      const { data: rpcChildren, error: rpcError } = await supabase.rpc(
        "get_team_children_for_pitch_board",
        { p_team_id: teamId! }
      );
      if (rpcError) throw rpcError;
      const rows = rpcChildren || [];
      if (rows.length === 0) return [];

      const parentIds = Array.from(
        new Set<string>(
          rows.flatMap((r: any) => typeof r.parent_id === "string" ? [r.parent_id] : []),
        ),
      );
      let profileMap: Record<string, { id: string; display_name: string | null }> = {};
      if (parentIds.length > 0) {
        const { data: profiles } = await selectCachedProfilesByIds(parentIds);
        (profiles || []).forEach((p) => { profileMap[p.id] = p; });
      }

      return rows.map((r: any) => ({
        child_id: r.child_id,
        children: {
          id: r.child_id,
          name: r.child_name,
          parent_id: r.parent_id,
          profiles: r.parent_id ? profileMap[r.parent_id] || null : null,
        },
      }));
    },
    enabled: !!teamId,
  });

  // Fetch events for the team in date range
  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ["team-events-attendance", teamId, startDate, endDate, eventTypeFilter],
    queryFn: async () => {
      // Only game and training events count toward attendance stats
      const allowedTypes: ("game" | "training")[] = eventTypeFilter === "all"
        ? ["game", "training"]
        : [eventTypeFilter as "game" | "training"];

      const { data, error } = await supabase
        .from("events")
        .select("id, title, event_date, type, is_cancelled")
        .eq("team_id", teamId!)
        .eq("is_cancelled", false)
        .in("type", allowedTypes)
        .gte("event_date", startDate.toISOString())
        .lte("event_date", endDate.toISOString())
        .order("event_date", { ascending: true });

      if (error) throw error;

      // Only include past events for attendance
      return (data || []).filter(e => isPast(parseISO(e.event_date)));
    },
    enabled: !!teamId && !!startDate && !!endDate,
  });

  // Fetch RSVPs for all events
  const { data: rsvps = [], isLoading: rsvpsLoading } = useQuery({
    queryKey: ["team-rsvps-attendance", teamId, events.map(e => e.id)],
    queryFn: async () => {
      if (events.length === 0) return [];
      
      const { data, error } = await supabase
        .from("rsvps")
        .select("event_id, user_id, child_id, status")
        .in("event_id", events.map(e => e.id));
      
      if (error) throw error;
      return data || [];
    },
    enabled: events.length > 0,
  });

  // Calculate player stats
  const playerStats = useMemo((): PlayerStats[] => {
    const stats: Map<string, PlayerStats> = new Map();
    const totalEvents = events.length;

    // Add regular players
    teamMembers.forEach((member: any) => {
      if (member.role === "player") {
        const profile = member.profiles;
        const key = `user-${member.user_id}`;
        if (!stats.has(key)) {
          stats.set(key, {
            userId: member.user_id,
            childId: null,
            displayName: profile?.display_name || "Unknown",
            avatarUrl: profile?.avatar_url,
            isChild: false,
            parentName: null,
            totalEvents,
            going: 0,
            maybe: 0,
            notGoing: 0,
            noResponse: 0,
            attendanceRate: 0,
          });
        }
      }
    });

    // Add children
    teamChildren.forEach((assignment: any) => {
      const child = assignment.children;
      if (child) {
        const key = `child-${child.id}`;
        if (!stats.has(key)) {
          stats.set(key, {
            userId: child.parent_id,
            childId: child.id,
            displayName: child.name,
            avatarUrl: null,
            isChild: true,
            parentName: child.profiles?.display_name || null,
            totalEvents,
            going: 0,
            maybe: 0,
            notGoing: 0,
            noResponse: 0,
            attendanceRate: 0,
          });
        }
      }
    });

    // Count RSVPs
    rsvps.forEach((rsvp) => {
      let key: string;
      if (rsvp.child_id) {
        key = `child-${rsvp.child_id}`;
      } else {
        key = `user-${rsvp.user_id}`;
      }

      const stat = stats.get(key);
      if (stat) {
        switch (rsvp.status) {
          case "going":
            stat.going++;
            break;
          case "maybe":
            stat.maybe++;
            break;
          case "not_going":
            stat.notGoing++;
            break;
        }
      }
    });

    // Calculate no response and attendance rate
    stats.forEach((stat) => {
      stat.noResponse = stat.totalEvents - stat.going - stat.maybe - stat.notGoing;
      stat.attendanceRate = stat.totalEvents > 0 
        ? Math.round((stat.going / stat.totalEvents) * 100) 
        : 0;
    });

    // Sort by attendance rate (highest first)
    return Array.from(stats.values()).sort((a, b) => b.attendanceRate - a.attendanceRate);
  }, [teamMembers, teamChildren, events, rsvps]);

  // Calculate overall stats
  const overallStats = useMemo(() => {
    const total = playerStats.length * events.length;
    const totalGoing = playerStats.reduce((sum, p) => sum + p.going, 0);
    const totalMaybe = playerStats.reduce((sum, p) => sum + p.maybe, 0);
    const totalNotGoing = playerStats.reduce((sum, p) => sum + p.notGoing, 0);
    const totalNoResponse = playerStats.reduce((sum, p) => sum + p.noResponse, 0);
    
    return {
      totalEvents: events.length,
      totalPlayers: playerStats.length,
      averageAttendance: total > 0 ? Math.round((totalGoing / total) * 100) : 0,
      totalGoing,
      totalMaybe,
      totalNotGoing,
      totalNoResponse,
    };
  }, [playerStats, events]);

  const exportToCSV = () => {
    const headers = ["Name", "Type", "Parent", "Total Events", "Going", "Maybe", "Not Going", "No Response", "Attendance Rate"];
    const rows = playerStats.map(p => [
      p.displayName,
      p.isChild ? "Child" : "Player",
      p.parentName || "-",
      p.totalEvents,
      p.going,
      p.maybe,
      p.notGoing,
      p.noResponse,
      `${p.attendanceRate}%`,
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${team?.name || "team"}-${format(startDate, "yyyy-MM-dd")}-to-${format(endDate, "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast({ title: "Exported to CSV" });
  };

  if (teamLoading || loadingAdminCheck || teamSubLoading || clubSubLoading || (teamFetchStatus === "paused" && !team)) {
    return (
      <div className="py-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="py-6 text-center">
        <p className="text-muted-foreground">Team not found</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Attendance Stats</h1>
        </div>
        <Card className="border-destructive/20 bg-destructive/5 max-w-lg mx-auto">
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">
              Only team admins and coaches can view attendance statistics.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check Pro access
  if (!isTeamPro) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Attendance Stats</h1>
        </div>
        <Card className="max-w-lg mx-auto">
          <CardContent className="py-8 text-center space-y-4">
            <Lock className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Pro Feature</h2>
              <p className="text-sm text-muted-foreground">
                Attendance Stats are available with a Pro subscription.
              </p>
            </div>
            <Button onClick={() => navigate(`/teams/${teamId}/upgrade`)} className="gap-2">
              <Crown className="h-4 w-4" />
              Upgrade to Pro
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isLoading = eventsLoading || rsvpsLoading;

  return (
    <div className={embedded ? "space-y-6" : "py-6 space-y-6"}>
      {/* Header */}
      {!embedded && (
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Attendance Stats</h1>
            <p className="text-sm text-muted-foreground">{team.name}</p>
          </div>
          <BarChart3 className="h-8 w-8 text-primary" />
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Start Date */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Start Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal">
                    <Calendar className="mr-2 h-4 w-4" />
                    {format(startDate, "dd MMM yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={startDate}
                    onSelect={(date) => date && setStartDate(date)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* End Date */}
            <div className="space-y-2">
              <label className="text-sm font-medium">End Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal">
                    <Calendar className="mr-2 h-4 w-4" />
                    {format(endDate, "dd MMM yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={endDate}
                    onSelect={(date) => date && setEndDate(date)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Event Type */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Event Type</label>
              <Select value={eventTypeFilter} onValueChange={(v) => setEventTypeFilter(v as EventType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Games &amp; Training</SelectItem>
                  <SelectItem value="game">Games Only</SelectItem>
                  <SelectItem value="training">Training Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-primary">{overallStats.totalEvents}</p>
            <p className="text-sm text-muted-foreground">Sessions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-primary">{overallStats.totalPlayers}</p>
            <p className="text-sm text-muted-foreground">Players</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-500">{overallStats.averageAttendance}%</p>
            <p className="text-sm text-muted-foreground">Avg Attendance</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-500">{overallStats.totalNoResponse}</p>
            <p className="text-sm text-muted-foreground">No Response</p>
          </CardContent>
        </Card>
      </div>

      {/* Export Button */}
      <div className="flex justify-end">
        <Button variant="outline" onClick={exportToCSV} disabled={playerStats.length === 0}>
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Player Stats Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Player Attendance
          </CardTitle>
          <CardDescription>
            Attendance breakdown for each player in the selected date range
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : playerStats.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {events.length === 0 
                ? "No past events found in the selected date range" 
                : "No players found for this team"}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead className="text-center w-20">
                      <span className="flex items-center justify-center gap-1">
                        <Check className="h-4 w-4 text-emerald-500" />
                      </span>
                    </TableHead>
                    <TableHead className="text-center w-20">
                      <span className="flex items-center justify-center gap-1">
                        <HelpCircle className="h-4 w-4 text-amber-500" />
                      </span>
                    </TableHead>
                    <TableHead className="text-center w-20">
                      <span className="flex items-center justify-center gap-1">
                        <X className="h-4 w-4 text-destructive" />
                      </span>
                    </TableHead>
                    <TableHead className="w-32">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {playerStats.map((player) => (
                    <TableRow key={player.childId ? `child-${player.childId}` : `user-${player.userId}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={player.avatarUrl || undefined} />
                            <AvatarFallback className="bg-primary/20 text-primary text-sm">
                              {player.displayName.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-sm">{player.displayName}</p>
                            {player.isChild && player.parentName && (
                              <p className="text-xs text-muted-foreground">
                                Parent: {player.parentName}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-emerald-500 font-medium">{player.going}</span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-amber-500 font-medium">{player.maybe}</span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-destructive font-medium">{player.notGoing}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress 
                            value={player.attendanceRate} 
                            className="h-2 flex-1"
                          />
                          <span className="text-sm font-medium w-10 text-right">
                            {player.attendanceRate}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
