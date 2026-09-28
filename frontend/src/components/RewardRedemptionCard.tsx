import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trophy, Gift, Loader2, CheckCircle2, ChevronRight, Star, Users, QrCode, Building2, Flame, HelpCircle, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { RewardClaimQRDialog } from "@/components/RewardClaimQRDialog";
import PointsHowToEarnSheet from "@/components/PointsHowToEarnSheet";
import { useCountUp } from "@/hooks/useCountUp";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfileById } from "@/lib/profileCache";
import { useClubTheme } from "@/hooks/useClubTheme";
import { recordPointsHistory } from "@/lib/pointsHistory";
import { useUserClubPoints } from "@/hooks/useClubPoints";

interface ClubReward {
  id: string;
  club_id: string;
  name: string;
  description: string | null;
  points_required: number;
  is_active: boolean;
  is_default: boolean;
  logo_url: string | null;
  qr_code_url: string | null;
  show_qr_code: boolean;
  sponsors?: {
    id: string;
    name: string;
    logo_url: string | null;
  } | null;
}

interface RewardRedemption {
  id: string;
  reward_id: string;
  club_id: string;
  points_spent: number;
  status: string;
  redeemed_at: string;
  child_id: string | null;
  club_rewards: ClubReward | null;
  clubs: { name: string };
  children: { id: string; name: string } | null;
}

interface Child {
  id: string;
  name: string;
  ignite_points: number;
}

// Check localStorage instantly to prevent gradient flash before React hydrates
const getInitialThemeState = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    // Check for any cached theme data - means user has club theme active
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('ignite-club-theme-data-')) {
        const data = localStorage.getItem(key);
        if (data) return true;
      }
    }
  } catch {
    // localStorage not available
  }
  return false;
};

export default function RewardRedemptionCard() {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeClubFilter, activeClubTeamIds, activeThemeData } = useClubTheme();
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [selectedReward, setSelectedReward] = useState<ClubReward | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [claimDialogOpen, setClaimDialogOpen] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [selectedRedemption, setSelectedRedemption] = useState<RewardRedemption | null>(null);
  const [selectedRedeemFor, setSelectedRedeemFor] = useState<string>("myself"); // "myself" or child_id
  const [activeChildId, setActiveChildId] = useState<string | null>(null);
  const [childSwitcherOpen, setChildSwitcherOpen] = useState(false);
  const [howToEarnOpen, setHowToEarnOpen] = useState(false);

  // Use cached theme state to prevent gradient flash on initial render
  const [hasClubThemeCached] = useState(getInitialThemeState);
  const hasClubTheme = activeThemeData || hasClubThemeCached;

  // Check if app admin
  const { data: isAppAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  // Fetch clubs user belongs to (filtered by active club if set)
  const { data: userClubs = [], isLoading: isLoadingClubs } = useQuery({
    queryKey: ["user-clubs-for-rewards", user?.id, activeClubFilter],
    staleTime: 5 * 60 * 1000, // 5 minutes - show cached data instantly
    queryFn: async () => {
      // If active club filter, only return that club
      if (activeClubFilter) {
        const { data: club } = await supabase
          .from("clubs")
          .select("id, name, logo_url, points_display_name, points_icon_url")
          .eq("id", activeClubFilter)
          .single();

        if (!club) return [];

        // Fetch subscription for this club
        const { data: subscription } = await supabase
          .from("club_subscriptions")
          .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .eq("club_id", activeClubFilter)
          .maybeSingle();

        const hasPro = subscription?.is_pro || subscription?.is_pro_football || 
                       subscription?.admin_pro_override || subscription?.admin_pro_football_override;
        return [{ ...club, hasPro: !!hasPro }];
      }

      // Get club IDs from user roles (direct club membership or via teams)
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, team_id, teams(club_id)")
        .eq("user_id", user!.id);

      if (!roles) return [];

      // Collect all club IDs
      const clubIds = new Set<string>();
      roles.forEach(role => {
        if (role.club_id) clubIds.add(role.club_id);
        if (role.teams?.club_id) clubIds.add(role.teams.club_id);
      });

      if (clubIds.size === 0) return [];

      // Fetch club details with subscription info
      const { data: clubs } = await supabase
        .from("clubs")
        .select("id, name, logo_url, points_display_name, points_icon_url")
        .in("id", Array.from(clubIds));

      // Fetch subscriptions for these clubs
      const { data: subscriptions } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .in("club_id", Array.from(clubIds));

      // Merge subscription data with clubs
      const clubsWithPro = (clubs || []).map(club => {
        const sub = subscriptions?.find(s => s.club_id === club.id);
        const hasPro = sub?.is_pro || sub?.is_pro_football || sub?.admin_pro_override || sub?.admin_pro_football_override;
        return { ...club, hasPro: !!hasPro };
      });

      return clubsWithPro;
    },
    enabled: !!user,
  });

  // Fetch available rewards for selected club (exclude player_of_match rewards - those can only be awarded, not redeemed)
  const { data: availableRewards = [], isLoading: rewardsLoading } = useQuery({
    queryKey: ["available-rewards", selectedClubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("club_rewards")
        .select("*, sponsors(id, name, logo_url)")
        .eq("club_id", selectedClubId!)
        .eq("is_active", true)
        .neq("reward_type", "player_of_match")
        .order("points_required", { ascending: true });
      return (data || []) as ClubReward[];
    },
    enabled: !!selectedClubId,
  });

  // Fetch user's children — both as primary parent AND as a linked guardian
  const { data: children = [] } = useQuery({
    queryKey: ["user-children-for-rewards", user?.id],
    queryFn: async () => {
      // Children where this user is the primary parent
      const ownedPromise = supabase
        .from("children")
        .select("id, name, ignite_points")
        .eq("parent_id", user!.id);

      // Children where this user is linked as a guardian (e.g. secondary parent)
      const guardianLinksPromise = supabase
        .from("child_guardians")
        .select("child_id, children:child_id (id, name, ignite_points)")
        .eq("guardian_id", user!.id);

      const [{ data: owned }, { data: guardianLinks }] = await Promise.all([
        ownedPromise,
        guardianLinksPromise,
      ]);

      const map = new Map<string, Child>();
      (owned || []).forEach((c: any) => map.set(c.id, c as Child));
      (guardianLinks || []).forEach((row: any) => {
        const c = row.children;
        if (c && !map.has(c.id)) map.set(c.id, c as Child);
      });

      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: !!user,
  });

  // Fetch user's redemption history (including children's) - filtered by active club if set
  const { data: redemptions = [] } = useQuery({
    queryKey: ["user-redemptions", user?.id, activeClubFilter],
    queryFn: async () => {
      let query = supabase
        .from("reward_redemptions")
        .select(`
          id,
          reward_id,
          club_id,
          points_spent,
          status,
          redeemed_at,
          child_id,
          club_rewards (id, name, description, points_required, qr_code_url, show_qr_code),
          clubs!club_id (name),
          children (id, name)
        `)
        .eq("user_id", user!.id)
        .order("redeemed_at", { ascending: false })
        .limit(10);

      // Filter by active club if set
      if (activeClubFilter) {
        query = query.eq("club_id", activeClubFilter);
      }

      const { data } = await query;
      return (data || []) as RewardRedemption[];
    },
    enabled: !!user,
  });

  // Weekly points delta (last 7 days) for the user
  const { data: weeklyDelta = 0 } = useQuery({
    queryKey: ["points-weekly-delta", user?.id, activeClubFilter],
    queryFn: async () => {
      const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      let q = supabase
        .from("points_history")
        .select("amount")
        .eq("user_id", user!.id)
        .gt("amount", 0)
        .gte("created_at", sinceIso);
      if (activeClubFilter) q = q.eq("club_id", activeClubFilter);
      const { data } = await q;
      return (data || []).reduce((sum: number, row: any) => sum + (row.amount || 0), 0);
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  // Next reward thresholds across the user's clubs (sorted ascending by points)
  const { data: rewardThresholds = [] } = useQuery({
    queryKey: ["next-reward-thresholds", user?.id, activeClubFilter],
    queryFn: async () => {
      let clubIds: string[] = [];
      if (activeClubFilter) {
        clubIds = [activeClubFilter];
      } else {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("club_id, teams(club_id)")
          .eq("user_id", user!.id);
        const set = new Set<string>();
        (roles || []).forEach((r: any) => {
          if (r.club_id) set.add(r.club_id);
          if (r.teams?.club_id) set.add(r.teams.club_id);
        });
        clubIds = Array.from(set);
      }
      if (clubIds.length === 0) return [];
      const { data } = await supabase
        .from("club_rewards")
        .select("id, name, points_required")
        .in("club_id", clubIds)
        .eq("is_active", true)
        .neq("reward_type", "player_of_match")
        .order("points_required", { ascending: true });
      return (data || []) as { id: string; name: string; points_required: number }[];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const redeemMutation = useMutation({
    mutationFn: async ({ reward, forChildId }: { reward: ClubReward; forChildId: string | null }) => {
      // Determine whose points to use — and verify against the per-club balance,
      // since reward points are scoped to each club.
      let pointsSource: { id: string; points: number; isChild: boolean };
      let childName: string | null = null;

      if (forChildId) {
        const child = children.find(c => c.id === forChildId);
        if (!child) throw new Error("Child not found");
        const { data: clubPts } = await supabase
          .from("child_club_points")
          .select("points")
          .eq("child_id", forChildId)
          .eq("club_id", reward.club_id)
          .maybeSingle();
        const childClubPoints = clubPts?.points ?? 0;
        if (childClubPoints < reward.points_required) {
          throw new Error(`${child.name} doesn't have enough points at this club`);
        }
        pointsSource = { id: forChildId, points: childClubPoints, isChild: true };
        childName = child.name;
      } else {
        const { data: clubPts } = await supabase
          .from("user_club_points")
          .select("points")
          .eq("user_id", user!.id)
          .eq("club_id", reward.club_id)
          .maybeSingle();
        const userClubPoints = clubPts?.points ?? 0;
        if (userClubPoints < reward.points_required) {
          throw new Error("Not enough points at this club");
        }
        pointsSource = { id: user!.id, points: userClubPoints, isChild: false };
      }

      // Create redemption record with optional child_id
      const { error: redemptionError } = await supabase
        .from("reward_redemptions")
        .insert({
          user_id: user!.id,
          reward_id: reward.id,
          club_id: reward.club_id,
          points_spent: reward.points_required,
          child_id: forChildId,
        });

      if (redemptionError) throw redemptionError;

      // Deduct points atomically from the appropriate source — scoped to this club
      if (pointsSource.isChild) {
        const { data: childNewBalance } = await (supabase.rpc as any)('increment_child_ignite_points', {
          _child_id: pointsSource.id,
          _amount: -reward.points_required,
          _club_id: reward.club_id,
        });

        await recordPointsHistory({
          childId: pointsSource.id,
          clubId: reward.club_id,
          amount: -reward.points_required,
          balanceAfter: childNewBalance || 0,
          sourceType: 'redemption',
          sourceId: reward.id,
          description: `Redeemed: ${reward.name}`,
        });
      } else {
        const { data: newBalance } = await (supabase.rpc as any)('increment_ignite_points', {
          _user_id: user!.id,
          _amount: -reward.points_required,
          _club_id: reward.club_id,
        });

        await recordPointsHistory({
          userId: user!.id,
          clubId: reward.club_id,
          amount: -reward.points_required,
          balanceAfter: newBalance || 0,
          sourceType: 'redemption',
          sourceId: reward.id,
          description: `Redeemed: ${reward.name}`,
        });
      }

      // Get club details for email
      const { data: club } = await supabase
        .from("clubs")
        .select("name, logo_url")
        .eq("id", reward.club_id)
        .single();

      // Get sponsor name if applicable
      let sponsorName: string | undefined;
      if (reward.sponsors?.name) {
        sponsorName = reward.sponsors.name;
      }

      // Send email notification
      try {
        await supabase.rpc('send_reward_redeemed_email_rpc', {
          _reward_name: reward.name,
          _points_spent: reward.points_required,
          _remaining_points: Math.max(0, pointsSource.points - reward.points_required),
          _club_name: club?.name || 'Your Club',
          _reward_description: reward.description ?? null,
          _sponsor_name: sponsorName ?? null,
          _show_qr_code: !!reward.show_qr_code,
          _club_logo_url: club?.logo_url ?? null,
          _reward_logo_url: reward.logo_url ?? null,
          _redeemed_for_child_name: childName || null,
        });
      } catch (emailErr) {
        console.error("Failed to send reward redeemed email:", emailErr);
        // Don't throw - redemption was still successful
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-redemptions"] });
      queryClient.invalidateQueries({ queryKey: ["user-children-for-rewards"] });
      refreshProfile();
      setConfirmDialogOpen(false);
      setSelectedReward(null);
      setSelectedRedeemFor("myself");
      toast({
        title: "Reward Redeemed!",
        description: "Show this to a club admin to claim your reward.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to redeem reward",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  // Mutation to mark reward as claimed
  const claimMutation = useMutation({
    mutationFn: async (redemption: { id: string; club_id: string; reward_name: string }) => {
      const { error } = await supabase
        .from("reward_redemptions")
        .update({
          status: "fulfilled",
          verified_at: new Date().toISOString(),
          verified_by: user!.id,
        })
        .eq("id", redemption.id);

      if (error) throw error;

      // Get claimer's name
      const { data: claimerProfile } = await selectCachedProfileById(user!.id);

      const claimerName = claimerProfile?.display_name || "Someone";

      // Notify club admins about the claim
      const { data: clubAdmins } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", redemption.club_id)
        .eq("role", "club_admin");

      if (clubAdmins && clubAdmins.length > 0) {
        const notifications = clubAdmins
          .filter(admin => admin.user_id !== user!.id)
          .map(admin => ({
            user_id: admin.user_id,
            type: "reward_claimed",
            message: `${claimerName} marked their "${redemption.reward_name}" reward as claimed`,
            related_id: redemption.id,
            club_id: redemption.club_id,
          }));

        if (notifications.length > 0) {
          await supabase.from("notifications").insert(notifications);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-redemptions"] });
      setClaimDialogOpen(false);
      setSelectedRedemption(null);
      toast({
        title: "Reward Claimed!",
        description: "The reward has been marked as fulfilled.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to claim reward",
        description: error.message || "Please try again",
        variant: "destructive",
      });
    },
  });

  const handleSelectReward = (reward: ClubReward) => {
    setSelectedReward(reward);
    setSelectedClubId(null); // Close the rewards dialog first
    // Use timeout to ensure the first dialog closes before opening the second
    setTimeout(() => {
      setConfirmDialogOpen(true);
    }, 100);
  };

  const handleConfirmRedeem = () => {
    if (selectedReward) {
      const forChildId = selectedRedeemFor === "myself" ? null : selectedRedeemFor;
      redeemMutation.mutate({ reward: selectedReward, forChildId });
    }
  };

  const handleClaimReward = (redemption: RewardRedemption) => {
    setSelectedRedemption(redemption);
    setClaimDialogOpen(true);
  };

  const handleConfirmClaim = () => {
    if (selectedRedemption) {
      claimMutation.mutate({
        id: selectedRedemption.id,
        club_id: selectedRedemption.club_id,
        reward_name: selectedRedemption.club_rewards?.name || "reward",
      });
    }
  };

  // Per-club balance for the active/selected club. When no club is in context,
  // fall back to 0 (the user must pick a club to redeem).
  const contextClubId = selectedClubId || activeClubFilter || (userClubs.length === 1 ? (userClubs[0] as any).id : null);
  const { data: userClubBalance = 0 } = useUserClubPoints(user?.id, contextClubId);
  const currentPoints = contextClubId ? userClubBalance : 0;

  // Fetch per-club balances for all children in this club (single query keyed
  // on club). Falls back to 0 when there is no context club.
  const childIds = useMemo(() => children.map(c => c.id).sort(), [children]);
  const { data: childClubRows = [] } = useQuery({
    queryKey: ["children-club-points", contextClubId, childIds],
    queryFn: async () => {
      if (!contextClubId || childIds.length === 0) return [] as Array<{ child_id: string; points: number }>;
      const { data } = await supabase
        .from("child_club_points")
        .select("child_id, points")
        .eq("club_id", contextClubId)
        .in("child_id", childIds);
      return (data ?? []) as Array<{ child_id: string; points: number }>;
    },
    enabled: !!contextClubId && childIds.length > 0,
    staleTime: 1000 * 30,
  });
  const childrenScoped = useMemo(() => {
    return children.map(c => {
      if (!contextClubId) return { ...c, ignite_points: 0 };
      const row = childClubRows.find(r => r.child_id === c.id);
      return { ...c, ignite_points: row?.points ?? 0 };
    });
  }, [children, contextClubId, childClubRows]);

  const pendingRedemptions = redemptions.filter(r => r.status === "pending");
  const hasClubs = userClubs.length > 0;
  const isLoadingClubsWithNoCache = isLoadingClubs && userClubs.length === 0;

  // Persist + restore the last selected child for the rewards card focus
  useEffect(() => {
    if (!user) return;
    if (activeChildId) return;
    try {
      const stored = localStorage.getItem(`ignite-rewards-active-child-${user.id}`);
      if (stored && children.some(c => c.id === stored)) {
        setActiveChildId(stored);
      }
    } catch {
      // localStorage unavailable
    }
  }, [user, children, activeChildId]);

  useEffect(() => {
    if (!user || !activeChildId) return;
    try {
      localStorage.setItem(`ignite-rewards-active-child-${user.id}`, activeChildId);
    } catch {
      // localStorage unavailable
    }
  }, [activeChildId, user]);

  // Determine the focus context: the active child (if any) or the user themselves.
  const activeChild = useMemo(
    () => (activeChildId ? childrenScoped.find(c => c.id === activeChildId) ?? null : null),
    [activeChildId, childrenScoped]
  );
  const focusName = activeChild?.name ?? (profile?.display_name || "You");
  const focusPoints = activeChild?.ignite_points ?? currentPoints;
  const focusInitials = focusName
    .split(/\s+/)
    .map(n => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Cheapest reward the focus context cannot yet afford → next milestone
  const nextRewardTarget = useMemo(() => {
    const above = rewardThresholds.find(r => r.points_required > focusPoints);
    return above ?? rewardThresholds[rewardThresholds.length - 1] ?? null;
  }, [rewardThresholds, focusPoints]);

  const progressMax = nextRewardTarget?.points_required ?? 0;
  const progressPct = progressMax > 0 ? Math.min(100, (focusPoints / progressMax) * 100) : 0;
  const pointsToGo = Math.max(0, progressMax - focusPoints);
  const animatedPoints = useCountUp(focusPoints);
  const pointsLabel = (userClubs[0] as any)?.points_display_name || 'Reward Points';
  const pointsIcon = (userClubs[0] as any)?.points_icon_url as string | undefined;

  const openDefaultRewards = () => {
    const proClubs = userClubs.filter((club: any) => isAppAdmin || club.hasPro);
    if (proClubs.length === 1) {
      setSelectedClubId(proClubs[0].id);
    } else if (proClubs.length > 1) {
      // Surface the existing club picker UI by leaving selectedClubId null —
      // user can tap a club from the in-card list. As a shortcut we open the
      // first pro club so a single tap on the card does something useful.
      setSelectedClubId(proClubs[0].id);
    }
  };


  // If user has a pending redemption, show it prominently
  if (pendingRedemptions.length > 0) {
    const latestRedemption = pendingRedemptions[0];
    return (
      <>
        <Card className={`${hasClubTheme ? 'gradient-themed' : 'gradient-emerald'} border-0 overflow-hidden`}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {(userClubs[0] as any)?.points_icon_url && (
                  <img src={(userClubs[0] as any).points_icon_url} alt="" className="h-6 w-6 rounded object-cover" />
                )}
                {!(userClubs[0] as any)?.points_icon_url && <Gift className="h-6 w-6 text-primary-foreground" />}
                <span className="font-semibold text-primary-foreground">{(userClubs[0] as any)?.points_display_name || 'Reward Points'}</span>
              </div>
              <span className="text-3xl font-bold text-primary-foreground">
                {currentPoints}
              </span>
            </div>
            
            <div className="bg-amber-500/30 border border-amber-400/50 rounded-lg p-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="text-4xl">🎁</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Trophy className="h-5 w-5 text-amber-300" />
                      <span className="font-bold text-lg text-primary-foreground">
                        Reward Ready!
                      </span>
                    </div>
                    <p className="font-medium text-primary-foreground mt-1">
                      {latestRedemption.club_rewards?.name}
                    </p>
                    {latestRedemption.child_id && latestRedemption.children && (
                      <p className="text-sm text-primary-foreground/90">
                        For {latestRedemption.children.name}
                      </p>
                    )}
                    <p className="text-sm text-primary-foreground/90">
                      Ready to mark as claimed
                    </p>
                  </div>
                  <Badge className="bg-amber-400 text-amber-900">Pending</Badge>
                </div>
                
                <div className="flex gap-2">
                  {/* Show QR button if reward has QR code configured */}
                  {latestRedemption.club_rewards?.show_qr_code && latestRedemption.club_rewards?.qr_code_url && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1 bg-primary-foreground/20 hover:bg-primary-foreground/30 text-primary-foreground border-0"
                      onClick={() => {
                        setSelectedRedemption(latestRedemption);
                        setQrDialogOpen(true);
                      }}
                    >
                      <QrCode className="h-4 w-4 mr-2" />
                      Show QR Code
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    className={`${latestRedemption.club_rewards?.show_qr_code && latestRedemption.club_rewards?.qr_code_url ? 'flex-1' : 'w-full'} bg-primary-foreground/20 hover:bg-primary-foreground/30 text-primary-foreground border-0`}
                    onClick={() => handleClaimReward(latestRedemption)}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Mark as Claimed
                  </Button>
                </div>
              </div>
            </div>

            {pendingRedemptions.length > 1 && (
              <p className="text-xs text-primary-foreground/70 mt-2">
                +{pendingRedemptions.length - 1} more pending reward{pendingRedemptions.length > 2 ? "s" : ""}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Claim Confirmation Dialog */}
        <AlertDialog 
          open={claimDialogOpen} 
          onOpenChange={(open) => {
            if (!claimMutation.isPending) {
              setClaimDialogOpen(open);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Mark Reward as Claimed?</AlertDialogTitle>
              <AlertDialogDescription>
                Confirm that <strong>{selectedRedemption?.club_rewards?.name}</strong> has been given to the member.
                <br /><br />
                This will mark the reward as fulfilled and cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={claimMutation.isPending}>Cancel</AlertDialogCancel>
              <Button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleConfirmClaim();
                }}
                disabled={claimMutation.isPending}
              >
                {claimMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                {claimMutation.isPending ? "Confirming..." : "Confirm Claimed"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* QR Code Dialog */}
        {selectedRedemption && (
          <RewardClaimQRDialog
            open={qrDialogOpen}
            onOpenChange={setQrDialogOpen}
            rewardName={selectedRedemption.club_rewards?.name || "Reward"}
            clubName={selectedRedemption.clubs?.name || "Club"}
            redemptionId={selectedRedemption.id}
            qrCodeUrl={selectedRedemption.club_rewards?.qr_code_url || null}
            userName={profile?.display_name || undefined}
            userId={user?.id || ""}
          />
        )}
      </>
    );
  }

  const proClubs = userClubs.filter((club: any) => isAppAdmin || club.hasPro);
  const hasMultipleProClubs = proClubs.length > 1;
  const hasMultipleClubs = userClubs.length > 1;
  const cardIsTappable = hasClubs && proClubs.length > 0 && !isLoadingClubsWithNoCache;

  return (
    <>
      <Card
        onClick={cardIsTappable ? openDefaultRewards : undefined}
        className={`${hasClubTheme ? 'gradient-themed' : 'gradient-emerald'} relative border-0 overflow-hidden ${cardIsTappable ? 'cursor-pointer transition-transform active:scale-[0.99]' : ''}`}
      >
        {/* Soft inner highlight for depth */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_0%_0%,hsl(0_0%_100%/0.18),transparent_55%)]"
        />
        <CardContent className="relative p-4 sm:p-5">
          {/* HEADER ROW */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-2 min-w-0">
              {pointsIcon ? (
                <img src={pointsIcon} alt="" className="h-6 w-6 rounded object-cover shrink-0" />
              ) : (
                <Gift className="h-5 w-5 text-primary-foreground shrink-0" />
              )}
              <span className="font-semibold text-primary-foreground truncate">
                {pointsLabel}
              </span>
            </div>
            <div className="text-right leading-tight">
              <div className="text-3xl font-bold text-primary-foreground tabular-nums">
                {animatedPoints}
                <span className="text-base font-medium text-primary-foreground/80 ml-1">pts</span>
              </div>
              {weeklyDelta > 0 && (
                <div className="text-[11px] font-medium text-primary-foreground/85 mt-0.5 flex items-center justify-end gap-1">
                  <Flame className="h-3 w-3" />
                  +{weeklyDelta} this week
                </div>
              )}
            </div>
          </div>

          {/* ACTIVE CHILD / SELF CONTEXT */}
          {(children.length > 0 || activeChild) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (children.length > 0) setChildSwitcherOpen(true);
              }}
              disabled={children.length === 0}
              className="w-full flex items-center gap-2 mb-3 rounded-lg bg-primary-foreground/10 px-2.5 py-1.5 text-left transition-colors hover:bg-primary-foreground/15 disabled:cursor-default"
            >
              <Avatar className="h-7 w-7 ring-1 ring-primary-foreground/30">
                <AvatarImage src={activeChild ? undefined : profile?.avatar_url || undefined} />
                <AvatarFallback className="bg-primary-foreground/20 text-primary-foreground text-[11px] font-semibold">
                  {focusInitials || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-primary-foreground/70 leading-none">
                  {activeChild ? "Tracking" : "Your points"}
                </div>
                <div className="text-sm font-medium text-primary-foreground truncate">
                  {focusName}
                </div>
              </div>
              <span className="text-xs font-semibold text-primary-foreground tabular-nums">
                {focusPoints} pts
              </span>
              {children.length > 0 && (
                <ChevronsUpDown className="h-3.5 w-3.5 text-primary-foreground/70 shrink-0" />
              )}
            </button>
          )}

          {/* PROGRESS / GOAL */}
          {nextRewardTarget && progressMax > 0 && (
            <div className="mb-3">
              <div className="flex items-center justify-between text-xs text-primary-foreground/85 mb-1">
                <span className="font-medium truncate pr-2">
                  Next reward: {nextRewardTarget.name}
                </span>
                <span className="tabular-nums shrink-0">
                  {focusPoints} / {progressMax}
                </span>
              </div>
              <Progress
                value={progressPct}
                className="h-2 bg-primary-foreground/15 [&>div]:bg-primary-foreground"
              />
              <div className="text-[11px] text-primary-foreground/80 mt-1">
                {pointsToGo > 0
                  ? `${pointsToGo} pts to go`
                  : "Ready to redeem 🎉"}
              </div>
            </div>
          )}

          {/* PRIMARY ACTION + CLUB CONTEXT */}
          {isLoadingClubsWithNoCache ? (
            <div className="bg-primary-foreground/10 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary-foreground" />
                <p className="text-sm text-primary-foreground">Loading clubs...</p>
              </div>
            </div>
          ) : hasClubs && proClubs.length > 0 ? (
            <div className="space-y-2">
              <Button
                className="w-full bg-primary-foreground/20 hover:bg-primary-foreground/30 text-primary-foreground border-0"
                variant="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  openDefaultRewards();
                }}
              >
                <Gift className="h-4 w-4 mr-2" />
                Browse Rewards
                <ChevronRight className="h-4 w-4 ml-auto" />
              </Button>
              {hasMultipleProClubs && (
                <p className="text-[11px] text-primary-foreground/70 text-center">
                  You belong to {proClubs.length} clubs — pick one inside.
                </p>
              )}
            </div>
          ) : hasClubs ? (
            <div className="bg-primary-foreground/10 rounded-lg p-3">
              <p className="text-sm text-primary-foreground">
                Rewards unlock when your club upgrades to Pro.
              </p>
            </div>
          ) : (
            <div className="bg-primary-foreground/10 rounded-lg p-3">
              <p className="text-sm text-primary-foreground">
                Join a club to start earning and redeeming rewards!
              </p>
            </div>
          )}

          {/* SECONDARY MICRO CTA */}
          <div className="mt-2 text-center">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setHowToEarnOpen(true);
              }}
              className="text-xs font-medium text-primary-foreground/85 hover:text-primary-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
            >
              <HelpCircle className="h-3 w-3" />
              How to earn points
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Child switcher */}
      <Dialog open={childSwitcherOpen} onOpenChange={setChildSwitcherOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Switch focus</DialogTitle>
            <DialogDescription>
              Choose whose points to track on the rewards card.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => {
                setActiveChildId(null);
                setChildSwitcherOpen(false);
              }}
              className={`w-full flex items-center gap-3 rounded-lg p-3 text-left transition-colors ${
                !activeChildId ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted"
              }`}
            >
              <Avatar className="h-9 w-9">
                <AvatarImage src={profile?.avatar_url || undefined} />
                <AvatarFallback>
                  {(profile?.display_name || "Y").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {profile?.display_name || "You"}
                </div>
                <div className="text-xs text-muted-foreground">Your points</div>
              </div>
              <Badge variant="outline" className="tabular-nums">{currentPoints} pts</Badge>
            </button>
            {childrenScoped.map(child => {
              const initials = child.name
                .split(/\s+/).map(n => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
              return (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => {
                    setActiveChildId(child.id);
                    setChildSwitcherOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 rounded-lg p-3 text-left transition-colors ${
                    activeChildId === child.id ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted"
                  }`}
                >
                  <Avatar className="h-9 w-9">
                    <AvatarFallback>{initials || "?"}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{child.name}</div>
                    <div className="text-xs text-muted-foreground">Child</div>
                  </div>
                  <Badge variant="outline" className="tabular-nums">{child.ignite_points} pts</Badge>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* How to earn points */}
      <PointsHowToEarnSheet
        open={howToEarnOpen}
        onOpenChange={setHowToEarnOpen}
        pointsLabel={pointsLabel}
      />

      {/* Club Rewards Dialog */}
      <Dialog open={!!selectedClubId} onOpenChange={() => setSelectedClubId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5" />
              Available Rewards
            </DialogTitle>
            <DialogDescription>
              {children.length > 0 
                ? `You have ${currentPoints} points (+ children's points)`
                : `You have ${currentPoints} points to spend`
              }
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-3 pt-2">
            {rewardsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : availableRewards.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No rewards available yet. Check back later!
              </p>
            ) : (
              <>
                {/* Featured reward first */}
                {availableRewards.filter(r => r.is_default).map((reward) => {
                  const canAffordSelf = currentPoints >= reward.points_required;
                  const canAffordAnyChild = childrenScoped.some(c => c.ignite_points >= reward.points_required);
                  const canAfford = canAffordSelf || canAffordAnyChild;
                  return (
                    <div
                      key={reward.id}
                      className={`p-4 rounded-lg border-2 ${
                        canAfford 
                          ? "border-yellow-500 bg-yellow-500/10" 
                          : "border-yellow-500/50 bg-yellow-500/5 opacity-70"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                        <span className="text-xs font-medium text-yellow-600 dark:text-yellow-400">Featured Reward</span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        {reward.logo_url && (
                          <img src={reward.logo_url} alt={reward.name || "Reward logo"} className="h-12 w-12 rounded-lg object-cover shrink-0" />
                        )}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{reward.name}</span>
                            <Badge variant="outline">{reward.points_required} pts</Badge>
                          </div>
                          {reward.description && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {reward.description}
                            </p>
                          )}
                          {reward.sponsors && (
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              Sponsored by {reward.sponsors.name}
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          disabled={!canAfford}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleSelectReward(reward);
                          }}
                        >
                          {canAfford ? "Redeem" : `Need ${reward.points_required} pts`}
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {/* Other rewards */}
                {availableRewards.filter(r => !r.is_default).map((reward) => {
                  const canAffordSelf = currentPoints >= reward.points_required;
                  const canAffordAnyChild = childrenScoped.some(c => c.ignite_points >= reward.points_required);
                  const canAfford = canAffordSelf || canAffordAnyChild;
                  return (
                    <div
                      key={reward.id}
                      className={`p-4 rounded-lg border ${
                        canAfford 
                          ? "border-primary/50 bg-primary/5" 
                          : "border-muted bg-muted/30 opacity-60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        {reward.logo_url && (
                          <img src={reward.logo_url} alt={reward.name || "Reward logo"} className="h-12 w-12 rounded-lg object-cover shrink-0" />
                        )}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{reward.name}</span>
                            <Badge variant="outline">{reward.points_required} pts</Badge>
                          </div>
                          {reward.description && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {reward.description}
                            </p>
                          )}
                          {reward.sponsors && (
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              Sponsored by {reward.sponsors.name}
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          disabled={!canAfford}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleSelectReward(reward);
                          }}
                        >
                          {canAfford ? "Redeem" : `Need ${reward.points_required} pts`}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm Redemption Dialog */}
      <AlertDialog 
        open={confirmDialogOpen} 
        onOpenChange={(open) => {
          if (!redeemMutation.isPending) {
            setConfirmDialogOpen(open);
            if (!open) setSelectedRedeemFor("myself");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Redeem Reward?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <p>
                  You're about to redeem <strong>{selectedReward?.name}</strong> for{" "}
                  <strong>{selectedReward?.points_required} points</strong>.
                </p>
                
                {childrenScoped.filter(c => c.ignite_points >= (selectedReward?.points_required || 0)).length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="redeem-for" className="text-foreground">Redeem for:</Label>
                    <Select value={selectedRedeemFor} onValueChange={setSelectedRedeemFor}>
                      <SelectTrigger id="redeem-for">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="myself">
                          <div className="flex items-center gap-2">
                            <span>Myself</span>
                            <Badge variant="outline" className="text-xs">{currentPoints} pts</Badge>
                          </div>
                        </SelectItem>
                        {childrenScoped.map(child => (
                          <SelectItem key={child.id} value={child.id}>
                            <div className="flex items-center gap-2">
                              <Users className="h-3 w-3" />
                              <span>{child.name}</span>
                              <Badge variant="outline" className="text-xs">{child.ignite_points} pts</Badge>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedRedeemFor !== "myself" && (
                      <p className="text-xs text-muted-foreground">
                        Points will be deducted from {children.find(c => c.id === selectedRedeemFor)?.name}'s balance.
                      </p>
                    )}
                  </div>
                )}
                
                <p className="text-muted-foreground">
                  After redemption, show this reward to a club admin to claim it.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={redeemMutation.isPending}>Cancel</AlertDialogCancel>
            <Button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleConfirmRedeem();
              }}
              disabled={redeemMutation.isPending || (
                selectedRedeemFor === "myself" 
                  ? currentPoints < (selectedReward?.points_required || 0)
                  : (childrenScoped.find(c => c.id === selectedRedeemFor)?.ignite_points || 0) < (selectedReward?.points_required || 0)
              )}
            >
              {redeemMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {redeemMutation.isPending ? "Redeeming..." : "Confirm Redemption"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
