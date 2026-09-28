import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trophy, Loader2, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfileById } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { recordPointsHistory } from "@/lib/pointsHistory";

interface PlayerOfMatchSelectorProps {
  eventId: string;
  clubId: string;
  teamId?: string | null;
  isAdmin: boolean;
  rsvps: any[];
  childrenOnTeam?: any[];
}

export default function PlayerOfMatchSelector({
  eventId,
  clubId,
  teamId,
  isAdmin,
  rsvps,
  childrenOnTeam = [],
}: PlayerOfMatchSelectorProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectDialogOpen, setSelectDialogOpen] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [selectedReward, setSelectedReward] = useState<any | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const lastRewardStorageKey = useMemo(
    () => `pom-last-reward:${clubId}:${teamId ?? "club"}`,
    [clubId, teamId]
  );

  const childNameFallbacks = useMemo(() => {
    const names = new Map<string, string>();
    [...(childrenOnTeam || []), ...(rsvps || []).map((rsvp: any) => rsvp.children)].forEach((child: any) => {
      const id = child?.id || child?.child_id;
      const name = typeof child?.name === "string" ? child.name.trim() : "";
      if (id && name) names.set(id, name);
    });
    return names;
  }, [childrenOnTeam, rsvps]);

  const profileFallbacks = useMemo(() => {
    const profiles = new Map<string, { display_name: string | null; avatar_url: string | null }>();
    (rsvps || []).forEach((rsvp: any) => {
      const name = typeof rsvp.profiles?.display_name === "string" ? rsvp.profiles.display_name.trim() : "";
      if (rsvp.user_id && name) {
        profiles.set(rsvp.user_id, {
          display_name: name,
          avatar_url: rsvp.profiles?.avatar_url || null,
        });
      }
    });
    return profiles;
  }, [rsvps]);

  const setSelectedRewardPersisted = (reward: any | null) => {
    setSelectedReward(reward);
    try {
      if (reward?.id) localStorage.setItem(lastRewardStorageKey, reward.id);
    } catch {}
  };

  // Fetch current player of match
  const { data: playerOfMatch, isLoading } = useQuery({
    queryKey: ["player-of-match", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_of_match")
        .select("*")
        .eq("event_id", eventId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      // Fetch related profile / child separately. The previous inline
      // `children:child_id(...)` embed was silently returning null because
      // PostgREST treated `child_id` as a table name, not an FK column hint,
      // so the card rendered an empty name + "?" avatar.
      let profile: any = null;
      let child: any = null;
      if (data.user_id) {
        const { data: p } = await selectCachedProfileById(data.user_id);
        profile = p || profileFallbacks.get(data.user_id) || null;
      }
      if (data.child_id) {
        const { data: c } = await supabase
          .from("children")
          .select("id, name")
          .eq("id", data.child_id)
          .maybeSingle();
        child = c || (childNameFallbacks.has(data.child_id)
          ? { id: data.child_id, name: childNameFallbacks.get(data.child_id)! }
          : null);
      }

      return { ...data, profiles: profile, children: child };
    },
  });

  const playerOfMatchDisplay = useMemo(() => {
    if (!playerOfMatch) return null;
    const profileName = typeof playerOfMatch.profiles?.display_name === "string"
      ? playerOfMatch.profiles.display_name.trim()
      : "";
    const childName = typeof playerOfMatch.children?.name === "string"
      ? playerOfMatch.children.name.trim()
      : "";
    const fallbackProfile = playerOfMatch.user_id ? profileFallbacks.get(playerOfMatch.user_id) : null;
    const fallbackProfileName = typeof fallbackProfile?.display_name === "string"
      ? fallbackProfile.display_name.trim()
      : "";
    const fallbackChildName = playerOfMatch.child_id
      ? childNameFallbacks.get(playerOfMatch.child_id) || ""
      : "";
    const name = profileName || childName || fallbackProfileName || fallbackChildName || "Unknown player";

    return {
      name,
      avatarUrl: playerOfMatch.profiles?.avatar_url || fallbackProfile?.avatar_url || null,
      initial: name.charAt(0).toUpperCase(),
      isChild: !!playerOfMatch.child_id,
    };
  }, [childNameFallbacks, playerOfMatch, profileFallbacks]);

  // Fetch POM rewards - team-specific first, then club-level fallback
  const { data: pomRewards = [] } = useQuery({
    queryKey: ["pom-rewards", clubId, teamId],
    queryFn: async () => {
      // First try team-specific rewards
      if (teamId) {
        const { data: teamRewards, error: teamError } = await supabase
          .from("club_rewards")
          .select("*")
          .eq("club_id", clubId)
          .eq("team_id", teamId)
          .eq("reward_type", "player_of_match")
          .eq("is_active", true)
          .order("created_at", { ascending: true });
        
        if (!teamError && teamRewards && teamRewards.length > 0) {
          return teamRewards;
        }
      }
      
      // Fall back to club-level rewards (team_id is null)
      const { data, error } = await supabase
        .from("club_rewards")
        .select("*")
        .eq("club_id", clubId)
        .is("team_id", null)
        .eq("reward_type", "player_of_match")
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      
      if (error) throw error;
      return data || [];
    },
  });

  // Rehydrate last-used reward when rewards load / dialog opens
  useEffect(() => {
    if (selectedReward || pomRewards.length === 0) return;
    try {
      const lastId = localStorage.getItem(lastRewardStorageKey);
      if (lastId) {
        const found = pomRewards.find((r: any) => r.id === lastId);
        if (found) setSelectedReward(found);
      }
    } catch {}
  }, [pomRewards, lastRewardStorageKey, selectedReward]);

  // Use selected reward or default to first available
  const activePomReward = selectedReward || (pomRewards.length === 1 ? pomRewards[0] : null);

  // Award POM mutation
  const awardMutation = useMutation({
    mutationFn: async ({ userId, childId }: { userId?: string; childId?: string }) => {
      // Points to award - 0 if no reward configured
      const rewardToUse = activePomReward;
      const pointsToAward = rewardToUse?.points_required || 0;

      // Insert player of match record
      const { error: pomError } = await supabase.from("player_of_match").insert({
        event_id: eventId,
        user_id: userId || null,
        child_id: childId || null,
        awarded_by: user!.id,
        points_awarded: pointsToAward > 0,
        points: pointsToAward,
      } as any);

      if (pomError) throw pomError;

      // Only award points if there's a reward configured
      if (pointsToAward > 0) {
        if (userId) {
          // Atomic points increment
          const { data: newBalance, error: updateError } = await (supabase.rpc as any)('increment_ignite_points', {
            _user_id: userId,
            _amount: pointsToAward,
            _club_id: clubId,
          });

          if (updateError) throw updateError;

          const balanceAfter = newBalance || 0;
          const previousPoints = balanceAfter - pointsToAward;

          // Record in points history
          await recordPointsHistory({
            userId,
            clubId,
            amount: pointsToAward,
            balanceAfter,
            sourceType: 'player_of_match',
            sourceId: eventId,
            description: 'Player of the Match award',
            createdBy: user!.id,
          });

          // Check reward threshold
          const { checkRewardThreshold } = await import("@/lib/rewardThresholdCheck");
          const rewardName = await checkRewardThreshold({
            userId,
            clubId,
            previousPoints,
            newPoints: balanceAfter,
          });

          // Send notification with points
          await supabase.from("notifications").insert({
            user_id: userId,
            type: "player_of_match",
            message: rewardName
              ? `🏆 Congratulations! You were selected as Player of the Match and earned ${pointsToAward} points! 🎁 Reward unlocked: ${rewardName}!`
              : `🏆 Congratulations! You were selected as Player of the Match and earned ${pointsToAward} points!`,
            related_id: eventId,
          });
        } else if (childId) {
          // Atomic child points increment
          const { data: childNewBalance, error: childUpdateError } = await (supabase.rpc as any)('increment_child_ignite_points', {
            _child_id: childId,
            _amount: pointsToAward,
            _club_id: clubId,
          });

          if (childUpdateError) throw childUpdateError;

          const childBalanceAfter = childNewBalance || 0;
          const previousChildPoints = childBalanceAfter - pointsToAward;

          // Get child info for notification
          const { data: child } = await supabase
            .from("children")
            .select("parent_id, name")
            .eq("id", childId)
            .single();

          // Record in points history for child
          await recordPointsHistory({
            childId,
            clubId,
            amount: pointsToAward,
            balanceAfter: childBalanceAfter,
            sourceType: 'player_of_match',
            sourceId: eventId,
            description: `Player of the Match award for ${child?.name}`,
            createdBy: user!.id,
          });

          // Check reward threshold for child
          const { checkRewardThreshold: checkChildReward } = await import("@/lib/rewardThresholdCheck");
          const childRewardName = await checkChildReward({
            childId,
            clubId,
            previousPoints: previousChildPoints,
            newPoints: childBalanceAfter,
          });

          // Notify parent with points
          if (child?.parent_id) {
            await supabase.from("notifications").insert({
              user_id: child.parent_id,
              type: "player_of_match",
              message: childRewardName
                ? `🏆 ${child.name} was selected as Player of the Match and earned ${pointsToAward} points! 🎁 Reward unlocked: ${childRewardName}!`
                : `🏆 ${child.name} was selected as Player of the Match and earned ${pointsToAward} points!`,
              related_id: eventId,
            });
          }
        }
      } else {
        // Send notification without points
        if (userId) {
          await supabase.from("notifications").insert({
            user_id: userId,
            type: "player_of_match",
            message: `🏆 Congratulations! You were selected as Player of the Match!`,
            related_id: eventId,
          });
        } else if (childId) {
          const { data: child } = await supabase
            .from("children")
            .select("parent_id, name")
            .eq("id", childId)
            .single();

          if (child?.parent_id) {
            await supabase.from("notifications").insert({
              user_id: child.parent_id,
              type: "player_of_match",
              message: `🏆 ${child.name} was selected as Player of the Match!`,
              related_id: eventId,
            });
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["player-of-match", eventId] });
      setSelectDialogOpen(false);
      setPendingId(null);
      toast({ title: "Player of the Match awarded! 🏆" });
    },
    onError: (error: Error) => {
      setPendingId(null);
      toast({ title: error.message || "Failed to award Player of the Match", variant: "destructive" });
    },
  });

  // Remove POM mutation
  const removeMutation = useMutation({
    mutationFn: async () => {
      if (!playerOfMatch) return;

      const pointsToDeduct = Number((playerOfMatch as any).points) || 0;

      // Delete the POM row FIRST so a points-side failure can't leave the
      // award visible while points are already deducted (which previously
      // caused "Failed to remove" loops + double-deductions on retry).
      const { error: deleteError } = await supabase
        .from("player_of_match")
        .delete()
        .eq("id", playerOfMatch.id);

      if (deleteError) throw deleteError;

      // Best-effort points deduction + history. Failures here are logged
      // but don't roll back the removal (the award is already gone in UI).
      try {
        if (playerOfMatch.user_id) {
          const { data: newBalance } = await (supabase.rpc as any)('increment_ignite_points', {
            _user_id: playerOfMatch.user_id,
            _amount: -pointsToDeduct,
            _club_id: clubId,
          });
          if (pointsToDeduct > 0) {
            await recordPointsHistory({
              userId: playerOfMatch.user_id,
              clubId,
              amount: -pointsToDeduct,
              balanceAfter: newBalance || 0,
              sourceType: 'pom_removed',
              sourceId: eventId,
              description: 'Player of the Match award removed',
              createdBy: user!.id,
            });
          }
        } else if (playerOfMatch.child_id) {
          const { data: childNewBalance } = await (supabase.rpc as any)('increment_child_ignite_points', {
            _child_id: playerOfMatch.child_id,
            _amount: -pointsToDeduct,
            _club_id: clubId,
          });
          if (pointsToDeduct > 0) {
            await recordPointsHistory({
              childId: playerOfMatch.child_id,
              clubId,
              amount: -pointsToDeduct,
              balanceAfter: childNewBalance || 0,
              sourceType: 'pom_removed',
              sourceId: eventId,
              description: 'Player of the Match award removed',
              createdBy: user!.id,
            });
          }
        }
      } catch (e) {
        console.error("[POM remove] points cleanup failed (award already removed):", e);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["player-of-match", eventId] });
      setRemoveDialogOpen(false);
      toast({ title: "Player of the Match removed" });
    },
    onError: (error: any) => {
      console.error("[POM remove] failed", error);
      toast({
        title: error?.message || "Failed to remove Player of the Match",
        variant: "destructive",
      });
    },
  });

  // Fetch user_ids that have the 'player' role on this team so we can exclude
  // parents, coaches, admins etc. from the POM list. Children are always players.
  const { data: playerUserIds = [] } = useQuery({
    queryKey: ["team-player-user-ids", teamId],
    queryFn: async () => {
      if (!teamId) return [] as string[];
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("team_id", teamId)
        .eq("role", "player");
      if (error) throw error;
      return (data || []).map((r: any) => r.user_id);
    },
    enabled: !!teamId,
  });

  // Get eligible players (going RSVPs)
  const goingPlayers = rsvps?.filter((r) => r.status === "going") || [];
  const goingChildren = goingPlayers.filter((r) => r.child_id);
  const goingMembers = goingPlayers.filter(
    (r) => !r.child_id && r.user_id && playerUserIds.includes(r.user_id)
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Display current POM or award button
  return (
    <>
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Trophy className="h-5 w-5 text-amber-500" />
            Player of the Match
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {playerOfMatch ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10 ring-2 ring-amber-500">
                  {playerOfMatchDisplay?.avatarUrl && (
                    <AvatarImage src={playerOfMatchDisplay.avatarUrl} />
                  )}
                  <AvatarFallback className="bg-amber-500/20 text-amber-600">
                    {playerOfMatchDisplay?.initial || "?"}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">
                      {playerOfMatchDisplay?.name || "Unknown player"}
                    </span>
                    {playerOfMatchDisplay?.isChild && (
                      <Badge variant="outline" className="text-xs">Child</Badge>
                    )}
                  </div>
                  {(() => {
                    const pts = (playerOfMatch as any).points ?? 0;
                    const matched = pomRewards.find((r: any) => r.points_required === pts);
                    return (
                      <div className="flex items-center gap-1 text-sm text-amber-600">
                        <Star className="h-3 w-3 fill-current" />
                        <span>
                          Awarded a voucher{matched?.name ? `: ${matched.name}` : ""}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  onClick={() => setRemoveDialogOpen(true)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ) : isAdmin ? (
             <div className="space-y-2">
              {/* Inline voucher picker when multiple vouchers exist */}
              {pomRewards.length > 1 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">
                    Voucher to award:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {pomRewards.map((reward: any) => {
                      const isActive = activePomReward?.id === reward.id;
                      return (
                        <Button
                          key={reward.id}
                          variant={isActive ? "default" : "outline"}
                          size="sm"
                          className="text-xs"
                          onClick={() => setSelectedRewardPersisted(reward)}
                        >
                          <Trophy className="h-3 w-3 mr-1" />
                          {reward.name}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}

              <Button
                variant="outline"
                className="w-full border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                onClick={() => setSelectDialogOpen(true)}
                disabled={
                  goingPlayers.length === 0 ||
                  (pomRewards.length > 1 && !activePomReward)
                }
              >
                <Trophy className="h-4 w-4 mr-2" />
                Select Player of the Match
              </Button>
              {goingPlayers.length === 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  No players RSVP'd as "Going" yet
                </p>
              )}
              {pomRewards.length > 1 && !activePomReward && goingPlayers.length > 0 && (
                <p className="text-xs text-destructive text-center">
                  Select a voucher above to continue.
                </p>
              )}
              {pomRewards.length === 0 && goingPlayers.length > 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  No voucher configured. Add a "Player of the Match" reward in Club Rewards to award a voucher.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No Player of the Match selected yet
            </p>
          )}
        </CardContent>
      </Card>

      {/* Select POM Dialog */}
      <ResponsiveDialog open={selectDialogOpen} onOpenChange={setSelectDialogOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader className="text-left border-b pb-4">
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-500" />
              Select Player of the Match
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
            <div className="p-4 space-y-2">
              {/* Voucher selector — always show inside the dialog so the admin
                  can pick the voucher type just before choosing a player. */}
              {pomRewards.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">
                    Voucher to award:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {pomRewards.map((reward: any) => {
                      const isActive = activePomReward?.id === reward.id;
                      return (
                        <Button
                          key={reward.id}
                          variant={isActive ? "default" : "outline"}
                          size="sm"
                          className="text-xs"
                          onClick={() => setSelectedRewardPersisted(reward)}
                        >
                          <Trophy className="h-3 w-3 mr-1" />
                          {reward.name}
                          
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}

              {activePomReward ? (
                <p className="text-sm text-muted-foreground mb-4">
                  The selected player will receive <strong>{activePomReward.points_required} points</strong> and the "{activePomReward.name}" voucher.
                </p>
              ) : pomRewards.length > 1 ? (
                <p className="text-sm text-muted-foreground mb-4">
                  Pick a voucher above, then choose the player who stood out this match.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground mb-4">
                  Select the player who stood out this match. No voucher is currently configured.
                </p>
              )}
              
              {/* Members */}
              {goingMembers.map((rsvp: any) => (
                <Button
                  key={rsvp.id}
                  variant="outline"
                  className="w-full justify-start h-auto py-4"
                  onClick={() => {
                    setPendingId(rsvp.user_id);
                    awardMutation.mutate({ userId: rsvp.user_id });
                  }}
                  disabled={awardMutation.isPending || (pomRewards.length > 1 && !activePomReward)}
                >
                  <Avatar className="h-10 w-10 mr-3">
                    <AvatarImage src={rsvp.profiles?.avatar_url} />
                    <AvatarFallback>
                      {rsvp.profiles?.display_name?.charAt(0)?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-base">{rsvp.profiles?.display_name || "Unknown"}</span>
                  {awardMutation.isPending && pendingId === rsvp.user_id && (
                    <Loader2 className="h-4 w-4 animate-spin ml-auto" />
                  )}
                </Button>
              ))}

              {/* Children */}
              {goingChildren.map((rsvp: any) => (
                <Button
                  key={rsvp.id}
                  variant="outline"
                  className="w-full justify-start h-auto py-4"
                  onClick={() => {
                    setPendingId(rsvp.child_id);
                    awardMutation.mutate({ childId: rsvp.child_id });
                  }}
                  disabled={awardMutation.isPending || (pomRewards.length > 1 && !activePomReward)}
                >
                  <Avatar className="h-10 w-10 mr-3">
                    <AvatarFallback className="bg-secondary">
                      {rsvp.children?.name?.charAt(0)?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-base">{rsvp.children?.name || "Unknown"}</span>
                  <Badge variant="outline" className="ml-2 text-xs">Child</Badge>
                  {awardMutation.isPending && pendingId === rsvp.child_id && (
                    <Loader2 className="h-4 w-4 animate-spin ml-auto" />
                  )}
                </Button>
              ))}

              {goingMembers.length + goingChildren.length === 0 && (
                <p className="text-center text-muted-foreground py-8">
                  No eligible players found. Only members with the "Player" role and children on the team can be selected.
                </p>
              )}
            </div>
          </div>
          <div className="p-4 border-t">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setSelectDialogOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Remove POM Confirmation */}
      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Player of the Match?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the Player of the Match selection and deduct {(playerOfMatch as any)?.points ?? 0} points from{" "}
              {playerOfMatchDisplay?.name || "this player"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeMutation.mutate()}
              className="bg-destructive text-destructive-foreground"
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Remove"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}