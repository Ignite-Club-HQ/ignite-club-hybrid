import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, Gift, Loader2, Pencil, Star, ImagePlus, X, Trophy, QrCode, ClipboardList, Building2, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/imageCompression";
import { PointsIconGallery } from "@/components/PointsIconGallery";

export type RewardType = "general" | "player_of_match";

interface ClubReward {
  id: string;
  club_id: string;
  name: string;
  description: string | null;
  points_required: number;
  is_default: boolean;
  is_active: boolean;
  logo_url: string | null;
  reward_type: RewardType;
  qr_code_url: string | null;
  show_qr_code: boolean;
  sponsor_id: string | null;
  created_at: string;
  sponsors?: {
    id: string;
    name: string;
    logo_url: string | null;
  } | null;
}

interface Sponsor {
  id: string;
  name: string;
  logo_url: string | null;
}

interface ClubRewardsManagerProps {
  clubId: string;
}

export default function ClubRewardsManager({ clubId }: ClubRewardsManagerProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingReward, setEditingReward] = useState<ClubReward | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pointsRequired, setPointsRequired] = useState(20);
  const [rewardType, setRewardType] = useState<RewardType>("general");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [showQrCode, setShowQrCode] = useState(false);
  const [sponsorId, setSponsorId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingQr, setUploadingQr] = useState(false);
  const hasCreatedDefault = useRef(false);
  const [customPointsName, setCustomPointsName] = useState("Reward Points");
  const [savingPointsName, setSavingPointsName] = useState(false);
  const [pointsIconUrl, setPointsIconUrl] = useState<string | null>(null);
  

  // Fetch club's current points display name
  useQuery({
    queryKey: ["club-points-name", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("clubs")
        .select("points_display_name, points_icon_url")
        .eq("id", clubId)
        .single();
      const name = (data as any)?.points_display_name || "Reward Points";
      const iconUrl = (data as any)?.points_icon_url || null;
      setCustomPointsName(name);
      setPointsIconUrl(iconUrl);
      return { name, iconUrl };
    },
  });

  // Fetch club subscription settings
  const { data: clubSubscription } = useQuery({
    queryKey: ["club-subscription-rewards", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("club_subscriptions")
        .select("disable_team_pom_rewards, disable_points_system")
        .eq("club_id", clubId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Toggle team POM rewards setting
  const toggleTeamPomRewardsMutation = useMutation({
    mutationFn: async (disabled: boolean) => {
      const { error } = await supabase
        .from("club_subscriptions")
        .update({ disable_team_pom_rewards: disabled })
        .eq("club_id", clubId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-subscription-rewards", clubId] });
      queryClient.invalidateQueries({ queryKey: ["club-subscription", clubId] });
      toast({ 
        title: clubSubscription?.disable_team_pom_rewards 
          ? "Team admins can now create custom rewards" 
          : "Team reward overrides disabled" 
      });
    },
  });

  // Toggle points system setting
  const togglePointsSystemMutation = useMutation({
    mutationFn: async (disabled: boolean) => {
      const { error } = await supabase
        .from("club_subscriptions")
        .update({ disable_points_system: disabled })
        .eq("club_id", clubId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-subscription-rewards", clubId] });
      queryClient.invalidateQueries({ queryKey: ["club-subscription", clubId] });
      toast({ 
        title: clubSubscription?.disable_points_system 
          ? "Points system enabled" 
          : "Points system disabled" 
      });
    },
  });

  // Fetch sponsors for this club
  const { data: sponsors = [] } = useQuery({
    queryKey: ["sponsors", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sponsors")
        .select("id, name, logo_url")
        .eq("club_id", clubId)
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return data as Sponsor[];
    },
  });

  const { data: rewards = [], isLoading } = useQuery({
    queryKey: ["club-rewards", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("club_rewards")
        .select("*, sponsors(id, name, logo_url)")
        .eq("club_id", clubId)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as ClubReward[];
    },
  });

  const createDefaultRewardMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("club_rewards").insert({
        club_id: clubId,
        name: "Free Sausage Sizzle",
        description: "Enjoy a free sausage at the next club event",
        points_required: 20,
        is_default: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-rewards", clubId] });
    },
  });

  const addRewardMutation = useMutation({
    mutationFn: async (reward: { name: string; description: string; points_required: number; logo_url: string | null; reward_type: RewardType; qr_code_url: string | null; show_qr_code: boolean; sponsor_id: string | null }) => {
      const { error } = await supabase.from("club_rewards").insert({
        club_id: clubId,
        name: reward.name,
        description: reward.description || null,
        points_required: reward.points_required,
        logo_url: reward.logo_url,
        reward_type: reward.reward_type,
        qr_code_url: reward.qr_code_url,
        show_qr_code: reward.show_qr_code,
        sponsor_id: reward.sponsor_id,
        is_default: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-rewards", clubId] });
      resetForm();
      setDialogOpen(false);
      toast({ title: "Reward added" });
    },
    onError: () => {
      toast({ title: "Failed to add reward", variant: "destructive" });
    },
  });

  const updateRewardMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; name: string; description: string; points_required: number; logo_url: string | null; reward_type: RewardType; qr_code_url: string | null; show_qr_code: boolean; sponsor_id: string | null }) => {
      const { error } = await supabase
        .from("club_rewards")
        .update({
          name: updates.name,
          description: updates.description || null,
          points_required: updates.points_required,
          logo_url: updates.logo_url,
          reward_type: updates.reward_type,
          qr_code_url: updates.qr_code_url,
          show_qr_code: updates.show_qr_code,
          sponsor_id: updates.sponsor_id,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-rewards", clubId] });
      resetForm();
      setDialogOpen(false);
      toast({ title: "Reward updated" });
    },
    onError: () => {
      toast({ title: "Failed to update reward", variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from("club_rewards")
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-rewards", clubId] });
    },
  });

  const setDefaultRewardMutation = useMutation({
    mutationFn: async (rewardId: string) => {
      await supabase
        .from("club_rewards")
        .update({ is_default: false })
        .eq("club_id", clubId);
      
      const { error } = await supabase
        .from("club_rewards")
        .update({ is_default: true })
        .eq("id", rewardId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-rewards", clubId] });
      toast({ title: "Featured reward updated" });
    },
  });

  const deleteRewardMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("club_rewards").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-rewards", clubId] });
      toast({ title: "Reward deleted" });
    },
  });

  const resetForm = () => {
    setName("");
    setDescription("");
    setPointsRequired(20);
    setLogoUrl(null);
    setQrCodeUrl(null);
    setShowQrCode(false);
    setRewardType("general");
    setSponsorId(null);
    setEditingReward(null);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const result = await compressImage(file);
      const fileName = `${clubId}/rewards/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("club-logos")
        .upload(fileName, result.file);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("club-logos")
        .getPublicUrl(fileName);

      setLogoUrl(urlData.publicUrl);
    } catch (error) {
      toast({ title: "Failed to upload logo", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleQrCodeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingQr(true);
    try {
      const result = await compressImage(file);
      const fileName = `${clubId}/qr-codes/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("club-logos")
        .upload(fileName, result.file);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("club-logos")
        .getPublicUrl(fileName);

      setQrCodeUrl(urlData.publicUrl);
    } catch (error) {
      toast({ title: "Failed to upload QR code", variant: "destructive" });
    } finally {
      setUploadingQr(false);
    }
  };

  const handleOpenDialog = (reward?: ClubReward) => {
    if (reward) {
      setEditingReward(reward);
      setName(reward.name);
      setDescription(reward.description || "");
      setPointsRequired(reward.points_required);
      setLogoUrl(reward.logo_url);
      setQrCodeUrl(reward.qr_code_url);
      setShowQrCode(reward.show_qr_code);
      setRewardType(reward.reward_type || "general");
      setSponsorId(reward.sponsor_id);
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
      updateRewardMutation.mutate({
        id: editingReward.id,
        name: name.trim(),
        description: description.trim(),
        points_required: pointsRequired,
        logo_url: logoUrl,
        reward_type: rewardType,
        qr_code_url: qrCodeUrl,
        show_qr_code: showQrCode,
        sponsor_id: sponsorId,
      });
    } else {
      addRewardMutation.mutate({
        name: name.trim(),
        description: description.trim(),
        points_required: pointsRequired,
        logo_url: logoUrl,
        reward_type: rewardType,
        qr_code_url: qrCodeUrl,
        show_qr_code: showQrCode,
        sponsor_id: sponsorId,
      });
    }
  };

  // Create default reward if none exist - use ref to prevent multiple calls
  useEffect(() => {
    if (!isLoading && rewards.length === 0 && !hasCreatedDefault.current && !createDefaultRewardMutation.isPending) {
      hasCreatedDefault.current = true;
      createDefaultRewardMutation.mutate();
    }
  }, [isLoading, rewards.length]);

  const defaultReward = rewards.find(r => r.is_default);

  return (
    <div className="space-y-4">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Gift className="h-5 w-5 text-primary" />
          </div>
          <p className="text-sm text-muted-foreground">{rewards.length} reward{rewards.length !== 1 ? 's' : ''} configured</p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm"
            className="flex-1 sm:flex-none"
            onClick={() => navigate(`/clubs/${clubId}/rewards/report`)}
          >
            <ClipboardList className="h-4 w-4 mr-2" />
            View Report
          </Button>
          <Button size="sm" className="flex-1 sm:flex-none" onClick={() => handleOpenDialog()}>
            <Plus className="h-4 w-4 mr-2" /> Add Reward
          </Button>
        </div>
      </div>

      {/* Team Override Settings */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" />
              <span className="font-medium text-sm">Lock Player of Match Rewards</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Prevent team admins from creating their own Player of Match rewards
            </p>
          </div>
          <Switch
            checked={clubSubscription?.disable_team_pom_rewards || false}
            onCheckedChange={(checked) => toggleTeamPomRewardsMutation.mutate(checked)}
            disabled={toggleTeamPomRewardsMutation.isPending}
          />
        </div>
      </Card>

      {/* Points System Toggle */}
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-500" />
              <span className="font-medium text-sm">Points System</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Automatically award points for completed duties
            </p>
          </div>
          <Switch
            checked={!clubSubscription?.disable_points_system}
            onCheckedChange={(checked) => togglePointsSystemMutation.mutate(!checked)}
            disabled={togglePointsSystemMutation.isPending}
          />
        </div>

        {/* Custom Points Name */}
        <div className="border-t pt-3 space-y-3">
          <div>
            <Label htmlFor="points-name" className="text-xs text-muted-foreground">Custom Points Name</Label>
            <div className="flex gap-2 mt-1">
              <Input
                id="points-name"
                placeholder="Reward Points"
                value={customPointsName}
                onChange={(e) => setCustomPointsName(e.target.value)}
                className="text-sm"
                maxLength={30}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">e.g. "Tiger Points", "Eagles Rewards"</p>
          </div>

          {/* Points Icon Gallery */}
          <PointsIconGallery
            clubId={clubId}
            currentIconUrl={pointsIconUrl}
            onIconSelect={async (url) => {
              setPointsIconUrl(url);
              // Auto-save icon selection immediately
              const { error } = await supabase
                .from("clubs")
                .update({ 
                   points_display_name: customPointsName || 'Reward Points',
                   points_icon_url: url,
                } as any)
                .eq("id", clubId);
              if (!error) {
                queryClient.invalidateQueries({ queryKey: ["user-clubs"] });
                queryClient.invalidateQueries({ queryKey: ["points-display-name"] });
                queryClient.invalidateQueries({ queryKey: ["points-display"] });
                queryClient.invalidateQueries({ queryKey: ["club-points-name"] });
                toast({ title: url ? "Points icon updated" : "Points icon removed" });
              }
            }}
          />

          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={savingPointsName}
            onClick={async () => {
              setSavingPointsName(true);
              const { error } = await supabase
                .from("clubs")
                .update({ 
                   points_display_name: customPointsName || 'Reward Points',
                   points_icon_url: pointsIconUrl,
                } as any)
                .eq("id", clubId);
              setSavingPointsName(false);
              if (error) {
                toast({ title: "Failed to save", variant: "destructive" });
              } else {
                queryClient.invalidateQueries({ queryKey: ["user-clubs"] });
                queryClient.invalidateQueries({ queryKey: ["points-display-name"] });
                queryClient.invalidateQueries({ queryKey: ["points-display"] });
                queryClient.invalidateQueries({ queryKey: ["club-points-name"] });
                toast({ title: "Points branding updated" });
              }
            }}
          >
            {savingPointsName ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
            Save Points Branding
          </Button>
        </div>
      </Card>

      <div className="space-y-3">
        {isLoading ? (
          <Card className="p-8">
            <div className="flex flex-col items-center justify-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Loading rewards...</p>
            </div>
          </Card>
        ) : rewards.length === 0 ? (
          <Card className="p-8">
            <div className="flex flex-col items-center justify-center gap-3 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <Gift className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">Setting up rewards...</p>
                <p className="text-sm text-muted-foreground">Your default reward is being created</p>
              </div>
            </div>
          </Card>
        ) : (
          rewards.map((reward) => (
            <Card
              key={reward.id}
              className={`overflow-hidden transition-all ${
                !reward.is_active ? "opacity-60" : ""
              } ${reward.is_default ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
            >
              <div className="p-4">
                <div className="flex items-start gap-3">
                  {/* Reward Icon/Logo */}
                  <div className="shrink-0">
                    {reward.logo_url ? (
                      <img 
                        src={reward.logo_url} 
                        alt={reward.name || "Reward logo"} 
                        className="h-12 w-12 rounded-xl object-cover border" 
                      />
                    ) : (
                      <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${
                        reward.reward_type === "player_of_match" 
                          ? "bg-amber-500/10" 
                          : "bg-primary/10"
                      }`}>
                        {reward.reward_type === "player_of_match" ? (
                          <Trophy className="h-6 w-6 text-amber-500" />
                        ) : (
                          <Gift className="h-6 w-6 text-primary" />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Reward Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-medium truncate">{reward.name}</h3>
                        {reward.description && (
                          <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">
                            {reward.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Switch
                          checked={reward.is_active}
                          onCheckedChange={(checked) =>
                            toggleActiveMutation.mutate({ id: reward.id, isActive: checked })
                          }
                        />
                      </div>
                    </div>
                    
                    {/* Badges */}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {/* Only show points for general rewards - POM rewards don't use points */}
                      {reward.reward_type !== "player_of_match" && (
                        <Badge variant="secondary" className="text-xs font-medium">
                          {reward.points_required} points
                        </Badge>
                      )}
                      {reward.reward_type === "player_of_match" && (
                        <>
                          <Badge className="text-xs bg-amber-500/20 text-amber-600 border-amber-500/30" variant="outline">
                            <Trophy className="h-3 w-3 mr-1" /> Player of Match
                          </Badge>
                          <Badge className="text-xs" variant="outline">
                            Award Only
                          </Badge>
                        </>
                      )}
                      {reward.is_default && (
                        <Badge className="text-xs bg-primary/10 text-primary border-primary/30" variant="outline">
                          <Star className="h-3 w-3 mr-1 fill-current" /> Featured
                        </Badge>
                      )}
                      {reward.show_qr_code && (
                        <Badge className="text-xs" variant="outline">
                          <QrCode className="h-3 w-3 mr-1" /> QR
                        </Badge>
                      )}
                      {reward.sponsors && (
                        <Badge className="text-xs bg-secondary/50" variant="outline">
                          <Building2 className="h-3 w-3 mr-1" /> {reward.sponsors.name}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                  {reward.reward_type !== "player_of_match" && (
                    <Button
                      variant={reward.is_default ? "secondary" : "ghost"}
                      size="sm"
                      className="flex-1 sm:flex-none h-9"
                      onClick={() => setDefaultRewardMutation.mutate(reward.id)}
                      disabled={setDefaultRewardMutation.isPending || reward.is_default}
                    >
                      <Star className={`h-4 w-4 mr-1.5 ${reward.is_default ? "fill-current text-amber-500" : ""}`} />
                      {reward.is_default ? "Featured" : "Set Featured"}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 sm:flex-none h-9"
                    onClick={() => handleOpenDialog(reward)}
                  >
                    <Pencil className="h-4 w-4 mr-1.5" />
                    Edit
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 sm:flex-none h-9 text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4 mr-1.5" />
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Reward?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete "{reward.name}". This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteRewardMutation.mutate(reward.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Add/Edit Dialog */}
      <ResponsiveDialog open={dialogOpen} onOpenChange={(open) => {
        setDialogOpen(open);
        if (!open) resetForm();
      }}>
        <ResponsiveDialogContent className="sm:max-w-md" fullScreen>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{editingReward ? "Edit Reward" : "Add Reward"}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-4 pt-4 px-4 flex-1 overflow-y-auto pb-safe">
            <div className="space-y-2">
              <Label htmlFor="reward-name">Name</Label>
              <Input
                id="reward-name"
                placeholder="e.g., Free Sausage"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reward-description">Description</Label>
              <Textarea
                id="reward-description"
                placeholder="Optional description..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>Reward Logo (Optional)</Label>
              <div className="flex items-center gap-3">
                {logoUrl ? (
                  <div className="relative">
                    <img src={logoUrl} alt="Reward logo" className="h-16 w-16 rounded-xl object-cover border" />
                    <button
                      type="button"
                      onClick={() => setLogoUrl(null)}
                      className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 shadow-sm"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center h-16 w-16 border-2 border-dashed rounded-xl cursor-pointer hover:bg-muted/50 transition-colors">
                    {uploading ? (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    ) : (
                      <ImagePlus className="h-5 w-5 text-muted-foreground" />
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="hidden"
                      disabled={uploading}
                    />
                  </label>
                )}
                <span className="text-sm text-muted-foreground">Upload a custom image</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Reward Type</Label>
              <RadioGroup 
                value={rewardType} 
                onValueChange={(v) => setRewardType(v as RewardType)}
                className="grid grid-cols-1 gap-3"
              >
                <Label
                  htmlFor="type-general"
                  className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${
                    rewardType === "general" 
                      ? "border-primary bg-primary/5" 
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <RadioGroupItem value="general" id="type-general" />
                  <Gift className="h-5 w-5 text-muted-foreground" />
                  <div className="flex-1">
                    <div className="font-medium">General</div>
                    <p className="text-xs text-muted-foreground">Can be redeemed by members with enough points</p>
                  </div>
                </Label>
                <Label
                  htmlFor="type-pom"
                  className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${
                    rewardType === "player_of_match" 
                      ? "border-primary bg-primary/5" 
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <RadioGroupItem value="player_of_match" id="type-pom" />
                  <Trophy className="h-5 w-5 text-amber-500" />
                  <div className="flex-1">
                    <div className="font-medium">Player of the Match</div>
                    <p className="text-xs text-muted-foreground">Awarded when selected as Player of the Match</p>
                  </div>
                </Label>
              </RadioGroup>
            </div>
            {/* Only show points field for general rewards - POM rewards are awarded by selection, not redeemed with points */}
            {rewardType !== "player_of_match" && (
              <div className="space-y-2">
                <Label htmlFor="points-required">Points Required</Label>
                <Input
                  id="points-required"
                  type="number"
                  min={1}
                  value={pointsRequired === 0 ? "" : pointsRequired}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "") {
                      setPointsRequired(0);
                    } else {
                      const num = parseInt(val);
                      if (!isNaN(num) && num >= 0) {
                        setPointsRequired(num);
                      }
                    }
                  }}
                  onBlur={() => {
                    if (pointsRequired < 1) setPointsRequired(1);
                  }}
                  className="h-11"
                />
              </div>
            )}

            {/* Sponsor Selector */}
            {sponsors.length > 0 && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Sponsored By (Optional)
                </Label>
                <Select value={sponsorId || "none"} onValueChange={(v) => setSponsorId(v === "none" ? null : v)}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Select a sponsor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No sponsor</SelectItem>
                    {sponsors.map((sponsor) => (
                      <SelectItem key={sponsor.id} value={sponsor.id}>
                        <span className="flex items-center gap-2">
                          {sponsor.logo_url && (
                            <img src={sponsor.logo_url} alt={sponsor.name || "Sponsor logo"} className="h-5 w-5 rounded object-cover" />
                          )}
                          {sponsor.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Link this reward to a sponsor to show their branding
                </p>
              </div>
            )}

            {/* QR Code Section */}
            <div className="space-y-3 pt-2 border-t">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="flex items-center gap-2">
                    <QrCode className="h-4 w-4" />
                    Partner QR Code
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Show a QR code for redemption at partner stores
                  </p>
                </div>
                <Switch
                  checked={showQrCode}
                  onCheckedChange={setShowQrCode}
                />
              </div>
              
              {showQrCode && (
                <div className="space-y-2">
                  <Label>QR Code Image</Label>
                  <div className="flex items-center gap-3">
                    {qrCodeUrl ? (
                      <div className="relative">
                        <img src={qrCodeUrl} alt="QR Code" className="h-24 w-24 rounded-xl object-contain border bg-background p-1" />
                        <button
                          type="button"
                          onClick={() => setQrCodeUrl(null)}
                          className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 shadow-sm"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <label className="flex flex-col items-center justify-center h-24 w-24 border-2 border-dashed rounded-xl cursor-pointer hover:bg-muted/50 transition-colors">
                        {uploadingQr ? (
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        ) : (
                          <>
                            <QrCode className="h-6 w-6 text-muted-foreground mb-1" />
                            <span className="text-xs text-muted-foreground">Upload</span>
                          </>
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleQrCodeUpload}
                          className="hidden"
                          disabled={uploadingQr}
                        />
                      </label>
                    )}
                    <div className="flex-1 text-sm text-muted-foreground">
                      <p>Upload a QR code for partner validation.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <ResponsiveDialogFooter className="flex flex-col-reverse sm:flex-row gap-2 pt-4">
              <ResponsiveDialogClose asChild>
                <Button variant="outline" className="w-full sm:w-auto h-11">
                  Cancel
                </Button>
              </ResponsiveDialogClose>
              <Button 
                className="w-full sm:w-auto h-11" 
                onClick={handleSubmit}
                disabled={addRewardMutation.isPending || updateRewardMutation.isPending}
              >
                {(addRewardMutation.isPending || updateRewardMutation.isPending) ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : editingReward ? "Update Reward" : "Add Reward"}
              </Button>
            </ResponsiveDialogFooter>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
