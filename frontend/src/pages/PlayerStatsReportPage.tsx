import { readReportEvents } from "@/features/competitions/history/reportRepository";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Calendar, FileText, Users, Loader2, Check, Lock } from "lucide-react";
import { format, startOfMonth, endOfMonth, startOfYear, subMonths } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { listLiveTeams } from "@/live/features/club";
import { listLiveEvents } from "@/live/features/events";
import { resolveLiveProFootballAccess } from "@/live/features/proAccess";

// Player-stats reporting is backed canister-side by events_domain's
// get_player_stats_report; team/game listing and the Pro Football gate
// below dispatch through withFeatureBackend instead of disabling ICP
// sessions outright.
import PlayerStatsReportView from "@/components/reports/PlayerStatsReportView";

interface Team {
  id: string;
  name: string;
  logo_url: string | null;
  club_id: string | null;
  clubs: {
    name: string;
    logo_url: string | null;
  } | null;
}

interface GameEvent {
  id: string;
  title: string;
  event_date: string;
  opponent: string | null;
}

export default SupabasePlayerStatsReportPage;

function SupabasePlayerStatsReportPage() {
  const { user } = useAuth();
  const { activeClubFilter } = useClubTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const lockedTeamId = searchParams.get("teamId") || "";
  const isLockedToTeam = !!lockedTeamId;
  const [selectedTeamId, setSelectedTeamId] = useState<string>(lockedTeamId || "");
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  // Default to the whole current season (calendar year to date) so every
  // game shows up — a month-only default hid most fixtures.
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: startOfYear(new Date()),
    to: endOfMonth(new Date()),
  });
  const [reportType, setReportType] = useState<"game" | "dateRange">("game");
  const [fromCalendarOpen, setFromCalendarOpen] = useState(false);
  const [toCalendarOpen, setToCalendarOpen] = useState(false);







  // Fetch teams the user can report on, strictly scoped to the active club filter.
  const { data: teams, isLoading: teamsLoading } = useQuery({
    queryKey: ["admin-coach-teams", user?.id, activeClubFilter],
    queryFn: () => withFeatureBackend("events", {
      icp: async (ctx) => {
        // ICP club membership is pinned to a single active club; canister
        // role-gating happens server-side on the report query itself, so
        // every team in the active club is listed here.
        if (!activeClubFilter) return [] as Team[];
        const rows = await listLiveTeams(ctx, activeClubFilter);
        const allTeams: Team[] = (rows ?? []).map((t: any) => ({
          id: t.id,
          name: t.name,
          logo_url: t.logo_url ?? null,
          club_id: t.club_id,
          clubs: null,
        }));
        allTeams.sort((a, b) => a.name.localeCompare(b.name));
        return lockedTeamId ? allTeams.filter((t) => t.id === lockedTeamId) : allTeams;
      },
      supabase: () => fetchSupabaseTeams(),
    }, { clubId: activeClubFilter ?? "" }),
    enabled: !!user,
  });

  async function fetchSupabaseTeams(): Promise<Team[]> {
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("team_id, club_id, role")
        .eq("user_id", user!.id)
        .in("role", ["team_admin", "coach", "club_admin", "committee_member"]);

      if (rolesError) throw rolesError;

      // Team-level roles
      const teamIds = new Set<string>();
      // Club-level admin roles grant reporting on every team in that club
      const adminClubIds = new Set<string>();

      for (const r of roles ?? []) {
        if (activeClubFilter && r.club_id && r.club_id !== activeClubFilter) continue;
        if (r.team_id && (r.role === "team_admin" || r.role === "coach")) {
          teamIds.add(r.team_id);
        }
        if (r.club_id && (r.role === "club_admin" || r.role === "committee_member")) {
          adminClubIds.add(r.club_id);
        }
      }

      const results = new Map<string, Team>();

      const addRows = (rows: Team[] | null) => {
        for (const t of rows ?? []) {
          // Fail-closed club boundary: never surface a team from another club.
          if (activeClubFilter && t.club_id !== activeClubFilter) continue;
          results.set(t.id, t);
        }
      };

      const select = "id, name, logo_url, club_id, clubs!club_id(name, logo_url)";

      if (teamIds.size > 0) {
        const { data, error } = await supabase
          .from("teams")
          .select(select)
          .in("id", Array.from(teamIds))
          .is("deleted_at", null);
        if (error) throw error;
        addRows(data as unknown as Team[]);
      }

      if (adminClubIds.size > 0) {
        const { data, error } = await supabase
          .from("teams")
          .select(select)
          .in("club_id", Array.from(adminClubIds))
          .is("deleted_at", null);
        if (error) throw error;
        addRows(data as unknown as Team[]);
      }

      const allTeams = Array.from(results.values()).sort((a, b) => a.name.localeCompare(b.name));
      // When accessed from a team page, restrict reporting to that team only.
      if (lockedTeamId) {
        return allTeams.filter((t) => t.id === lockedTeamId);
      }
      return allTeams;
  }

  // If the active club changes, drop a selection that no longer belongs to it.
  useEffect(() => {
    if (!selectedTeamId || !teams) return;
    if (!teams.some((t) => t.id === selectedTeamId)) {
      setSelectedTeamId("");
      setSelectedEventId("");
    }
  }, [teams, selectedTeamId]);


  // Fetch game events for selected team that have stats
  const { data: gameEvents, isLoading: eventsLoading } = useQuery({
    queryKey: ["team-game-events", selectedTeamId],
    queryFn: () => withFeatureBackend("events", {
      icp: async (ctx) => {
        // The canister has no per-event "has stats" index — get_player_stats_report
        // aggregates across a date range instead — so every game-type event for the
        // team is listed here; selecting one scopes PlayerStatsReportView's query.
        const rows = await listLiveEvents(ctx, null, selectedTeamId);
        const games = (rows ?? [])
          .filter((e: any) => e.event_type === "game")
          .map((e: any) => ({
            id: e.id,
            title: e.title,
            event_date: new Date(Number(e.starts_at_ms)).toISOString(),
            opponent: e.opponent?.[0] ?? null,
          }))
          .sort((a, b) => (a.event_date < b.event_date ? 1 : -1));
        return games as GameEvent[];
      },
      supabase: () => fetchSupabaseGameEvents(),
    }, { teamId: selectedTeamId ?? "" }),
    enabled: !!selectedTeamId,
  });

  async function fetchSupabaseGameEvents(): Promise<GameEvent[]> {
    if (!selectedTeamId) return [];
    return readReportEvents(selectedTeamId);
  }

  // Check if user has Pro Football access via team or club subscription
  const { data: hasProFootball, isLoading: proFootballLoading } = useQuery({
    queryKey: ["pro-football-access", user?.id, activeClubFilter, teams?.map((t) => t.id).join(",")],
    queryFn: () => withFeatureBackend("events", {
      icp: async (ctx) => {
        if (activeClubFilter && (await resolveLiveProFootballAccess(ctx, { clubId: activeClubFilter }))) return true;
        for (const team of teams ?? []) {
          if (await resolveLiveProFootballAccess(ctx, { teamId: team.id })) return true;
        }
        return false;
      },
      supabase: () => fetchSupabaseProFootballAccess(),
    }, activeClubFilter ? { clubId: activeClubFilter } : { everyGroup: true, merge: (parts: boolean[]) => parts.some(Boolean) }),
    enabled: !!user && !!teams,
  });

  async function fetchSupabaseProFootballAccess(): Promise<boolean> {
    // Check team subscriptions
    // Get user's team and club memberships first
    const { data: userTeamRoles } = await supabase
      .from("user_roles")
      .select("team_id")
      .eq("user_id", user!.id)
      .not("team_id", "is", null);

    const { data: userClubRoles } = await supabase
      .from("user_roles")
      .select("club_id")
      .eq("user_id", user!.id)
      .not("club_id", "is", null);

    const userTeamIds = userTeamRoles?.map((r) => r.team_id) || [];
    const userClubIds = userClubRoles?.map((r) => r.club_id) || [];

    // Check team subscriptions
    if (userTeamIds.length > 0) {
      const { data: teamSubs } = await supabase
        .from("team_subscriptions")
        .select("team_id, is_pro_football, admin_pro_football_override")
        .in("team_id", userTeamIds);

      if (teamSubs?.some((s) => s.is_pro_football || s.admin_pro_football_override)) return true;
    }

    // Check club subscriptions
    if (userClubIds.length > 0) {
      const { data: clubSubs } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro_football, admin_pro_football_override")
        .in("club_id", userClubIds);

      if (clubSubs?.some((s) => s.is_pro_football || s.admin_pro_football_override)) return true;
    }

    return false;
  }

  // Select first team by default, or preselect the team passed via URL query param
  if (teams && teams.length > 0 && (!selectedTeamId || !teams.some((t) => t.id === selectedTeamId))) {
    const urlTeamId = searchParams.get("teamId");
    const preselected = urlTeamId && teams.some((t) => t.id === urlTeamId) ? urlTeamId : teams[0].id;
    setSelectedTeamId(preselected);
  }

  const selectedTeam = teams?.find((t) => t.id === selectedTeamId);
  const selectedEvent = gameEvents?.find((e) => e.id === selectedEventId);

  if (teamsLoading || proFootballLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!teams || teams.length === 0) {
    return (
      <div className="py-6 space-y-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/profile")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>You need to be a team admin or coach to access player reports.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check for Pro Football subscription
  if (!hasProFootball) {
    return (
      <div className="py-6 space-y-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/profile")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Card>
          <CardContent className="py-8 text-center space-y-4">
            <Lock className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Pro Football Feature</h2>
              <p className="text-sm text-muted-foreground">
                Player Stats Reports are available with a Pro Football subscription.
              </p>
            </div>
            <Button onClick={() => navigate("/profile")} variant="outline">
              View Subscription Options
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/profile")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <FileText className="h-5 w-5 sm:h-6 sm:w-6" />
            Player Stats Reports
          </h1>
          <p className="text-sm text-muted-foreground">
            Download reports showing player minutes and positions
          </p>
        </div>
      </div>




      {/* Team Selection - Card-based for mobile; hidden when locked to a team from the team page */}
      {!isLockedToTeam && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Team</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {teams.length === 1 ? (
              <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                <div className="flex-1">
                  <p className="font-medium">{teams[0].name}</p>
                  {teams[0].clubs?.name && (
                    <p className="text-xs text-muted-foreground">{teams[0].clubs.name}</p>
                  )}
                </div>
                <Check className="h-4 w-4 text-primary" />
              </div>
            ) : (
              <ScrollArea className="max-h-[200px]">
                <div className="space-y-2">
                  {teams.map((team) => (
                    <button
                      key={team.id}
                      onClick={() => {
                        setSelectedTeamId(team.id);
                        setSelectedEventId("");
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors",
                        selectedTeamId === team.id
                          ? "bg-primary/10 border border-primary/30"
                          : "bg-muted hover:bg-muted/80"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{team.name}</p>
                        {team.clubs?.name && (
                          <p className="text-xs text-muted-foreground truncate">{team.clubs.name}</p>
                        )}
                      </div>
                      {selectedTeamId === team.id && (
                        <Check className="h-4 w-4 text-primary shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}

      {selectedTeamId && (
        <Tabs value={reportType} onValueChange={(v) => setReportType(v as "game" | "dateRange")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="game" className="text-sm">By Game</TabsTrigger>
            <TabsTrigger value="dateRange" className="text-sm">By Date Range</TabsTrigger>
          </TabsList>

          <TabsContent value="game" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Game</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {eventsLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : gameEvents && gameEvents.length > 0 ? (
                  <ScrollArea className="max-h-[250px]">
                    <div className="space-y-2">
                      {gameEvents.map((event) => (
                        <button
                          key={event.id}
                          onClick={() => setSelectedEventId(event.id)}
                          className={cn(
                            "w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors",
                            selectedEventId === event.id
                              ? "bg-primary/10 border border-primary/30"
                              : "bg-muted hover:bg-muted/80"
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">
                              {event.opponent ? `vs ${event.opponent}` : event.title}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(event.event_date), "EEE, MMM d, yyyy")}
                            </p>
                          </div>
                          {selectedEventId === event.id && (
                            <Check className="h-4 w-4 text-primary shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No games with recorded stats found for this team.
                  </p>
                )}
              </CardContent>
            </Card>

            {selectedEventId && selectedTeam && (
              <PlayerStatsReportView
                teamId={selectedTeamId}
                teamName={selectedTeam.name}
                teamLogoUrl={selectedTeam.logo_url}
                clubName={selectedTeam.clubs?.name}
                clubLogoUrl={selectedTeam.clubs?.logo_url}
                eventId={selectedEventId}
                event={selectedEvent}
              />
            )}
          </TabsContent>

          <TabsContent value="dateRange" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Date Range</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                {/* Quick presets — season is the default so no game is hidden */}
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "This season", from: startOfYear(new Date()), to: endOfMonth(new Date()) },
                    { label: "Last 3 months", from: startOfMonth(subMonths(new Date(), 2)), to: endOfMonth(new Date()) },
                    { label: "This month", from: startOfMonth(new Date()), to: endOfMonth(new Date()) },
                  ].map((preset) => {
                    const active =
                      format(dateRange.from, "yyyy-MM-dd") === format(preset.from, "yyyy-MM-dd") &&
                      format(dateRange.to, "yyyy-MM-dd") === format(preset.to, "yyyy-MM-dd");
                    return (
                      <Button
                        key={preset.label}
                        type="button"
                        size="sm"
                        variant={active ? "default" : "outline"}
                        onClick={() => setDateRange({ from: preset.from, to: preset.to })}
                      >
                        {preset.label}
                      </Button>
                    );
                  })}
                </div>
                <div className="flex flex-col gap-3">
                  {/* From Date */}
                  {isMobile ? (
                    <>
                      <button
                        onClick={() => setFromCalendarOpen(true)}
                        className={cn(
                          "w-full flex items-center gap-3 p-4 rounded-lg text-left transition-colors",
                          "bg-muted hover:bg-muted/80"
                        )}
                      >
                        <div className="flex items-center justify-center h-10 w-10 rounded-full bg-primary/10">
                          <Calendar className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-muted-foreground">From</p>
                          <p className="font-medium">{format(dateRange.from, "EEE, MMM d, yyyy")}</p>
                        </div>
                      </button>
                      <Drawer open={fromCalendarOpen} onOpenChange={setFromCalendarOpen}>
                        <DrawerContent>
                          <DrawerHeader>
                            <DrawerTitle>Select Start Date</DrawerTitle>
                          </DrawerHeader>
                          <div className="flex justify-center pb-8 px-4">
                            <CalendarComponent
                              mode="single"
                              selected={dateRange.from}
                              onSelect={(date) => {
                                if (date) {
                                  setDateRange((prev) => ({ ...prev, from: date }));
                                  setFromCalendarOpen(false);
                                }
                              }}
                              className="p-4 pointer-events-auto w-full max-w-sm [&_.rdp-months]:w-full [&_.rdp-month]:w-full [&_.rdp-table]:w-full [&_.rdp-head_cell]:text-base [&_.rdp-head_cell]:py-2 [&_.rdp-cell]:text-lg [&_.rdp-day]:h-12 [&_.rdp-day]:w-full [&_.rdp-button]:h-12 [&_.rdp-button]:w-full [&_.rdp-button]:text-lg [&_.rdp-nav_button]:h-10 [&_.rdp-nav_button]:w-10 [&_.rdp-caption_label]:text-lg"
                            />
                          </div>
                        </DrawerContent>
                      </Drawer>
                    </>
                  ) : (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className={cn(
                            "w-full flex items-center gap-3 p-4 rounded-lg text-left transition-colors",
                            "bg-muted hover:bg-muted/80"
                          )}
                        >
                          <div className="flex items-center justify-center h-10 w-10 rounded-full bg-primary/10">
                            <Calendar className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-muted-foreground">From</p>
                            <p className="font-medium">{format(dateRange.from, "EEE, MMM d, yyyy")}</p>
                          </div>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 z-50 bg-popover" align="center" side="bottom" sideOffset={8}>
                        <CalendarComponent
                          mode="single"
                          selected={dateRange.from}
                          onSelect={(date) => date && setDateRange((prev) => ({ ...prev, from: date }))}
                          initialFocus
                          className="p-3 pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                  )}
                  
                  {/* To Date */}
                  {isMobile ? (
                    <>
                      <button
                        onClick={() => setToCalendarOpen(true)}
                        className={cn(
                          "w-full flex items-center gap-3 p-4 rounded-lg text-left transition-colors",
                          "bg-muted hover:bg-muted/80"
                        )}
                      >
                        <div className="flex items-center justify-center h-10 w-10 rounded-full bg-primary/10">
                          <Calendar className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-muted-foreground">To</p>
                          <p className="font-medium">{format(dateRange.to, "EEE, MMM d, yyyy")}</p>
                        </div>
                      </button>
                      <Drawer open={toCalendarOpen} onOpenChange={setToCalendarOpen}>
                        <DrawerContent>
                          <DrawerHeader>
                            <DrawerTitle>Select End Date</DrawerTitle>
                          </DrawerHeader>
                          <div className="flex justify-center pb-8 px-4">
                            <CalendarComponent
                              mode="single"
                              selected={dateRange.to}
                              onSelect={(date) => {
                                if (date) {
                                  setDateRange((prev) => ({ ...prev, to: date }));
                                  setToCalendarOpen(false);
                                }
                              }}
                              className="p-4 pointer-events-auto w-full max-w-sm [&_.rdp-months]:w-full [&_.rdp-month]:w-full [&_.rdp-table]:w-full [&_.rdp-head_cell]:text-base [&_.rdp-head_cell]:py-2 [&_.rdp-cell]:text-lg [&_.rdp-day]:h-12 [&_.rdp-day]:w-full [&_.rdp-button]:h-12 [&_.rdp-button]:w-full [&_.rdp-button]:text-lg [&_.rdp-nav_button]:h-10 [&_.rdp-nav_button]:w-10 [&_.rdp-caption_label]:text-lg"
                            />
                          </div>
                        </DrawerContent>
                      </Drawer>
                    </>
                  ) : (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className={cn(
                            "w-full flex items-center gap-3 p-4 rounded-lg text-left transition-colors",
                            "bg-muted hover:bg-muted/80"
                          )}
                        >
                          <div className="flex items-center justify-center h-10 w-10 rounded-full bg-primary/10">
                            <Calendar className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-muted-foreground">To</p>
                            <p className="font-medium">{format(dateRange.to, "EEE, MMM d, yyyy")}</p>
                          </div>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 z-50 bg-popover" align="center" side="bottom" sideOffset={8}>
                        <CalendarComponent
                          mode="single"
                          selected={dateRange.to}
                          onSelect={(date) => date && setDateRange((prev) => ({ ...prev, to: date }))}
                          initialFocus
                          className="p-3 pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </CardContent>
            </Card>

            {selectedTeam && (
              <PlayerStatsReportView
                teamId={selectedTeamId}
                teamName={selectedTeam.name}
                teamLogoUrl={selectedTeam.logo_url}
                clubName={selectedTeam.clubs?.name}
                clubLogoUrl={selectedTeam.clubs?.logo_url}
                dateRange={dateRange}
              />
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
