import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { SponsorTier, TIER_CONFIG, TIER_ORDER, selectWeightedSponsor } from "@/lib/sponsorTiers";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { 
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { 
  Plus, 
  Pencil, 
  Trash2, 
  ExternalLink, 
  GripVertical,
  Building2,
  Loader2
} from "lucide-react";
import { compressImage } from "@/lib/imageCompression";

interface Sponsor {
  id: string;
  club_id: string;
  name: string;
  logo_url: string | null;
  description: string | null;
  website_url: string | null;
  is_active: boolean;
  is_team_only: boolean;
  display_order: number;
  tier: SponsorTier | null;
  exposure_percentage: number | null;
  created_at: string;
}

interface SponsorsManagerProps {
  clubId: string;
  currentPrimarySponsorId?: string | null;
  onPrimaryChange?: () => void;
}

export function SponsorsManager({ clubId, currentPrimarySponsorId, onPrimaryChange }: SponsorsManagerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSponsor, setEditingSponsor] = useState<Sponsor | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isTeamOnly, setIsTeamOnly] = useState(false);
  const [tier, setTier] = useState<SponsorTier | "none">("none");
  const [exposurePercentage, setExposurePercentage] = useState<string>("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);

  const { data: sponsors, isLoading } = useQuery({
    queryKey: ["sponsors", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sponsors")
        .select("*")
        .eq("club_id", clubId)
        .order("display_order", { ascending: true });
      
      if (error) throw error;
      return data as Sponsor[];
    },
  });

  // Only sponsors that are active AND not team-only can be in club rotation
  const clubRotationSponsors = sponsors?.filter(s => s.is_active && !s.is_team_only) || [];
  // Team-only sponsors (can still be allocated to teams)
  const teamOnlySponsors = sponsors?.filter(s => s.is_team_only) || [];

  const updatePrimarySponsorMutation = useMutation({
    mutationFn: async (sponsorId: string | null) => {
      const { error } = await supabase
        .from("clubs")
        .update({ primary_sponsor_id: sponsorId })
        .eq("id", clubId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club", clubId] });
      onPrimaryChange?.();
      toast({ title: "Primary sponsor updated" });
    },
    onError: (error) => {
      toast({ title: "Failed to update primary sponsor", description: error.message, variant: "destructive" });
    },
  });

  const rotateSponsor = () => {
    if (clubRotationSponsors.length === 0) return;
    
    const candidates = clubRotationSponsors.filter(s => s.id !== currentPrimarySponsorId);
    if (candidates.length === 0) return;
    
    const selected = selectWeightedSponsor(candidates);
    if (selected) {
      updatePrimarySponsorMutation.mutate(selected.id);
    }
  };

  // Auto-rotate on mount if enabled
  useEffect(() => {
    if (autoRotate && clubRotationSponsors.length > 1) {
      rotateSponsor();
    }
  }, [autoRotate]);

  const addSponsorMutation = useMutation({
    mutationFn: async (sponsorData: { 
      name: string; 
      description: string | null; 
      website_url: string | null;
      logo_url: string | null;
      is_team_only: boolean;
      is_active: boolean;
      tier: SponsorTier | null;
      exposure_percentage: number | null;
    }) => {
      const { error } = await supabase
        .from("sponsors")
        .insert({
          club_id: clubId,
          name: sponsorData.name,
          description: sponsorData.description,
          website_url: sponsorData.website_url,
          logo_url: sponsorData.logo_url,
          is_team_only: sponsorData.is_team_only,
          is_active: sponsorData.is_active,
          tier: sponsorData.tier,
          exposure_percentage: sponsorData.exposure_percentage,
          display_order: (sponsors?.length || 0) + 1,
        });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sponsors", clubId] });
      toast({ title: "Sponsor added successfully" });
      resetForm();
    },
    onError: (error) => {
      toast({ title: "Failed to add sponsor", description: error.message, variant: "destructive" });
    },
  });

  const updateSponsorMutation = useMutation({
    mutationFn: async ({ id, ...data }: { 
      id: string;
      name: string; 
      description: string | null; 
      website_url: string | null;
      logo_url: string | null;
      is_team_only: boolean;
      is_active: boolean;
      tier: SponsorTier | null;
      exposure_percentage: number | null;
    }) => {
      const { error } = await supabase
        .from("sponsors")
        .update({
          name: data.name,
          description: data.description,
          website_url: data.website_url,
          logo_url: data.logo_url,
          is_active: data.is_active,
          is_team_only: data.is_team_only,
          tier: data.tier,
          exposure_percentage: data.exposure_percentage,
        })
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sponsors", clubId] });
      toast({ title: "Sponsor updated successfully" });
      resetForm();
    },
    onError: (error) => {
      toast({ title: "Failed to update sponsor", description: error.message, variant: "destructive" });
    },
  });

  const deleteSponsorMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("sponsors")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sponsors", clubId] });
      toast({ title: "Sponsor deleted" });
    },
    onError: (error) => {
      toast({ title: "Failed to delete sponsor", description: error.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from("sponsors")
        .update({ is_active: isActive })
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sponsors", clubId] });
    },
  });

  const toggleTeamOnlyMutation = useMutation({
    mutationFn: async ({ id, isTeamOnly }: { id: string; isTeamOnly: boolean }) => {
      const { error } = await supabase
        .from("sponsors")
        .update({ is_team_only: isTeamOnly })
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sponsors", clubId] });
    },
  });

  const resetForm = () => {
    setDialogOpen(false);
    setEditingSponsor(null);
    setName("");
    setDescription("");
    setWebsiteUrl("");
    setIsTeamOnly(false);
    setIsActive(true);
    setTier("none");
    setExposurePercentage("");
    setLogoFile(null);
    setLogoPreview(null);
  };

  const handleOpenDialog = (sponsor?: Sponsor) => {
    if (sponsor) {
      setEditingSponsor(sponsor);
      setName(sponsor.name);
      setDescription(sponsor.description || "");
      setWebsiteUrl(sponsor.website_url || "");
      setIsTeamOnly(sponsor.is_team_only);
      setIsActive(sponsor.is_active);
      setTier(sponsor.tier || "none");
      setExposurePercentage(sponsor.exposure_percentage != null ? String(sponsor.exposure_percentage) : "");
      setLogoPreview(sponsor.logo_url);
    } else {
      resetForm();
    }
    setDialogOpen(true);
  };

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const result = await compressImage(file);
        setLogoFile(result.file);
        setLogoPreview(URL.createObjectURL(result.file));
      } catch {
        setLogoFile(file);
        setLogoPreview(URL.createObjectURL(file));
      }
    }
  };

  const uploadLogo = async (): Promise<string | null> => {
    if (!logoFile) return editingSponsor?.logo_url || null;
    
    const fileExt = logoFile.name.split('.').pop();
    const fileName = `${clubId}/${Date.now()}.${fileExt}`;
    
    const { error } = await supabase.storage
      .from("sponsor-logos")
      .upload(fileName, logoFile);
    
    if (error) throw error;
    
    const { data: { publicUrl } } = supabase.storage
      .from("sponsor-logos")
      .getPublicUrl(fileName);
    
    return publicUrl;
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({ title: "Please enter a sponsor name", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      const logoUrl = await uploadLogo();
      
      const parsedTier = tier === "none" ? null : tier;
      const parsedExposure = exposurePercentage.trim() !== "" ? parseInt(exposurePercentage) : null;
      
      const sponsorData = {
        name: name.trim(),
        description: description.trim() || null,
        website_url: websiteUrl.trim() || null,
        logo_url: logoUrl,
        is_team_only: isTeamOnly,
        is_active: isActive,
        tier: parsedTier,
        exposure_percentage: parsedExposure,
      };

      if (editingSponsor) {
        await updateSponsorMutation.mutateAsync({ id: editingSponsor.id, ...sponsorData });
      } else {
        await addSponsorMutation.mutateAsync(sponsorData);
      }
    } catch (error: any) {
      toast({ title: "Error saving sponsor", description: error.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Club Sponsors</h3>
          <p className="text-sm text-muted-foreground">
            Primary sponsor rotates for club-wide display
          </p>
        </div>
        <Button onClick={() => handleOpenDialog()} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          Add Sponsor
        </Button>
      </div>

      {sponsors?.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Building2 className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>No sponsors yet</p>
            <p className="text-sm">Add sponsors to display on events and rewards</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sponsors?.map((sponsor) => {
            const isPrimary = sponsor.id === currentPrimarySponsorId;
            const canSetPrimary = sponsor.is_active && !sponsor.is_team_only && !isPrimary;
            return (
              <Card 
                key={sponsor.id} 
                className={`${!sponsor.is_active ? "opacity-60" : ""} ${isPrimary ? "border-primary ring-1 ring-primary" : ""} ${canSetPrimary ? "cursor-pointer hover:bg-accent/50 transition-colors" : ""}`}
                onClick={canSetPrimary ? () => updatePrimarySponsorMutation.mutate(sponsor.id) : undefined}
              >
                <CardContent className="p-3">
                  <div className="flex items-center gap-3">
                    <GripVertical className="h-5 w-5 text-muted-foreground cursor-grab flex-shrink-0 hidden sm:block" />
                    <Avatar className="h-10 w-10 flex-shrink-0">
                      <AvatarImage src={sponsor.logo_url || undefined} />
                      <AvatarFallback className="bg-secondary text-sm">
                        {sponsor.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium truncate">{sponsor.name}</h4>
                      <div className="flex flex-wrap items-center gap-1 mt-0.5">
                        {isPrimary && (
                          <Badge variant="default" className="text-xs">Primary</Badge>
                        )}
                        {sponsor.tier && (
                          <Badge 
                            variant="outline" 
                            className={`text-[10px] rounded-md ${TIER_CONFIG[sponsor.tier].bgColor} ${TIER_CONFIG[sponsor.tier].textColor} border-transparent`}
                          >
                            {TIER_CONFIG[sponsor.tier].label}
                          </Badge>
                        )}
                        {sponsor.exposure_percentage != null && (
                          <Badge variant="outline" className="text-[10px]">{sponsor.exposure_percentage}%</Badge>
                        )}
                        {sponsor.is_team_only && (
                          <Badge variant="outline" className="text-xs">Team Only</Badge>
                        )}
                        {!sponsor.is_active && (
                          <Badge variant="secondary" className="text-xs">Inactive</Badge>
                        )}
                        {canSetPrimary && (
                          <span className="text-xs text-muted-foreground">Tap to set as primary</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {sponsor.website_url && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl(sponsor.website_url!))}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleOpenDialog(sponsor)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          if (confirm("Delete this sponsor?")) {
                            deleteSponsorMutation.mutate(sponsor.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          
          {clubRotationSponsors.length > 1 && (
            <div className="flex items-center justify-between pt-2 px-1">
              <Label htmlFor="auto-rotate" className="text-sm text-muted-foreground">
                Auto-rotate primary on page load
              </Label>
              <Switch
                id="auto-rotate"
                checked={autoRotate}
                onCheckedChange={setAutoRotate}
              />
            </div>
          )}
        </div>
      )}

      <ResponsiveDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {editingSponsor ? "Edit Sponsor" : "Add Sponsor"}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Sponsors will be displayed on events and can provide rewards
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Logo</Label>
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  <AvatarImage src={logoPreview || undefined} />
                  <AvatarFallback className="bg-secondary">
                    {name.charAt(0).toUpperCase() || "S"}
                  </AvatarFallback>
                </Avatar>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoChange}
                  className="max-w-[200px]"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sponsor-name">Name *</Label>
              <Input
                id="sponsor-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sponsor name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sponsor-description">Description</Label>
              <Textarea
                id="sponsor-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of the sponsor"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sponsor-website">Website URL</Label>
              <Input
                id="sponsor-website"
                type="url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://reference.invalid"
              />
            </div>

            {/* Sponsor Tier */}
            <div className="space-y-2">
              <Label>Sponsor Tier</Label>
              <p className="text-xs text-muted-foreground">
                Higher tiers get more exposure across the app
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(["none", ...TIER_ORDER] as const).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    variant={tier === t ? "default" : "outline"}
                    size="sm"
                    className={`text-xs ${t !== "none" && tier === t ? TIER_CONFIG[t].bgColor + " " + TIER_CONFIG[t].textColor + " border-transparent" : ""}`}
                    onClick={() => setTier(t)}
                  >
                    {t === "none" ? "No Tier" : TIER_CONFIG[t].label}
                    {t !== "none" && ` (${TIER_CONFIG[t].weight}x)`}
                  </Button>
                ))}
              </div>
            </div>

            {/* Exposure Override */}
            <div className="space-y-2">
              <Label htmlFor="exposure-pct">Exposure Override %</Label>
              <p className="text-xs text-muted-foreground">
                Optional. Overrides tier weighting with a custom percentage (0–100)
              </p>
              <Input
                id="exposure-pct"
                type="number"
                min={0}
                max={100}
                value={exposurePercentage}
                onChange={(e) => setExposurePercentage(e.target.value)}
                placeholder="Leave empty to use tier weighting"
              />
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label htmlFor="team-only">Team Only</Label>
                <p className="text-xs text-muted-foreground">
                  Exclude from club rotation, only for team allocation
                </p>
              </div>
              <Switch
                id="team-only"
                checked={isTeamOnly}
                onCheckedChange={setIsTeamOnly}
              />
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label htmlFor="is-active">Active</Label>
                <p className="text-xs text-muted-foreground">
                  Show this sponsor in rotation and allocations
                </p>
              </div>
              <Switch
                id="is-active"
                checked={isActive}
                onCheckedChange={setIsActive}
              />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={resetForm}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={isUploading}>
                {isUploading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingSponsor ? "Save Changes" : "Add Sponsor"}
              </Button>
            </div>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
