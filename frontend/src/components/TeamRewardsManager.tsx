import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trophy, Loader2, Plus, Pencil, Trash2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogFooter,
  ResponsiveDialogTitle,
  ResponsiveDialogClose,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface TeamReward {
  id: string;
  club_id: string;
  team_id: string | null;
  name: string;
  description: string | null;
  points_required: number;
  is_active: boolean;
  reward_type: string;
  created_at: string;
}

interface TeamRewardsManagerProps {
  teamId: string;
  clubId: string;
  disableTeamOverrides?: boolean;
}

export default function TeamRewardsManager({ teamId, clubId, disableTeamOverrides = false }: TeamRewardsManagerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingReward, setEditingReward] = useState<TeamReward | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pointsRequired, setPointsRequired] = useState(10);

  // Fetch team-specific POM rewards (multiple)
  const { data: teamRewards = [], isLoading: isTeamRewardsLoading } = useQuery({
    queryKey: ["team-pom-rewards", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("club_rewards")
        .select("*")
        .eq("club_id", clubId)
        .eq("team_id", teamId)
        .eq("reward_type", "player_of_match")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as TeamReward[];
    },
  });

  // Fetch club-level POM rewards (fallback/default)
  const { data: clubRewards = [], isLoading: isClubRewardsLoading } = useQuery({
    queryKey: ["club-pom-rewards", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("club_rewards")
        .select("*")
        .eq("club_id", clubId)
        .is("team_id", null)
        .eq("reward_type", "player_of_match")
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as TeamReward[];
    },
  });

  const isLoading = isTeamRewardsLoading || isClubRewardsLoading;

  // Create team-specific reward
  const createMutation = useMutation({
    mutationFn: async (reward: { name: string; description: string; points_required: number }) => {
      const { error } = await supabase.from("club_rewards").insert({
        club_id: clubId,
        team_id: teamId,
        name: reward.name,
        description: reward.description || null,
        points_required: reward.points_required,
        reward_type: "player_of_match",
        is_default: false,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-pom-rewards", teamId] });
      queryClient.invalidateQueries({ queryKey: ["pom-rewards", clubId, teamId] });
      resetForm();
      setDialogOpen(false);
      toast({ title: "Team reward created" });
    },
    onError: () => {
      toast({ title: "Failed to create reward", variant: "destructive" });
    },
  });

  // Update team-specific reward
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; name: string; description: string; points_required: number }) => {
      const { error } = await supabase
        .from("club_rewards")
        .update({
          name: updates.name,
          description: updates.description || null,
          points_required: updates.points_required,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-pom-rewards", teamId] });
      queryClient.invalidateQueries({ queryKey: ["pom-rewards", clubId, teamId] });
      resetForm();
      setDialogOpen(false);
      toast({ title: "Team reward updated" });
    },
    onError: () => {
      toast({ title: "Failed to update reward", variant: "destructive" });
    },
  });

  // Toggle active status
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from("club_rewards")
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-pom-rewards", teamId] });
      queryClient.invalidateQueries({ queryKey: ["pom-rewards", clubId, teamId] });
    },
  });

  // Delete team-specific reward
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("club_rewards").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-pom-rewards", teamId] });
      queryClient.invalidateQueries({ queryKey: ["pom-rewards", clubId, teamId] });
      toast({ title: "Team reward deleted" });
    },
  });

  const resetForm = () => {
    setName("");
    setDescription("");
    setPointsRequired(10);
    setEditingReward(null);
  };

  const handleOpenDialog = (reward?: TeamReward) => {
    if (reward) {
      setEditingReward(reward);
      setName(reward.name);
      setDescription(reward.description || "");
      setPointsRequired(reward.points_required);
    } else {
      resetForm();
    }
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      toast({ title: "Please enter a reward name", variant: "destructive" });
      return;
    }
    if (editingReward) {
      updateMutation.mutate({
        id: editingReward.id,
        name: name.trim(),
        description: description.trim(),
        points_required: pointsRequired,
      });
    } else {
      createMutation.mutate({
        name: name.trim(),
        description: description.trim(),
        points_required: pointsRequired,
      });
    }
  };

  const hasTeamRewards = teamRewards.length > 0;
  const activeRewards = hasTeamRewards ? teamRewards : clubRewards;
  const isUsingClubDefaults = !hasTeamRewards && clubRewards.length > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-amber-500" />
          <span className="font-medium">Player of the Match Rewards</span>
        </div>
        {!disableTeamOverrides && (
          <Button size="sm" variant="outline" onClick={() => handleOpenDialog()}>
            <Plus className="h-4 w-4 mr-1" />
            Add Reward
          </Button>
        )}
      </div>

      {disableTeamOverrides && teamRewards.length === 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Team-specific rewards are disabled by your club admin. The club default rewards are used for all teams.
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : activeRewards.length > 0 ? (
        <div className="space-y-2">
          {isUsingClubDefaults && (
            <p className="text-xs text-muted-foreground">Using club default rewards:</p>
          )}
          {activeRewards.map((reward) => (
            <Card key={reward.id} className={isUsingClubDefaults ? "border-dashed" : ""}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                      <Trophy className="h-5 w-5 text-amber-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{reward.name}</span>
                        {isUsingClubDefaults && (
                          <Badge variant="outline" className="text-xs">
                            Club Default
                          </Badge>
                        )}
                        {hasTeamRewards && reward.team_id && (
                          <Badge variant="secondary" className="text-xs">
                            Team Override
                          </Badge>
                        )}
                        {!reward.is_active && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            Inactive
                          </Badge>
                        )}
                      </div>
                      {reward.description && (
                        <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                          {reward.description}
                        </p>
                      )}
                      {reward.points_required > 0 && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          +{reward.points_required} points
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Actions for team-specific rewards */}
                  {reward.team_id && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch
                        checked={reward.is_active}
                        onCheckedChange={(checked) =>
                          toggleActiveMutation.mutate({ id: reward.id, isActive: checked })
                        }
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleOpenDialog(reward)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" className="text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Team Reward?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will delete this team-specific reward. {teamRewards.length <= 1 ? "The club default rewards will be used instead." : ""}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(reward.id)}
                              className="bg-destructive text-destructive-foreground"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            No Player of the Match rewards configured. Ask your club admin to set one up in Club Rewards, or create a team-specific reward.
          </AlertDescription>
        </Alert>
      )}

      {/* Create/Edit Dialog */}
      <ResponsiveDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-500" />
              {editingReward ? "Edit Team Reward" : "Create Team Reward"}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reward-name">Reward Name</Label>
              <Input
                id="reward-name"
                placeholder="e.g., Free Ice Cream"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reward-description">Description (optional)</Label>
              <Textarea
                id="reward-description"
                placeholder="What does the player get?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <ResponsiveDialogFooter>
            <ResponsiveDialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </ResponsiveDialogClose>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editingReward ? "Save Changes" : "Create Reward"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
