import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Camera, Loader2, Building2, Sparkles, Lock, ChevronDown, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfileById } from "@/lib/profileCache";
import { SPORT_EMOJIS, getSportEmoji, isClassModeSport } from "@/lib/sportEmojis";
import { isCachedAppAdmin } from "@/lib/rolesCache";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

const SPORTS = Object.keys(SPORT_EMOJIS);

export default function CreateClubPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  
  const [sport, setSport] = useState("");
  const [saving, setSaving] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [nameTaken, setNameTaken] = useState<boolean | null>(null);
  const [nameChecking, setNameChecking] = useState(false);

  // Debounced duplicate-name check — surfaces conflicts before user taps Create.
  useEffect(() => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setNameTaken(null);
      setNameChecking(false);
      return;
    }
    setNameChecking(true);
    const handle = setTimeout(async () => {
      if (useIcpLab) {
        setNameTaken(false);
        setNameChecking(false);
        return;
      }
      const { data } = await supabase
        .from("clubs")
        .select("id")
        .ilike("name", trimmed)
        .maybeSingle();
      setNameTaken(!!data);
      setNameChecking(false);
    }, 400);
    return () => clearTimeout(handle);
  }, [name, useIcpLab]);

  // Deterministic monogram colour from the club name so the placeholder logo
  // looks intentional rather than empty. Falls back to a neutral hue.
  const monogramHue = (() => {
    const s = name.trim() || "Club";
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 360;
  })();
  const monogramStyle = {
    background: `linear-gradient(135deg, hsl(${monogramHue} 70% 55%), hsl(${(monogramHue + 40) % 360} 70% 45%))`,
    color: "white",
  } as React.CSSProperties;

  // Check if user is app admin
  const cachedIsAppAdmin = isCachedAppAdmin();
  const { data: isAppAdmin = cachedIsAppAdmin ?? false } = useQuery({
    queryKey: ["isAppAdmin", user?.id, useIcpLab],
    queryFn: async () => {
      if (useIcpLab) return true;
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user && cachedIsAppAdmin === null,
    staleTime: 1000 * 60 * 5,
  });

  // Check if club creation is locked
  const { data: isClubCreationLocked = false, isLoading: isLoadingSettings } = useQuery({
    queryKey: ["appSettings", "club_creation_locked", useIcpLab],
    queryFn: async () => {
      if (useIcpLab) return false;
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "club_creation_locked")
        .maybeSingle();
      return data?.value === true || data?.value === "true";
    },
    staleTime: 1000 * 60 * 5,
  });

  // Check if user's profile name is "Reviewer"
  const { data: isReviewerProfile = false } = useQuery({
    queryKey: ["isReviewerProfile", user?.id, useIcpLab],
    queryFn: async () => {
      if (useIcpLab) return false;
      const { data } = await selectCachedProfileById(user!.id);
      return data?.display_name === "Reviewer";
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
  });

  const isExemptUser = user?.email === "redacted@example.invalid" || isReviewerProfile;
  // Beta lock removed — club creation is open to all authenticated users.
  const canCreateClub = true;

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Store the file for upload after club creation
    setLogoFile(file);
    
    // Create a preview URL
    const reader = new FileReader();
    reader.onloadend = () => {
      setLogoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({
        title: "Missing information",
        description: "Please enter a club name.",
        variant: "destructive",
      });
      return;
    }
    if (!sport) {
      toast({
        title: "Please select a sport",
        description: "Sport is required so we can tailor your club setup.",
        variant: "destructive",
      });
      setMoreOpen(true);
      return;
    }

    if (useIcpLab) {
      toast({
        title: "Club creation is unavailable in ICP lab mode",
        description: "The form is a local preview and no club data has been persisted.",
      });
      return;
    }

    setSaving(true);

    // Check for duplicate club name
    const { data: existingClub } = await supabase
      .from("clubs")
      .select("id")
      .ilike("name", name.trim())
      .maybeSingle();

    if (existingClub) {
      setSaving(false);
      toast({
        title: "Club name already exists",
        description: "Please choose a different name for your club.",
        variant: "destructive",
      });
      return;
    }

    // Create the club first (without logo)
    const { data: club, error: clubError } = await supabase
      .from("clubs")
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        logo_url: null, // Will be updated after upload
        sport: sport || null,
        created_by: user!.id,
        class_mode_enabled: isClassModeSport(sport),
      })
      .select()
      .single();

    if (clubError) {
      setSaving(false);
      toast({
        title: "Error",
        description: clubError.message.includes("idx_unique_club_name") 
          ? "A club with this name already exists." 
          : "Failed to create club. Please try again.",
        variant: "destructive",
      });
      return;
    }

    // Upload logo to storage if one was selected
    let finalLogoUrl: string | null = null;
    if (logoFile) {
      try {
        const fileExt = logoFile.name.split('.').pop();
        const fileName = `${club.id}/${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('club-logos')
          .upload(fileName, logoFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('club-logos')
          .getPublicUrl(fileName);

        finalLogoUrl = urlData.publicUrl;

        // Update the club with the logo URL
        await supabase
          .from("clubs")
          .update({ logo_url: finalLogoUrl })
          .eq("id", club.id);
      } catch (error) {
        console.error('Logo upload error:', error);
        // Continue without logo - club is still created
      }
    }

    // Assign creator as club_admin
    const { error: roleError } = await supabase
      .from("user_roles")
      .insert({
        user_id: user!.id,
        role: "club_admin",
        club_id: club.id,
      });

    setSaving(false);

    if (roleError) {
      toast({
        title: "Warning",
        description: "Club created but couldn't assign admin role.",
        variant: "destructive",
      });
    }

    navigate(`/clubs/${club.id}/setup`);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="flex items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-lg font-semibold">Create Club</h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-6 space-y-8 max-w-lg mx-auto">
          {useIcpLab && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
              Preview only: club creation is not persisted in ICP lab mode.
            </div>
          )}
          {/* Locked Notice */}
          {!canCreateClub && !isLoadingSettings && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-6 text-center">
              <div className="flex justify-center mb-4">
                <div className="p-3 rounded-full bg-amber-500/20">
                  <Lock className="h-8 w-8 text-amber-600 dark:text-amber-400" />
                </div>
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">We're Currently in Beta</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Club creation is not available while the app is in beta mode. If you'd like to join our beta program and get your club set up, we'd love to hear from you!
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                Get in touch at{" "}
                <a href="mailto:redacted@example.invalid" className="text-primary font-medium underline underline-offset-2">
                  redacted@example.invalid
                </a>
              </p>
              <Button variant="outline" onClick={() => navigate(-1)}>
                Go Back
              </Button>
            </div>
          )}

          {/* Hero Section with Logo - only show if can create */}
          {canCreateClub && (
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-primary/50 to-primary/30 rounded-full blur opacity-40 group-hover:opacity-60 transition-opacity" />
                <Avatar className="relative h-32 w-32 border-4 border-background shadow-xl">
                  <AvatarImage src={logoPreview || undefined} className="object-cover" />
                  <AvatarFallback
                    className="text-4xl font-semibold"
                    style={name.trim() ? monogramStyle : undefined}
                  >
                    {name.trim().charAt(0)?.toUpperCase() || <Building2 className="h-12 w-12" />}
                  </AvatarFallback>
                </Avatar>
                <label className="absolute bottom-1 right-1 p-2.5 rounded-full bg-primary cursor-pointer hover:bg-primary/90 transition-all shadow-lg hover:scale-105 active:scale-95">
                  <Camera className="h-4 w-4 text-primary-foreground" />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleLogoUpload}
                  />
                </label>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  {logoPreview ? "Your club logo" : "We'll use a monogram until you add a logo"}
                </p>
                <p className="text-xs text-muted-foreground/70">
                  Tap the camera to upload — square, ~400×400px works best.
                </p>
              </div>
            </div>
          )}

          {/* Form Fields - only show if can create */}
          {canCreateClub && (
            <>
              <div className="space-y-6">
                {/* Club Name */}
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-sm font-medium">
                    Club Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="name"
                    placeholder="e.g. Ignite FC, Riverside Rovers"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={100}
                    className="h-12 text-base bg-muted/50 border-muted-foreground/20 focus:bg-background transition-colors"
                    aria-invalid={nameTaken === true}
                  />
                  {name.trim().length >= 2 && (
                    <p
                      className={
                        "text-xs " +
                        (nameTaken
                          ? "text-destructive"
                          : nameChecking
                            ? "text-muted-foreground"
                            : "text-emerald-600")
                      }
                    >
                      {nameChecking
                        ? "Checking availability…"
                        : nameTaken
                          ? "A club with this name already exists — try another."
                          : "This name is available."}
                    </p>
                  )}
                </div>

                {/* Sport — required, always visible */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Sport <span className="text-destructive">*</span>
                  </Label>
                  <Select value={sport} onValueChange={setSport}>
                    <SelectTrigger className="w-full h-12 text-base bg-muted/50 border-muted-foreground/20 focus:bg-background transition-colors">
                      <SelectValue placeholder="Select a sport">
                        {sport && (
                          <span className="flex items-center gap-2">
                            <span className="text-lg">{getSportEmoji(sport)}</span>
                            <span>{sport}</span>
                          </span>
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="max-h-[40vh]" position="popper" sideOffset={4}>
                      {SPORTS.map((s) => (
                        <SelectItem key={s} value={s} className="py-3 text-base">
                          <span className="flex items-center gap-3">
                            <span className="text-lg">{getSportEmoji(s)}</span>
                            <span>{s}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Optional details — collapsed to keep the initial form focused. */}
                <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="w-full flex items-center justify-between text-sm font-medium text-primary hover:opacity-80 transition-opacity py-2"
                    >
                      <span>{moreOpen ? "Hide" : "Add"} more details (optional)</span>
                      <ChevronDown
                        className={"h-4 w-4 transition-transform " + (moreOpen ? "rotate-180" : "")}
                      />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-6 pt-2">

                    {/* Description */}
                    <div className="space-y-2">
                      <Label htmlFor="description" className="text-sm font-medium">
                        Description
                      </Label>
                      <Textarea
                        id="description"
                        placeholder="e.g. Community football club for U8s–Seniors on the Northern Beaches."
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        maxLength={500}
                        rows={4}
                        className="text-base resize-none bg-muted/50 border-muted-foreground/20 focus:bg-background transition-colors"
                      />
                      <p className="text-xs text-muted-foreground text-right">
                        {description.length}/500
                      </p>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>

              {/* Escape hatch — user might only need a single team, not a whole club. */}
              <div className="rounded-xl border border-dashed p-3 flex items-center gap-3">
                <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                <p className="text-xs text-muted-foreground flex-1">
                  Only running one team?
                </p>
                <Link
                  to="/teams/new"
                  className="text-xs font-medium text-primary hover:underline shrink-0"
                >
                  Start a team instead →
                </Link>
              </div>


              {/* Info Card */}
              <div className="rounded-xl bg-primary/5 border border-primary/10 p-4">
                <div className="flex gap-3">
                  <div className="shrink-0 mt-0.5">
                    <Sparkles className="h-5 w-5 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">You'll be the club admin</p>
                    <p className="text-xs text-muted-foreground">
                      As the creator, you'll have full control to manage teams, members, and settings.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Fixed Bottom Button - only show if can create */}
      {canCreateClub && (
        <div className="sticky bottom-0 p-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t">
          <div className="max-w-lg mx-auto">
            <Button 
              className="w-full h-12 text-base font-semibold shadow-lg" 
              onClick={handleSubmit}
              disabled={saving || !name.trim() || nameTaken === true || nameChecking}
            >
              {saving ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                "Create Club"
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
