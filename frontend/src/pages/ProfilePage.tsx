import { useState, useMemo, useEffect, useRef } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Flame, Users, Settings, ChevronRight, ChevronDown, Baby, Loader2, Crown, Building2, ShieldCheck, Plus, Lock, Pencil, KeyRound } from "lucide-react";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useClubSeasons } from "@/hooks/useClubSeasons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { isPast, parseISO } from "date-fns";
import RewardRedemptionCard from "@/components/RewardRedemptionCard";
import { ProfileTeamHistory } from "@/components/profile/ProfileTeamHistory";
import { PointsActivityFeed, type PointsActivityItem } from "@/components/profile/PointsActivityFeed";
import { getSportEmoji } from "@/lib/sportEmojis";
import { useClubTheme } from "@/hooks/useClubTheme";
import { useUserClubPoints } from "@/hooks/useClubPoints";
import { useNotificationNudge } from "@/hooks/useNotificationNudge";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

import igniteIcon from "@/assets/ignite-icon.png";

function getOrdinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

export default function ProfilePage() {
  const { user, profile, signOut } = useAuth();
  const useIcpLab = resolveLocalAuthMode(typeof window !== 'undefined' ? window.location.search : '', true);
  const notificationNudge = useNotificationNudge(user?.id, "settings");
  usePageTitle("Profile");
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pointsHistoryRef = useRef<HTMLDivElement>(null);
  const rewardsRef = useRef<HTMLDivElement>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [showAllDuties, setShowAllDuties] = useState(false);
  const [pointsHistoryOpen, setPointsHistoryOpen] = useState(true);
  const [clubPlansOpen, setClubPlansOpen] = useState(true);
  const [teamPlansOpen, setTeamPlansOpen] = useState(false);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>("all");
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  
  const { activeClubFilter, activeClubTeamIds, activeThemeData } = useClubTheme();
  const { data: seasonsForRank = [] } = useClubSeasons(activeClubFilter || undefined);
  // Per-club balance for the active club. When no club is selected (All Clubs
  // mode), fall back to the legacy global total on the profile below.
  const { data: activeClubPoints = 0 } = useUserClubPoints(
    user?.id ?? null,
    activeClubFilter,
  );

  // Auto-scroll to a section when navigated from a notification.
  // IMPORTANT: do NOT use Element.scrollIntoView on Android WebView — it
  // overscrolls past the sticky AppHeader and leaves page content pinned
  // under the status bar with the header invisible (project memory rule).
  // Compute the target Y manually and use window.scrollTo with an offset
  // for the sticky header height so the header always remains in view.
  useEffect(() => {
    const section = searchParams.get('section');
    const STICKY_HEADER_OFFSET = 72; // h-14 header + a little breathing room

    const scrollToRef = (ref: React.RefObject<HTMLDivElement>) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const targetY = Math.max(0, window.scrollY + rect.top - STICKY_HEADER_OFFSET);
      window.scrollTo({ top: targetY, behavior: 'smooth' });
    };

    if (section === 'points-history') {
      setPointsHistoryOpen(true);
      setTimeout(() => scrollToRef(pointsHistoryRef), 300);
    } else if (section === 'rewards') {
      setTimeout(() => scrollToRef(rewardsRef), 300);
    }
  }, [searchParams]);

  const { data: isAppAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user?.id && !useIcpLab,
    staleTime: 0,
    refetchOnMount: true,
  });

  // Check if user is team admin or coach
  const { data: isTeamAdminOrCoach } = useQuery({
    queryKey: ["is-team-admin-coach", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .in("role", ["team_admin", "coach"])
        .not("team_id", "is", null)
        .limit(1);
      return data && data.length > 0;
    },
    enabled: !!user && !useIcpLab,
  });

  // Check if user has pro access
  const { data: hasProAccess } = useQuery({
    queryKey: ["has-pro-access", user?.id, activeClubFilter],
    queryFn: async () => {
      if (activeClubFilter) {
        const { data: subscription } = await supabase
          .from("club_subscriptions")
          .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .eq("club_id", activeClubFilter)
          .maybeSingle();

        return !!(subscription?.is_pro || subscription?.is_pro_football || 
                  subscription?.admin_pro_override || subscription?.admin_pro_football_override);
      }

      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user!.id);

      if (!roles || roles.length === 0) return false;

      const directClubIds = roles.map(r => r.club_id).filter(Boolean) as string[];
      const teamIds = roles.map(r => r.team_id).filter(Boolean) as string[];
      let teamClubIds: string[] = [];
      
      if (teamIds.length > 0) {
        const { data: teams } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);
        teamClubIds = (teams || []).map(t => t.club_id).filter(Boolean) as string[];
      }

      const allClubIds = [...new Set([...directClubIds, ...teamClubIds])];
      if (allClubIds.length === 0) return false;

      const { data: subscriptions } = await supabase
        .from("club_subscriptions")
        .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .in("club_id", allClubIds);

      return (subscriptions || []).some(sub => 
        sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override
      );
    },
    enabled: !!user && !useIcpLab,
  });

  // Fetch user's clubs and teams
  const { data: myClubsAndTeams } = useQuery({
    queryKey: ["my-clubs-teams", user?.id, activeClubFilter],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user!.id);

      if (!roles || roles.length === 0) return { clubs: [], teams: [] };

      const directClubIds = [...new Set(roles.map(r => r.club_id).filter(Boolean))] as string[];
      const teamIds = [...new Set(roles.map(r => r.team_id).filter(Boolean))] as string[];

      let teams: any[] = [];
      if (teamIds.length > 0) {
        const { data: teamsData } = await supabase
          .from("teams")
          .select("id, name, club_id, clubs!club_id (id, name, sport)")
          .in("id", teamIds);
        teams = teamsData || [];
      }

      const teamClubIds = teams.map(t => t.club_id).filter(Boolean) as string[];
      const allClubIds = [...new Set([...directClubIds, ...teamClubIds])];

      let clubs: any[] = [];
      if (allClubIds.length > 0) {
        const { data: clubsData } = await supabase
          .from("clubs")
          .select("id, name, sport, logo_url")
          .in("id", allClubIds);
        clubs = clubsData || [];
      }

      if (activeClubFilter) {
        clubs = clubs.filter(c => c.id === activeClubFilter);
        teams = teams.filter(t => t.club_id === activeClubFilter);
      }

      return { clubs, teams };
    },
    enabled: !!user && !useIcpLab,
  });

  // Fetch points history
  const { data: pointsHistoryData, isLoading: pointsHistoryLoading } = useQuery({
    queryKey: ["points-history", user?.id, activeClubFilter],
    queryFn: async () => {
      let query = supabase
        .from("points_history")
        .select(`id, amount, balance_after, source_type, source_id, description, created_at, club_id, clubs:club_id (name)`)
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(100);
      
      if (activeClubFilter) {
        query = query.eq("club_id", activeClubFilter);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !useIcpLab,
  });

  // Legacy duty history
  const { data: dutyHistory } = useQuery({
    queryKey: ["duty-history", user?.id, activeClubFilter],
    queryFn: async () => {
      let query = supabase
        .from("duties")
        .select(`id, name, status, points, points_awarded, created_at, events (id, title, event_date, club_id, team_id, teams (name), clubs!club_id (name))`)
        .eq("assigned_to", user!.id)
        .eq("points_awarded", true)
        .order("created_at", { ascending: false });
      
      const { data, error } = await query;
      if (error) throw error;
      
      if (activeClubFilter && data) {
        return data.filter((duty: any) => {
          const event = duty.events;
          if (!event) return false;
          return event.club_id === activeClubFilter || activeClubTeamIds.includes(event.team_id);
        });
      }
      
      return data || [];
    },
    enabled: !!user && !useIcpLab,
  });

  // Redemption history
  const { data: redemptionHistory, isLoading: redemptionsLoading } = useQuery({
    queryKey: ["redemption-history", user?.id, activeClubFilter],
    queryFn: async () => {
      let query = supabase
        .from("reward_redemptions")
        .select(`id, points_spent, status, redeemed_at, created_at, club_id, club_rewards (name), clubs!club_id (name)`)
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      
      if (activeClubFilter) {
        query = query.eq("club_id", activeClubFilter);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !useIcpLab,
  });

  // Combine points history
  const pointsHistory = useMemo<PointsActivityItem[]>(() => {
    const items: PointsActivityItem[] = [];

    const addedSourceIds = new Set<string>();

    if (pointsHistoryData) {
      pointsHistoryData.forEach((entry: any) => {
        const isEarned = entry.amount > 0;
        items.push({
          id: entry.id,
          type: isEarned ? 'earned' : 'spent',
          points: Math.abs(entry.amount),
          name: entry.description,
          context: entry.clubs?.name || 'Club',
          date: entry.created_at,
          sourceType: entry.source_type,
          eventId: entry.source_type === 'early_rsvp' || entry.source_type === 'player_of_match' || entry.source_type === 'attendance' ? entry.source_id : undefined,
        });
        if (entry.source_id) {
          addedSourceIds.add(entry.source_id);
        }
      });
    }

    if (dutyHistory) {
      dutyHistory.forEach((duty: any) => {
        if (addedSourceIds.has(duty.id)) return;
        if (duty.points_awarded && duty.points) {
          const event = duty.events;
          items.push({
            id: `duty-${duty.id}`,
            type: 'earned',
            points: duty.points,
            name: duty.name,
            context: event?.teams?.name || event?.clubs?.name || 'Event',
            date: duty.created_at,
            sourceType: 'duty',
            eventId: event?.id,
          });
        }
      });
    }

    if (redemptionHistory) {
      redemptionHistory.forEach((redemption: any) => {
        if (addedSourceIds.has(redemption.reward_id || redemption.id)) return;
        items.push({
          id: `redemption-${redemption.id}`,
          type: 'spent',
          points: redemption.points_spent,
          name: redemption.club_rewards?.name || 'Reward',
          context: redemption.clubs?.name || 'Club',
          date: redemption.redeemed_at || redemption.created_at,
          sourceType: 'redemption',
        });
      });
    }

    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return items;
  }, [pointsHistoryData, dutyHistory, redemptionHistory]);

  const pointsEarned = useMemo(() => {
    return pointsHistory.filter(p => p.type === 'earned').reduce((sum, p) => sum + p.points, 0);
  }, [pointsHistory]);

  const pointsSpent = useMemo(() => {
    return pointsHistory.filter(p => p.type === 'spent').reduce((sum, p) => sum + p.points, 0);
  }, [pointsHistory]);

  // Fetch user's points rank among club members.
  // Uses a SECURITY DEFINER RPC so the rank is computed against the FULL set
  // of club members on the server, bypassing per-viewer RLS that could otherwise
  // hide higher-ranked members and falsely show the viewer as #1.
  // All-time rank requires a specific club to be selected (rank across multiple
  // clubs would be ambiguous).
  const { data: rankData } = useQuery({
    queryKey: ["points-rank", user?.id, activeClubFilter],
    queryFn: async () => {
      if (!user?.id || !activeClubFilter) return null;
      const { data, error } = await supabase.rpc("get_user_leaderboard_rank_all_time", {
        _user_id: user.id,
        _club_id: activeClubFilter,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : null;
      if (!row || !row.rank) return null;
      return {
        rank: row.rank as number,
        total: row.total as number,
        points: row.points as number,
      };
    },
    enabled: !!user && !useIcpLab && hasProAccess === true && !!activeClubFilter,
  });

  // Season-scoped rank (only when a specific season is selected within a filtered club)
  const { data: seasonRankData } = useQuery({
    queryKey: ["points-rank-seasoned", user?.id, activeClubFilter, selectedSeasonId],
    queryFn: async () => {
      if (!user?.id || !activeClubFilter || selectedSeasonId === "all") return null;
      const { data, error } = await supabase.rpc("get_user_leaderboard_rank_seasoned", {
        _user_id: user.id,
        _club_id: activeClubFilter,
        _season_id: selectedSeasonId,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : null;
      if (!row || !row.rank) return null;
      return { rank: row.rank as number, total: row.total as number, points: row.points as number };
    },
    enabled: !!user && !useIcpLab && hasProAccess === true && !!activeClubFilter && selectedSeasonId !== "all",
  });

  const displayedRank = selectedSeasonId !== "all" ? seasonRankData : rankData;

  const { data: upgradableClubs } = useQuery({
    queryKey: ["upgradable-clubs", user?.id, activeClubFilter],
    queryFn: async () => {
      const { data: appAdminRole } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();

      const isAppAdminUser = !!appAdminRole;

      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .eq("role", "club_admin")
        .not("club_id", "is", null);

      let clubIds: string[] = [];

      if (isAppAdminUser && !activeClubFilter) {
        const { data: allClubs } = await supabase.from("clubs").select("id, name, sport");
        if (!allClubs || allClubs.length === 0) return [];
        
        const { data: subscriptions } = await supabase
          .from("club_subscriptions")
          .select("club_id, is_pro, is_pro_football, plan, team_limit, expires_at, storage_purchased_gb, is_trial, trial_ends_at")
          .in("club_id", allClubs.map(c => c.id));
        
        return allClubs.map(club => ({
          ...club,
          subscription: subscriptions?.find(s => s.club_id === club.id) || null
        }));
      }

      if (activeClubFilter) {
        const hasAccess = isAppAdminUser || (roles?.some(r => r.club_id === activeClubFilter));
        if (!hasAccess) return [];
        
        const { data: club } = await supabase.from("clubs").select("id, name, sport").eq("id", activeClubFilter).single();
        if (!club) return [];
        
        const { data: subscription } = await supabase
          .from("club_subscriptions")
          .select("club_id, is_pro, is_pro_football, plan, team_limit, expires_at, storage_purchased_gb, is_trial, trial_ends_at")
          .eq("club_id", activeClubFilter)
          .maybeSingle();
        
        return [{ ...club, subscription: subscription || null }];
      }

      if (!roles || roles.length === 0) return [];
      clubIds = roles.map(r => r.club_id).filter(Boolean) as string[];
      
      const { data: clubs } = await supabase.from("clubs").select("id, name, sport").in("id", clubIds);
      if (!clubs || clubs.length === 0) return [];

      const { data: subscriptions } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro, is_pro_football, plan, team_limit, expires_at, storage_purchased_gb, is_trial, trial_ends_at")
        .in("club_id", clubIds);

      return clubs.map(club => ({
        ...club,
        subscription: subscriptions?.find(s => s.club_id === club.id) || null
      }));
    },
    enabled: !!user && !useIcpLab,
    staleTime: 0,
  });

  // Fetch upgradable teams
  const { data: upgradableTeams } = useQuery({
    queryKey: ["upgradable-teams", user?.id, activeClubFilter],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role, team_id, club_id")
        .eq("user_id", user!.id)
        .in("role", ["team_admin", "coach", "club_admin"]);

      if (!roles || roles.length === 0) return [];

      let directTeamIds = roles
        .filter(r => r.team_id && (r.role === "team_admin" || r.role === "coach"))
        .map(r => r.team_id);

      let adminClubIds = roles
        .filter(r => r.club_id && r.role === "club_admin")
        .map(r => r.club_id);

      if (activeClubFilter) {
        directTeamIds = directTeamIds.filter(teamId => activeClubTeamIds.includes(teamId!));
        adminClubIds = adminClubIds.filter(clubId => clubId === activeClubFilter);
      }

      let teamsQuery = supabase
        .from("teams")
        .select(`id, name, club_id, is_pro, pro_expires_at, stripe_subscription_id, clubs!club_id (name, sport), team_subscriptions (is_pro, is_pro_football, is_trial, trial_ends_at)`);

      if (activeClubFilter) {
        teamsQuery = teamsQuery.eq("club_id", activeClubFilter);
      }

      if (directTeamIds.length > 0 && adminClubIds.length > 0) {
        teamsQuery = teamsQuery.or(`id.in.(${directTeamIds.join(',')}),club_id.in.(${adminClubIds.join(',')})`);
      } else if (directTeamIds.length > 0) {
        teamsQuery = teamsQuery.in("id", directTeamIds);
      } else if (adminClubIds.length > 0) {
        teamsQuery = teamsQuery.in("club_id", adminClubIds);
      } else {
        return [];
      }

      const { data: teams } = await teamsQuery;
      if (!teams || teams.length === 0) return [];

      const clubIds = [...new Set(teams.map(t => t.club_id).filter(Boolean))];
      const { data: clubSubs } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro, is_pro_football, plan")
        .in("club_id", clubIds);

      const clubSubMap = new Map(clubSubs?.map(cs => [cs.club_id, cs]) || []);
      
      return teams.map(team => ({
        ...team,
        clubSubscription: clubSubMap.get(team.club_id) || null
      }));
    },
    enabled: !!user && !useIcpLab,
  });

  // Auto-expand team plans if no club plans exist but team plans do
  useEffect(() => {
    if (upgradableClubs && upgradableTeams) {
      const hasClubPlans = upgradableClubs.length > 0;
      const hasTeamPlans = upgradableTeams.length > 0;
      if (!hasClubPlans && hasTeamPlans) {
        setTeamPlansOpen(true);
      }
    }
  }, [upgradableClubs, upgradableTeams]);

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    toast({ title: "Signed out successfully" });
  };

  return (
    <div className="py-6 space-y-6">
      {/* Profile Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate("/edit-profile")}
          className="relative group rounded-full focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label="Edit profile"
        >
          <Avatar className="h-20 w-20 border-4 border-primary/20">
            <AvatarImage src={profile?.avatar_url || undefined} />
            <AvatarFallback className="bg-muted flex items-center justify-center p-0">
              {activeThemeData?.logoUrl ? (
                <img src={activeThemeData.logoUrl} alt={activeThemeData.clubName} className="h-14 w-14 object-contain" />
              ) : (
                <img src={igniteIcon} alt="Profile" className="h-full w-full object-cover rounded-full" />
              )}
            </AvatarFallback>
          </Avatar>
          <span className="absolute bottom-0 right-0 h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center border-2 border-background shadow-sm">
            <Pencil className="h-3.5 w-3.5" />
          </span>
        </button>
        <button
          onClick={() => navigate("/edit-profile")}
          className="flex-1 text-left min-w-0"
          aria-label="Edit profile"
        >
          <h1 className="text-2xl font-bold truncate">{profile?.display_name}</h1>
          <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
        </button>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-auto flex-col gap-1 py-3"
          onClick={() => navigate("/edit-profile")}
        >
          <Pencil className="h-4 w-4" />
          <span className="text-xs">Edit Profile</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-auto flex-col gap-1 py-3"
          onClick={() => setChangePasswordOpen(true)}
        >
          <KeyRound className="h-4 w-4" />
          <span className="text-xs">Password</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-auto flex-col gap-1 py-3 relative"
          onClick={() => navigate("/settings")}
        >
          <Settings className="h-4 w-4" />
          <span className="text-xs">Settings</span>
          {notificationNudge.shouldShowNudge && (
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive animate-pulse" />
          )}
        </Button>
      </div>

      <div ref={rewardsRef}>
        <RewardRedemptionCard />
      </div>


      {/* Points History — sits directly under Rewards to preserve the engagement loop */}
      <div ref={pointsHistoryRef}>
      {hasProAccess ? (
        (() => {
          // When a club is active, the per-club table (`user_club_points`) is the
          // sole source of truth — `balance_after` rows in `points_history` are a
          // legacy snapshot of the GLOBAL balance at the time of the entry and
          // can't be trusted in a per-club view (they may include points earned
          // at other clubs). Only fall back to history's `balance_after` in
          // "All Clubs" mode, where the legacy global total is meaningful.
          const profileBalance = activeClubFilter
            ? activeClubPoints
            : (profile?.ignite_points || 0);
          const latestHistoryBalance =
            !activeClubFilter && pointsHistoryData && pointsHistoryData.length > 0
              ? (pointsHistoryData[0] as any).balance_after ?? null
              : null;
          const balance =
            latestHistoryBalance !== null ? latestHistoryBalance : profileBalance;
          const calculatedBalance = pointsEarned - pointsSpent;
          const untracked = balance - calculatedBalance;
          // Only show the "earned before history tracking" note when the gap is
          // material (>5 pts) and queries are settled — small gaps are usually just
          // transient sync lag between the profile cache and the history table.
          const untrackedNote =
            untracked > 5 && !pointsHistoryLoading && !redemptionsLoading
              ? `+${untracked} pts earned before history tracking began`
              : null;
          const rankForFeed = displayedRank
            ? {
                rank: displayedRank.rank,
                total: displayedRank.total,
                points:
                  selectedSeasonId !== "all" && "points" in (displayedRank as any)
                    ? (displayedRank as any).points
                    : undefined,
              }
            : null;
          return (
            <PointsActivityFeed
              open={pointsHistoryOpen}
              onOpenChange={setPointsHistoryOpen}
              loading={pointsHistoryLoading || redemptionsLoading}
              items={pointsHistory}
              balance={balance}
              earned={pointsEarned}
              spent={pointsSpent}
              rank={rankForFeed}
              seasons={seasonsForRank}
              selectedSeasonId={selectedSeasonId}
              onSeasonChange={setSelectedSeasonId}
              showSeasonFilter={!!activeClubFilter && seasonsForRank.length > 0}
              untrackedNote={untrackedNote}
            />
          );
        })()
      ) : (
        <Card className="opacity-75">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Flame className="h-5 w-5 text-muted-foreground" />
              Points History
              <div className="ml-auto flex items-center gap-1.5">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <Badge variant="secondary" className="text-xs">Pro Only</Badge>
              </div>
            </CardTitle>
          </CardHeader>
        </Card>
      )}
      </div>

      {/* Subtle transition between engagement loop and management actions */}
      <Separator className="opacity-60" />

      {/* Team history — current + past teams from season memberships */}
      <ProfileTeamHistory profileId={user?.id} />

      {/* Discover / Create Club */}
      <Button variant="outline" className="w-full" onClick={() => navigate("/clubs")}>
        <Plus className="h-4 w-4 mr-2" />
        Discover or Create Club
      </Button>

      {/* Manage section */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
          Manage
        </h2>
        <MenuCard icon={Baby} label="Manage Children" onClick={() => navigate("/children")} />
        <MenuCard icon={Users} label="My Roles" onClick={() => navigate("/roles")} />
        {(isAppAdmin || isTeamAdminOrCoach) && (
          <MenuCard icon={ShieldCheck} label="Admin" onClick={() => navigate("/admin")} />
        )}
      </div>

      {/* Manage Plans Section */}
      {((upgradableClubs && upgradableClubs.length > 0) || (upgradableTeams && upgradableTeams.length > 0)) && (
        <div id="manage-plans-section" className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Crown className="h-5 w-5 text-primary" />
            Manage Plans
          </h2>
          
          {upgradableClubs && upgradableClubs.length > 0 && (
            <Collapsible open={clubPlansOpen} onOpenChange={setClubPlansOpen}>
              <CollapsibleTrigger className="flex items-center gap-1 w-full text-sm text-muted-foreground hover:text-foreground transition-colors">
                <Building2 className="h-4 w-4" />
                <span>Club Plans ({upgradableClubs.length})</span>
                <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${clubPlansOpen ? '' : '-rotate-90'}`} />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 mt-2">
                {upgradableClubs.map((club: any) => {
                   const sub = club.subscription;
                   const currentPlan = sub?.is_pro_football ? "Pro Football" : sub?.is_pro ? "Pro" : "Free";
                   const isOnClubTrial = sub?.is_trial && sub?.trial_ends_at && !isPast(parseISO(sub.trial_ends_at));
                   const sport = club.sport?.toLowerCase() || "";
                   const isSoccer = sport.includes("soccer") || sport.includes("football") || sport.includes("futsal");
                   
                   return (
                     <Card 
                       key={club.id}
                       className="cursor-pointer hover:border-primary/50 transition-colors"
                       onClick={() => navigate(`/clubs/${club.id}/upgrade`)}
                     >
                       <CardContent className="p-4">
                         <div className="flex items-center justify-between mb-2">
                           <span className="font-medium">{club.name}</span>
                           <ChevronRight className="h-5 w-5 text-muted-foreground" />
                         </div>
                         <div className="flex items-center gap-2 flex-wrap">
                           <Badge variant={currentPlan === "Free" ? "outline" : "default"} className={currentPlan === "Free" ? "text-muted-foreground" : ""}>
                             {currentPlan}
                           </Badge>
                           {isOnClubTrial && (
                             <Badge variant="outline" className="text-amber-600 border-amber-500">Free Trial</Badge>
                           )}
                           {currentPlan === "Free" && !isOnClubTrial && (
                             <>
                               <Badge variant="outline" className="text-primary border-primary">Pro $50/mo</Badge>
                               {isSoccer && <Badge variant="outline" className="text-primary border-primary">Pro Football $75/mo</Badge>}
                             </>
                           )}
                         </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </CollapsibleContent>
            </Collapsible>
          )}

          {upgradableTeams && upgradableTeams.length > 0 && (
            <Collapsible open={teamPlansOpen} onOpenChange={setTeamPlansOpen}>
              <CollapsibleTrigger className="flex items-center gap-1 w-full text-sm text-muted-foreground hover:text-foreground transition-colors">
                <Users className="h-4 w-4" />
                <span>Team Plans ({upgradableTeams.length})</span>
                <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${teamPlansOpen ? '' : '-rotate-90'}`} />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 mt-2">
                {upgradableTeams.map((team: any) => {
                   const subscription = team.team_subscriptions?.[0];
                   const teamIsPro = subscription?.is_pro || team.is_pro;
                   const teamIsProFootball = subscription?.is_pro_football;
                   const teamIsOnTrial = (subscription?.is_trial && subscription?.trial_ends_at && !isPast(parseISO(subscription.trial_ends_at))) || 
                     (team.is_pro && team.pro_expires_at && !isPast(parseISO(team.pro_expires_at)) && !subscription?.is_pro);
                   const sport = team.clubs?.sport?.toLowerCase() || "";
                   const isSoccerTeam = sport.includes("soccer") || sport.includes("football") || sport.includes("futsal");
                   
                   const clubSub = team.clubSubscription;
                   const clubHasPro = clubSub?.is_pro === true;
                   const clubHasProFootball = clubSub?.is_pro_football === true;
                   
                   const effectiveIsProFootball = teamIsProFootball || clubHasProFootball;
                   const effectiveIsPro = teamIsPro || clubHasPro || clubHasProFootball;
                   
                   let currentPlan = "Free";
                   let planSource = "";
                   if (effectiveIsProFootball) {
                     currentPlan = "Pro Football";
                     planSource = (clubHasProFootball && !teamIsProFootball) ? " (via Club)" : "";
                   } else if (effectiveIsPro) {
                     currentPlan = "Pro";
                     planSource = ((clubHasPro || clubHasProFootball) && !teamIsPro) ? " (via Club)" : "";
                   }
                  
                  const hasClubAccess = clubHasPro || clubHasProFootball;
                  
                  return (
                    <Card 
                      key={team.id}
                      className="cursor-pointer hover:border-primary/50 transition-colors"
                      onClick={() => navigate(`/teams/${team.id}/upgrade`)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex-1">
                            <span className="font-medium">{team.name}</span>
                            <p className="text-sm text-muted-foreground">{team.clubs?.name}</p>
                          </div>
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                           <Badge variant={currentPlan === "Free" ? "outline" : "default"} className={currentPlan === "Free" ? "text-muted-foreground" : ""}>
                             {currentPlan}{planSource}
                           </Badge>
                           {teamIsOnTrial && (
                             <Badge variant="outline" className="text-amber-600 border-amber-500">Free Trial</Badge>
                           )}
                           {!hasClubAccess && currentPlan === "Free" && !teamIsOnTrial && (
                             <>
                               <Badge variant="outline" className="text-primary border-primary">Pro $25/mo</Badge>
                               {isSoccerTeam && <Badge variant="outline" className="text-primary border-primary">Pro Football $40/mo</Badge>}
                             </>
                           )}
                          {hasClubAccess && (
                            <Badge variant="outline" className="text-muted-foreground">Managed via Club</Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      )}

      <Separator />

      {/* Sign Out */}
      <Button 
        variant="destructive" 
        className="w-full" 
        onClick={handleSignOut}
        disabled={signingOut}
      >
        {signingOut ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <LogOut className="h-4 w-4 mr-2" />}
        Sign Out
      </Button>

      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
    </div>
  );
}

function MenuCard({ 
  icon: Icon, 
  label, 
  onClick,
  loading,
  badge
}: { 
  icon: React.ElementType; 
  label: string; 
  onClick: () => void;
  loading?: boolean;
  badge?: string;
}) {
  return (
    <Card 
      className="cursor-pointer hover:border-primary/50 transition-colors"
      onClick={loading ? undefined : onClick}
    >
      <CardContent className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            {loading ? <Loader2 className="h-5 w-5 text-primary animate-spin" /> : <Icon className="h-5 w-5 text-primary" />}
          </div>
          <span className="font-medium">{label}</span>
          {badge && <Badge variant="secondary" className="text-xs">{badge}</Badge>}
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}
