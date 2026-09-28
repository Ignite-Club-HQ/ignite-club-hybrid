import { useState, Suspense } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, isToday, parseISO, startOfDay, nextSaturday } from "date-fns";
import {
  ArrowLeft,
  Users,
  Plus,
  Loader2,
  ChevronRight,
  Clock,
  MapPin,
  Shirt,
  Settings,
  Trophy,
  UserPlus,
  CalendarDays,
  MessageSquare,
  Mail,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
const AddMiniLeagueMemberSheet = lazyWithRetry(() => import("@/components/AddMiniLeagueMemberSheet").then(m => ({ default: m.AddMiniLeagueMemberSheet })));
const ManagePlayersDialog = lazyWithRetry(() => import("@/components/mini-league/ManagePlayersDialog").then(m => ({ default: m.ManagePlayersDialog })));
const MiniLeagueSettingsDialog = lazyWithRetry(() => import("@/components/mini-league/MiniLeagueSettingsDialog").then(m => ({ default: m.MiniLeagueSettingsDialog })));
const ManageMiniLeagueAdminsSheet = lazyWithRetry(() => import("@/components/mini-league/ManageMiniLeagueAdminsSheet").then(m => ({ default: m.ManageMiniLeagueAdminsSheet })));
import PendingInvitesList from "@/components/PendingInvitesList";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabMiniLeagueDetail } from "@/lab/fixtureDataLayer";

interface MiniLeagueEvent {
  id: string;
  title: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location_name: string | null;
  is_cancelled: boolean;
  final_score_home: number | null;
  final_score_away: number | null;
  _allocatedPlayers?: number;
}

export default function MiniLeagueDetailPage() {
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  if (useIcpLab) {
    return <IcpLabMiniLeagueDetailPage />;
  }
  return <SupabaseMiniLeagueDetailPage />;
}

/** Read-only synthetic mini-league detail; member management and scheduling remain unavailable until competition_domain admin tooling is wired here. */
function IcpLabMiniLeagueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const league = getLocalLabMiniLeagueDetail(id ?? "mini-league-icp-001") ?? getLocalLabMiniLeagueDetail("mini-league-icp-001");

  return (
    <div className="container max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">{league?.name ?? "Mini League"}</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Showing synthetic ICP lab mini-league data. Member management and scheduling are disabled.
      </p>
      <div className="space-y-2">
        {league?.standings.map((row) => (
          <Card key={row.team_id}>
            <CardContent className="p-4 flex items-center justify-between">
              <span className="text-sm font-medium">{row.team_name}</span>
              <span className="text-xs text-muted-foreground">{row.played} played · {row.points} pts</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SupabaseMiniLeagueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playersOpen, setPlayersOpen] = useState(false);
  const [addPlayersOpen, setAddPlayersOpen] = useState(false);
  const [manageAdminsOpen, setManageAdminsOpen] = useState(false);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);

  const { data: league, isLoading: leagueLoading } = useQuery({
    queryKey: ["mini-league", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_leagues")
        .select("*, club:clubs!club_id(id, name)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: leagueChatGroup } = useQuery({
    queryKey: ["mini-league-chat-group", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("chat_groups")
        .select("id")
        .eq("mini_league_id", id!)
        .maybeSingle();
      return data;
    },
    enabled: !!id,
  });

  // Check Pro Football subscription for the league's club
  const { data: hasProFootball, isLoading: proLoading } = useQuery({
    queryKey: ["club-pro-football", league?.club_id],
    queryFn: async () => {
      // Check if user is app_admin (bypasses subscription)
      const { data: appAdminRole } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      if (appAdminRole) return true;

      const { data } = await supabase
        .from("club_subscriptions")
        .select("is_pro_football, admin_pro_football_override, expires_at")
        .eq("club_id", league!.club_id)
        .maybeSingle();
      if (!data) return false;
      const expired = data.expires_at && new Date(data.expires_at) < new Date();
      return !expired && (data.is_pro_football || data.admin_pro_football_override);
    },
    enabled: !!league?.club_id && !!user,
    staleTime: 1000 * 60 * 5,
    placeholderData: (prev) => prev,
  });

  const { data: canManageLeague } = useQuery({
    queryKey: ["can-manage-league", id, league?.club_id, user?.id],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .or(`club_id.eq.${league!.club_id},role.eq.app_admin`);
      const clubWide = roles?.some(r =>
        ['club_admin', 'league_admin', 'coach', 'committee_member', 'app_admin'].includes(r.role)
      ) ?? false;
      if (clubWide) return true;

      // Per-mini-league grant
      const { data: scoped } = await supabase
        .from("mini_league_admins")
        .select("id")
        .eq("mini_league_id", id!)
        .eq("user_id", user!.id)
        .maybeSingle();
      return !!scoped;
    },
    enabled: !!league?.club_id && !!user && !!id,
  });

  const { data: isClubAdmin } = useQuery({
    queryKey: ["is-club-admin", league?.club_id, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .or(`club_id.eq.${league!.club_id},role.eq.app_admin`);
      return data?.some(r => ['club_admin', 'app_admin'].includes(r.role)) ?? false;
    },
    enabled: !!league?.club_id && !!user,
  });

  // Delete is restricted to club admins, league admins (club-wide or
  // scoped to this league via mini_league_admins) and app admins.
  // Mirrors the is_league_admin() RLS function on mini_leagues.
  const { data: canDeleteLeague } = useQuery({
    queryKey: ["can-delete-league", id, league?.club_id, user?.id],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .or(`club_id.eq.${league!.club_id},role.eq.app_admin`);
      const adminRole = roles?.some(r =>
        ['club_admin', 'league_admin', 'app_admin'].includes(r.role)
      ) ?? false;
      if (adminRole) return true;

      const { data: scoped } = await supabase
        .from("mini_league_admins")
        .select("id")
        .eq("mini_league_id", id!)
        .eq("user_id", user!.id)
        .maybeSingle();
      return !!scoped;
    },
    enabled: !!league?.club_id && !!user && !!id,
  });

  const { data: players } = useQuery({
    queryKey: ["mini-league-players", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_players")
        .select("*")
        .eq("mini_league_id", id!)
        .order("ability_rating", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: events, isLoading: eventsLoading } = useQuery({
    queryKey: ["mini-league-events", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, title, event_date, start_time, end_time, location_name, is_cancelled, final_score_home, final_score_away")
        .eq("mini_league_id", id!)
        .order("event_date", { ascending: false });
      if (error) throw error;

      const eventIds = (data || []).map(e => e.id);
      if (eventIds.length > 0) {
        const { data: groups } = await supabase
          .from("event_groups")
          .select("event_id, id")
          .in("event_id", eventIds);

        if (groups && groups.length > 0) {
          const groupIds = groups.map(g => g.id);
          const { data: groupPlayers } = await supabase
            .from("event_group_players")
            .select("group_id")
            .in("group_id", groupIds);

          const groupToEvent = new Map<string, string>();
          groups.forEach(g => groupToEvent.set(g.id, g.event_id));

          return (data || []).map(e => ({
            ...e,
            _allocatedPlayers: groupPlayers?.filter(gp => groupToEvent.get(gp.group_id) === e.id).length || 0,
          })) as MiniLeagueEvent[];
        }
      }

      return (data || []).map(e => ({ ...e, _allocatedPlayers: 0 })) as MiniLeagueEvent[];
    },
    enabled: !!id,
  });

  const { data: userPlayerIds } = useQuery({
    queryKey: ["mini-league-user-players", id, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("mini_league_players")
        .select("id, name")
        .eq("mini_league_id", id!)
        .eq("parent_user_id", user!.id);
      return data || [];
    },
    enabled: !!id && !!user && !canManageLeague,
  });

  // Fetch league members (parents from players + child guardians + admins)
  const parentUserIds = [...new Set((players || []).map(p => p.parent_user_id).filter(Boolean) as string[])];
  const childIdsForMembers = [...new Set((players || []).map(p => p.child_id).filter(Boolean) as string[])];
  
  const { data: leagueMembers } = useQuery({
    queryKey: ["mini-league-members", id, league?.club_id, parentUserIds, childIdsForMembers],
    queryFn: async () => {
      // Staff = club-wide league_admin holders + per-mini-league grants
      // (mini_league_admins). Team-level coaches are NOT included — there
      // is no `coach ↔ mini_league` link in the schema, so showing them
      // here would surface every club coach as a coach of this league.
      const [{ data: adminRoles }, { data: scopedAdmins }, { data: guardianRows }] = await Promise.all([
        supabase
          .from("user_roles")
          .select("user_id, role")
          .eq("club_id", league!.club_id)
          .eq("role", "league_admin"),
        supabase
          .from("mini_league_admins")
          .select("user_id")
          .eq("mini_league_id", id!),
        childIdsForMembers.length > 0
          ? supabase
            .from("child_guardians")
            .select("guardian_id")
            .in("child_id", childIdsForMembers)
          : Promise.resolve({ data: [] }),
      ]);

      const clubWideIds = new Set<string>(
        (adminRoles || []).flatMap((role) =>
          typeof role.user_id === "string" ? [role.user_id] : [],
        ),
      );
      const scopedIds = new Set<string>(
        (scopedAdmins || []).flatMap((admin) =>
          typeof admin.user_id === "string" ? [admin.user_id] : [],
        ),
      );
      const allAdminIds = new Set<string>([...clubWideIds, ...scopedIds]);
      const guardianUserIds = (guardianRows || []).map((r: any) => r.guardian_id).filter(Boolean) as string[];
      const allParentIds = [...new Set([...parentUserIds, ...guardianUserIds])];

      const allUserIds = [...new Set<string>([
        ...allParentIds,
        ...allAdminIds,
      ])];

      if (allUserIds.length === 0) return { parents: [], staff: [] };

      const { data: profiles } = await selectCachedProfilesByIds(allUserIds);

      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      const parents = allParentIds
        .filter(uid => !allAdminIds.has(uid))
        .map(uid => ({
          id: uid,
          ...profileMap.get(uid),
          role: "parent" as string,
        }));

      const parentIdSet = new Set(allParentIds);
      const staff = [...allAdminIds].map(uid => ({
        id: uid,
        ...profileMap.get(uid),
        role: "league_admin" as string,
        isAlsoParent: parentIdSet.has(uid),
      }));

      return { parents, staff };
    },
    enabled: !!league?.club_id && !!id,
  });

  // Pending email invites for this mini-league (parents added via player invites + league admins)
  const { data: pendingInvitesAll } = useQuery({
    queryKey: ["mini-league-pending-invites-inline", id, league?.club_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_invites")
        .select("id, role, invited_user_id, invited_label, invited_email, created_at, status, email_sent_at, email_id, email_error, last_reminder_sent_at, reminder_count, metadata")
        .eq("club_id", league!.club_id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).filter(
        (r: any) =>
          r.metadata && typeof r.metadata === "object" && !Array.isArray(r.metadata) &&
          r.metadata.mini_league_id === id &&
          r.metadata.kind !== "league_admin_join_link" &&
          r.metadata.kind !== "mini_league_parent_join_link",
      );
    },
    enabled: !!league?.club_id && !!id && !!canManageLeague,
  });

  const nonCancelledEvents = events?.filter(e => !e.is_cancelled) || [];
  const upcomingEvents = nonCancelledEvents.filter(e => new Date(e.event_date) >= startOfDay(new Date()));
  const pastEvents = nonCancelledEvents.filter(e => new Date(e.event_date) < startOfDay(new Date()));

  const getCreateUrl = () => {
    const roundNumber = (events?.length || 0) + 1;
    const nextSat = nextSaturday(new Date());
    const dateStr = format(nextSat, "yyyy-MM-dd'T'10:00");
    return `/events/new?type=mini_league&mini_league_id=${id}&club_id=${league?.club_id}&prefill_title=Round ${roundNumber}&prefill_date=${dateStr}`;
  };

  if (leagueLoading || proLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!league) {
    return (
      <div className="container max-w-4xl py-6 text-center">
        <p className="text-muted-foreground">Mini League not found</p>
        <Button variant="link" onClick={() => navigate("/mini-leagues")}>
          Back to Mini Leagues
        </Button>
      </div>
    );
  }

  if (hasProFootball === false) {
    return (
      <div className="container max-w-4xl py-6 text-center space-y-4">
        <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto">
          <Trophy className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold">Pro Football Required</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Mini Leagues require an active Pro Football subscription. Upgrade to access match days, player management, and more.
        </p>
        <div className="flex gap-2 justify-center">
          <Button variant="outline" onClick={() => navigate(-1)}>
            Go Back
          </Button>
          <Button onClick={() => navigate(`/upgrade?teamId=${league.club_id}`)}>
            Upgrade to Pro Football
          </Button>
        </div>
      </div>
    );
  }

  const acceptedPlayers = (players || []).filter(p => !!p.parent_user_id);
  const playerCount = acceptedPlayers.length;
  const displayPlayers = players?.slice(0, 12) || [];
  const remainingPlayers = (players?.length || 0) - displayPlayers.length;

  const renderMatchDayCard = (event: MiniLeagueEvent, compact = false) => {
    const hasScore = event.final_score_home != null && event.final_score_away != null;
    const isPast = new Date(event.event_date) < startOfDay(new Date());
    const isUpcoming = !isPast;

    return (
      <Card
        key={event.id}
        className="cursor-pointer hover:bg-accent/50 active:scale-[0.99] transition-all rounded-xl"
        onClick={() => navigate(`/events/${event.id}`)}
      >
        <CardContent className={compact ? "py-2.5 px-4" : "py-3.5 px-4"}>
          <div className="flex items-center gap-3">
            <div className={`${compact ? "h-9 w-9 rounded-lg" : "h-11 w-11 rounded-xl"} ${isUpcoming ? "bg-primary/10" : "bg-muted"} flex flex-col items-center justify-center shrink-0`}>
              <span className={`${compact ? "text-[9px]" : "text-[10px]"} font-semibold ${isUpcoming ? "text-primary" : "text-muted-foreground"} uppercase leading-none`}>
                {format(parseISO(event.event_date), "MMM")}
              </span>
              <span className={`${compact ? "text-sm" : "text-base"} font-bold ${isUpcoming ? "text-primary" : "text-muted-foreground"} leading-tight`}>
                {format(parseISO(event.event_date), "d")}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`${compact ? "text-sm" : "font-semibold text-sm"} truncate`}>
                  {event.title || format(parseISO(event.event_date), "EEEE")}
                </span>
                {isToday(parseISO(event.event_date)) && (
                  <Badge variant="default" className="text-[10px] px-1.5 py-0 shrink-0">Today</Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                {event.start_time && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {format(new Date(event.start_time), "h:mm a")}
                  </span>
                )}
                {!compact && event.location_name && (
                  <span className="flex items-center gap-1 truncate">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">{event.location_name}</span>
                  </span>
                )}
                {(event._allocatedPlayers || 0) > 0 && (
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {event._allocatedPlayers} players
                  </span>
                )}
              </div>
            </div>
            {hasScore && (
              <Badge variant="outline" className="font-mono text-xs shrink-0">
                {event.final_score_home} – {event.final_score_away}
              </Badge>
            )}
            <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
          </div>
        </CardContent>
      </Card>
    );
  };

  const hasEvents = (events?.length || 0) > 0;

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-6 py-4 space-y-5 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="shrink-0 h-10 w-10" onClick={() => navigate(league.club_id ? `/mini-leagues?clubId=${league.club_id}` : "/mini-leagues")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Avatar className="h-11 w-11 shrink-0">
          {league.logo_url ? <AvatarImage src={league.logo_url} alt={league.name} /> : null}
          <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
            {league.name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold leading-tight">{league.name}</h1>
          <p className="text-xs text-muted-foreground truncate">{league.club?.name}</p>
        </div>
        {canManageLeague && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-10 w-10"
            onClick={() => setSettingsOpen(true)}
            aria-label="Mini-league settings"
          >
            <Settings className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* Team Description */}
      {league.description && (
        <p className="text-sm text-muted-foreground leading-relaxed px-1">{league.description}</p>
      )}

      {/* Team Overview Stats */}
      <Card className="rounded-xl">
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-bold leading-tight">{playerCount}</p>
                <p className="text-[10px] text-muted-foreground">Players</p>
              </div>
            </div>
            <div className="w-px h-8 bg-border" />
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-accent/50 flex items-center justify-center">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-bold leading-tight">{upcomingEvents.length}</p>
                <p className="text-[10px] text-muted-foreground">Upcoming</p>
              </div>
            </div>
            <div className="w-px h-8 bg-border" />
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-accent/50 flex items-center justify-center">
                <Trophy className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-bold leading-tight">{events?.length || 0}</p>
                <p className="text-[10px] text-muted-foreground">Total</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* League Chat — primary action */}
      {leagueChatGroup?.id && (
        <button
          type="button"
          onClick={() => navigate(`/groups/${leagueChatGroup.id}`)}
          aria-label="Open mini-league chat"
          className="block w-full text-left"
        >
          <Card className="border-primary/20 bg-primary/[0.03] hover:border-primary/40 transition-colors rounded-xl">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <MessageSquare className="h-[18px] w-[18px] text-primary" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-tight">League Chat</p>
                <p className="text-xs text-muted-foreground truncate">Open the {league.name} chat</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </CardContent>
          </Card>
        </button>
      )}



      {/* Players Section */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Players</h2>
          {canManageLeague && playerCount > 0 && (
            <button
              onClick={() => setPlayersOpen(true)}
              className="text-xs text-primary font-medium hover:underline"
            >
              View all
            </button>
          )}
        </div>

        {playerCount === 0 ? (
          <Card className="rounded-xl">
            <CardContent className="py-5 text-center space-y-2">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mx-auto">
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">No players added yet</p>
              {canManageLeague && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAddPlayersOpen(true)}
                >
                  <UserPlus className="h-4 w-4 mr-1.5" />
                  Add Players
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-3 px-3 scrollbar-hide">
            {displayPlayers.map((player) => (
              <div
                key={player.id}
                className="flex flex-col items-center gap-1 min-w-[56px] max-w-[56px]"
              >
                <Avatar className="h-11 w-11 border-2 border-background shadow-sm">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                    {player.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-[10px] text-muted-foreground truncate w-full text-center leading-tight">
                  {player.name.split(' ')[0]}
                </span>
              </div>
            ))}
            {remainingPlayers > 0 && (
              <button
                onClick={() => setPlayersOpen(true)}
                className="flex flex-col items-center gap-1 min-w-[56px] max-w-[56px]"
              >
                <div className="h-11 w-11 rounded-full bg-muted flex items-center justify-center border-2 border-background shadow-sm">
                  <span className="text-xs font-semibold text-muted-foreground">+{remainingPlayers}</span>
                </div>
                <span className="text-[10px] text-muted-foreground leading-tight">more</span>
              </button>
            )}
            {canManageLeague && (
              <button
                onClick={() => setAddPlayersOpen(true)}
                className="flex flex-col items-center gap-1 min-w-[56px] max-w-[56px]"
              >
                <div className="h-11 w-11 rounded-full border-2 border-dashed border-primary/30 flex items-center justify-center hover:border-primary/60 transition-colors">
                  <Plus className="h-4 w-4 text-primary/60" />
                </div>
                <span className="text-[10px] text-primary/60 leading-tight">Add</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Members Section (Parents & Staff) — Team-page style */}
      {leagueMembers && (leagueMembers.staff.length > 0 || leagueMembers.parents.length > 0 || isClubAdmin) && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Team</h2>
            <span className="text-xs text-muted-foreground">
              {leagueMembers.staff.length + leagueMembers.parents.length} members
            </span>
          </div>

          {/* Staff (League Admins) */}
          {(leagueMembers.staff.length > 0 || isClubAdmin) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-sm font-medium text-muted-foreground">League Admins</p>
                {isClubAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-primary"
                    onClick={() => setManageAdminsOpen(true)}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Manage
                  </Button>
                )}
              </div>
              {leagueMembers.staff.length === 0 ? (
                <p className="text-xs text-muted-foreground px-1 py-1">
                  No league admins yet. Add one to delegate management of this mini-league.
                </p>
              ) : (
                <div className="space-y-2">
                  {leagueMembers.staff.map((member: any) => (
                    <Card key={member.id}>
                      <CardContent className="p-3 flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          {member.avatar_url && <AvatarImage src={member.avatar_url} />}
                          <AvatarFallback className="bg-primary/20 text-primary text-sm">
                            {(member.display_name || "?").charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{member.display_name || "Unknown"}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {member.isAlsoParent && (
                            <Badge variant="outline" className="text-xs">Parent</Badge>
                          )}
                          <Badge variant="secondary" className="text-xs">
                            League Admin
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Parents */}
          {leagueMembers.parents.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground px-1">Parents</p>
              <div className="space-y-2">
                {leagueMembers.parents.map((member: any) => (
                  <Card key={member.id}>
                    <CardContent className="p-3 flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        {member.avatar_url && <AvatarImage src={member.avatar_url} />}
                        <AvatarFallback className="bg-primary/20 text-primary text-sm">
                          {(member.display_name || "?").charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{member.display_name || "Unknown"}</p>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0">Parent</Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Pending Invites (parents added via player invites + league admin email invites) */}
          {canManageLeague && (pendingInvitesAll?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground px-1 flex items-center gap-2">
                <Mail className="h-3.5 w-3.5" />
                Pending Invites
              </p>
              <PendingInvitesList
                invites={pendingInvitesAll as any}
                clubId={league?.club_id}
                isAdmin={!!isClubAdmin}
              />
            </div>
          )}
        </div>
      )}

      {!canManageLeague && upcomingEvents.length > 0 && userPlayerIds && userPlayerIds.length > 0 && (
        <Card className="border-primary/30 bg-primary/5 rounded-xl">
          <CardContent className="py-4 px-4 space-y-2">
            <div className="flex items-center gap-2">
              <Shirt className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-primary">Next Match Day</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-primary/10 flex flex-col items-center justify-center shrink-0">
                <span className="text-[10px] font-semibold text-primary uppercase leading-none">
                  {format(parseISO(upcomingEvents[0].event_date), "MMM")}
                </span>
                <span className="text-base font-bold text-primary leading-tight">
                  {format(parseISO(upcomingEvents[0].event_date), "d")}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm">
                  {upcomingEvents[0].title || format(parseISO(upcomingEvents[0].event_date), "EEEE")}
                </p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                  {upcomingEvents[0].start_time && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {format(new Date(upcomingEvents[0].start_time), "h:mm a")}
                    </span>
                  )}
                  {upcomingEvents[0].location_name && (
                    <span className="flex items-center gap-1 truncate">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{upcomingEvents[0].location_name}</span>
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {userPlayerIds.map(p => p.name).join(", ")}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => navigate(`/events/${upcomingEvents[0].id}`)}
              >
                View
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Match Days Section */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Match Days</h2>
        </div>

        {eventsLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !hasEvents ? (
          /* Empty state for first match day */
          <Card className="rounded-xl shadow-sm">
            <CardContent className="py-6 px-5 text-center space-y-3">
              <div className="h-12 w-12 rounded-xl bg-primary/8 flex items-center justify-center mx-auto">
                <CalendarDays className="h-6 w-6 text-primary" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold">No match days yet</h3>
                <p className="text-sm text-muted-foreground">
                  Create your first match day to start scheduling games
                </p>
              </div>
              {canManageLeague && (
                <div className="space-y-1 pt-1">
                  <Button
                    size="lg"
                    onClick={() => navigate(getCreateUrl())}
                    className="w-full active:scale-[0.97] transition-all duration-150"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Create Match Day
                  </Button>
                  <p className="text-[11px] text-muted-foreground/50">Takes less than 30 seconds</p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {upcomingEvents.length > 0 && (() => {
              const chronological = [...upcomingEvents].reverse();
              const visible = showAllUpcoming ? chronological : chronological.slice(0, 4);
              const hiddenCount = chronological.length - visible.length;
              return (
                <div className="space-y-2">
                  {visible.map(event => renderMatchDayCard(event))}
                  {hiddenCount > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAllUpcoming(true)}
                      className="w-full text-primary hover:text-primary"
                    >
                      Show all {chronological.length} match days
                    </Button>
                  )}
                  {showAllUpcoming && chronological.length > 4 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAllUpcoming(false)}
                      className="w-full text-muted-foreground"
                    >
                      Show less
                    </Button>
                  )}
                </div>
              );
            })()}
            {pastEvents.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider px-1">Results</p>
                {pastEvents.map(event => renderMatchDayCard(event, true))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Floating Action Button — only when match days exist */}
      {canManageLeague && hasEvents && (
        <Button
          className="fixed bottom-24 right-4 h-auto rounded-full shadow-lg z-40 sm:bottom-6 sm:right-6 px-5 py-3 gap-2"
          onClick={() => navigate(getCreateUrl())}
          aria-label="Create Match Day"
        >
          <Plus className="h-5 w-5" />
          <span className="text-sm font-semibold">Create Match Day</span>
        </Button>
      )}

      {/* Dialogs */}
      <Suspense fallback={null}>
      <ManagePlayersDialog
        open={playersOpen}
        onOpenChange={setPlayersOpen}
        miniLeagueId={id!}
        miniLeagueName={league.name}
        clubId={league.club_id}
        canManage={!!canManageLeague}
        onOpenAddPlayers={() => setAddPlayersOpen(true)}
      />
      </Suspense>

      <Suspense fallback={null}>
      <MiniLeagueSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        league={league}
        canDelete={!!canDeleteLeague}
      />
      </Suspense>

      {canManageLeague && addPlayersOpen && (
        <Suspense fallback={null}>
        <AddMiniLeagueMemberSheet
          miniLeagueId={id!}
          miniLeagueName={league.name}
          clubId={league.club_id}
          externalOpen={addPlayersOpen}
          onExternalOpenChange={setAddPlayersOpen}
        />
        </Suspense>
      )}

      {isClubAdmin && (
        <Suspense fallback={null}>
        <ManageMiniLeagueAdminsSheet
          miniLeagueId={id!}
          miniLeagueName={league.name}
          clubId={league.club_id}
          open={manageAdminsOpen}
          onOpenChange={setManageAdminsOpen}
        />
        </Suspense>
      )}
    </div>
  );
}
