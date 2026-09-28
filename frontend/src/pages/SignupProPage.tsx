import { useState, useEffect, Suspense } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Flame,
  Mail,
  Lock,
  Loader2,
  Check,
  Crown,
  Target,
  Users,
  Camera,
  Ticket,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
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
import { SPORT_EMOJIS } from "@/lib/sportEmojis";
const FindOrCreateClubWizard = lazyWithRetry(() => import("@/components/FindOrCreateClubWizard"));
import { SubscriptionLegalLinks } from "@/components/SubscriptionLegalLinks";
import { isNativePlatform } from "@/lib/nativePush";
import { z } from "zod";
import { addMonths, addYears, isPast, parseISO } from "date-fns";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

const SPORTS = Object.keys(SPORT_EMOJIS);

const PRO_FEATURES = [
  "Club-wide announcements & chat",
  "DMs & custom groups",
  "Unlimited photo & media uploads (Free: 10/month)",
  "Unlimited file storage (Free: 10 files / 25 MB)",
  "Unlimited polls (Free: 2/month)",
  "Scheduled messages",
  "Pinned vault files in chat",
  "Subfolder organization",
  "Points & rewards system",
  "Duty point awards",
  "Priority support",
];

const PRO_FOOTBALL_FEATURES = [
  ...PRO_FEATURES,
  "Soccer Pitch Board",
  "Tactical Formations",
  "Player Positioning",
  "Drawing Tools & Arrows",
  "Formation Saving",
  "Game Timer",
];

const PRICING = {
  pro: { monthly: 24.99, annual: 239 },
  proFootball: { monthly: 39.99, annual: 379.99 },
};

const authSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type PlanType = "pro" | "pro_football";
type Step = 1 | 2 | 3 | 4 | 5;

export default function SignupProPage() {
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return (
      <div className="container max-w-lg mx-auto px-4 py-10">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-6 space-y-4 text-center">
            <Crown className="h-10 w-10 mx-auto text-muted-foreground" />
            <h1 className="text-lg font-semibold">Pro signup is unavailable in ICP lab mode</h1>
            <p className="text-sm text-muted-foreground">
              Account creation, subscriptions, trials, and payment checkout remain external provider boundaries.
            </p>
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ChevronLeft className="mr-2 h-4 w-4" /> Go back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <SupabaseSignupProPage />;
}

function SupabaseSignupProPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, signIn, signUp, signInWithGoogle, loading: authLoading } = useAuth();

  // Step tracking
  const [step, setStep] = useState<Step>(1);

  // Step 1: Plan selection
  const [selectedPlan, setSelectedPlan] = useState<PlanType>(
    searchParams.get("plan") === "pro-football" ? "pro_football" : "pro"
  );
  const [isAnnual, setIsAnnual] = useState(false);

  // Step 2: Auth
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signup");
  const [authLoading2, setAuthLoading2] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Step 3: Club creation
  const [clubName, setClubName] = useState("");
  const [clubDescription, setClubDescription] = useState("");
  const [clubLogoUrl, setClubLogoUrl] = useState("");
  const [clubLogoFile, setClubLogoFile] = useState<File | null>(null);
  const [clubSport, setClubSport] = useState(selectedPlan === "pro_football" ? "Soccer" : "");
  const [createdClubId, setCreatedClubId] = useState<string | null>(null);

  // Step 4: Team creation
  const [teamName, setTeamName] = useState("");
  const [teamLevelAge, setTeamLevelAge] = useState("");
  const [teamDescription, setTeamDescription] = useState("");
  const [teamLogoUrl, setTeamLogoUrl] = useState("");
  const [teamLogoFile, setTeamLogoFile] = useState<File | null>(null);
  const [createdTeamId, setCreatedTeamId] = useState<string | null>(null);

  // Step 5: Promo code
  const [promoCode, setPromoCode] = useState(searchParams.get("code") || "");
  const [isActivating, setIsActivating] = useState(false);
  const [saving, setSaving] = useState(false);

  // Auto-advance if user is already authenticated
  useEffect(() => {
    if (user && step === 2) {
      setStep(3);
    }
  }, [user, step]);

  // Update sport when plan changes to pro_football
  useEffect(() => {
    if (selectedPlan === "pro_football" && !clubSport) {
      setClubSport("Soccer");
    }
  }, [selectedPlan, clubSport]);

  // Reset plan to pro if sport changes to non-soccer while pro_football is selected
  useEffect(() => {
    const isSoccerSport = (sport: string | null | undefined): boolean => {
      if (!sport) return false;
      const lowerSport = sport.toLowerCase();
      return lowerSport.includes("soccer") || lowerSport.includes("football") || lowerSport.includes("futsal");
    };
    
    if (selectedPlan === "pro_football" && clubSport && !isSoccerSport(clubSport)) {
      setSelectedPlan("pro");
    }
  }, [clubSport, selectedPlan]);

  const progressPercent = ((step - 1) / 4) * 100;

  const handleAuth = async (mode: "signin" | "signup") => {
    const validation = authSchema.safeParse({ email, password });
    if (!validation.success) {
      toast({
        title: "Please check your details",
        description: validation.error.errors[0].message,
      });
      return;
    }

    setAuthLoading2(true);
    const { error } = mode === "signin" 
      ? await signIn(email, password)
      : await signUp(email, password);
    
    setAuthLoading2(false);

    if (error) {
      let message = error.message;
      let title = "Something went wrong";
      if (message.includes("already registered")) {
        title = "Account exists";
        message = "This email is already registered. Please sign in instead.";
      } else if (message.includes("Invalid login")) {
        title = "Unable to sign in";
        message = "Invalid email or password. Please try again.";
      } else if (message.includes("Email not confirmed")) {
        title = "Email not verified";
        message = "Please check your inbox and verify your email.";
      } else if (message.includes("Network") || message.includes("fetch")) {
        title = "Connection issue";
        message = "Please check your internet connection and try again.";
      }
      toast({
        title,
        description: message,
      });
    }
    // User effect will auto-advance to step 3
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    const { error } = await signInWithGoogle();
    setGoogleLoading(false);
    
    if (error) {
      let message = error.message;
      if (message.includes("Network") || message.includes("fetch")) {
        message = "Please check your internet connection and try again.";
      }
      toast({
        title: "Unable to sign in with Google",
        description: message,
      });
    }
  };

  const handleClubLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setClubLogoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setClubLogoUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleTeamLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTeamLogoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setTeamLogoUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleCreateClub = async () => {
    if (!clubName.trim()) {
      toast({ title: "Missing information", description: "Please enter a club name.", variant: "destructive" });
      return;
    }

    setSaving(true);

    // Check for duplicate club name
    const { data: existingClub } = await supabase
      .from("clubs")
      .select("id")
      .ilike("name", clubName.trim())
      .maybeSingle();

    if (existingClub) {
      setSaving(false);
      toast({ title: "Club name already exists", description: "Please choose a different name for your club.", variant: "destructive" });
      return;
    }

    const { data: club, error: clubError } = await supabase
      .from("clubs")
      .insert({
        name: clubName.trim(),
        description: clubDescription.trim() || null,
        logo_url: null, // Will be updated after upload
        sport: clubSport || null,
        created_by: user!.id,
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
        variant: "destructive" 
      });
      return;
    }

    // Upload logo to storage if one was selected
    if (clubLogoFile) {
      try {
        const fileExt = clubLogoFile.name.split('.').pop();
        const fileName = `${club.id}/${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('club-logos')
          .upload(fileName, clubLogoFile, { upsert: true });

        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from('club-logos')
            .getPublicUrl(fileName);

          await supabase
            .from("clubs")
            .update({ logo_url: urlData.publicUrl })
            .eq("id", club.id);
        }
      } catch (error) {
        console.error('Logo upload error:', error);
      }
    }

    // Assign creator as club_admin
    await supabase.from("user_roles").insert({
      user_id: user!.id,
      role: "club_admin",
      club_id: club.id,
    });

    setSaving(false);
    setCreatedClubId(club.id);
    
    setStep(4);
  };

  const handleCreateTeam = async () => {
    if (!teamName.trim()) {
      toast({ title: "Missing information", description: "Please enter a team name.", variant: "destructive" });
      return;
    }

    setSaving(true);

    const { data: team, error: teamError } = await supabase
      .from("teams")
      .insert({
        name: teamName.trim(),
        club_id: createdClubId!,
        level_age: teamLevelAge.trim() || null,
        description: teamDescription.trim() || null,
        logo_url: null, // Will be updated after upload
        created_by: user!.id,
      })
      .select()
      .single();

    if (teamError) {
      setSaving(false);
      toast({ title: "Error", description: "Failed to create team. Please try again.", variant: "destructive" });
      return;
    }

    // Upload team logo to storage if one was selected
    if (teamLogoFile) {
      try {
        const fileExt = teamLogoFile.name.split('.').pop();
        const fileName = `${createdClubId}/${team.id}/${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('club-logos')
          .upload(fileName, teamLogoFile, { upsert: true });

        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from('club-logos')
            .getPublicUrl(fileName);

          await supabase
            .from("teams")
            .update({ logo_url: urlData.publicUrl })
            .eq("id", team.id);
        }
      } catch (error) {
        console.error('Team logo upload error:', error);
      }
    }

    // Assign creator as team_admin
    await supabase.from("user_roles").insert({
      user_id: user!.id,
      role: "team_admin",
      club_id: createdClubId!,
      team_id: team.id,
    });

    setSaving(false);
    setCreatedTeamId(team.id);
    
    setStep(5);
  };

  const handleActivateSubscription = async () => {
    if (!promoCode.trim()) {
      toast({ title: "Missing code", description: "Please enter a promo code.", variant: "destructive" });
      return;
    }

    setIsActivating(true);

    // Validate promo code
    const { data: promoData, error: promoError } = await supabase
      .from("promo_codes")
      .select("*")
      .eq("code", promoCode.toUpperCase().trim())
      .eq("is_active", true)
      .maybeSingle();

    if (promoError || !promoData) {
      setIsActivating(false);
      toast({ title: "Invalid Code", description: "Invalid or inactive promo code.", variant: "destructive" });
      return;
    }

    if (promoData.expires_at && isPast(parseISO(promoData.expires_at))) {
      setIsActivating(false);
      toast({ title: "Expired Code", description: "This promo code has expired.", variant: "destructive" });
      return;
    }

    // Validate scope_type matches - must be a team code for team signup
    if (promoData.scope_type !== 'team') {
      setIsActivating(false);
      toast({ title: "Invalid Code", description: "This promo code is for club subscriptions only. Please use a team promo code.", variant: "destructive" });
      return;
    }

    // Validate club restriction - if promo code is restricted to a specific club
    if (promoData.club_id && promoData.club_id !== createdClubId) {
      setIsActivating(false);
      toast({ title: "Invalid Code", description: "This promo code is restricted to a different club.", variant: "destructive" });
      return;
    }

    // Validate access_level matches selected plan
    if (selectedPlan === 'pro_football' && promoData.access_level === 'pro') {
      setIsActivating(false);
      toast({ title: "Plan Mismatch", description: "This promo code is for Pro plan only. Please select the Pro plan or use a Pro Football code.", variant: "destructive" });
      return;
    }
    if (selectedPlan === 'pro' && promoData.access_level === 'pro_football') {
      setIsActivating(false);
      toast({ title: "Plan Mismatch", description: "This promo code is for Pro Football plan only. Please select the Pro Football plan or use a Pro code.", variant: "destructive" });
      return;
    }

    // Use promo code expiry date if set, otherwise default to 1 month/year
    const now = new Date();
    const defaultExpiry = isAnnual ? addYears(now, 1) : addMonths(now, 1);
    const newExpiresAt = promoData.expires_at ? parseISO(promoData.expires_at) : defaultExpiry;

    // Only allow Pro Football for soccer/football sports
    const isSoccerSportCheck = (sport: string | null | undefined): boolean => {
      if (!sport) return false;
      const lowerSport = sport.toLowerCase();
      return lowerSport.includes("soccer") || lowerSport.includes("football") || lowerSport.includes("futsal");
    };
    const allowProFootball = isSoccerSportCheck(clubSport);
    const effectivePlan = !allowProFootball && selectedPlan === "pro_football" ? "pro" : selectedPlan;

    const updateData = effectivePlan === "pro" 
      ? { is_pro: true } 
      : { is_pro: true, is_pro_football: true };

    const { error: subError } = await supabase
      .from("team_subscriptions")
      .upsert({
        team_id: createdTeamId!,
        ...updateData,
        promo_code_id: promoData.id,
        activated_at: new Date().toISOString(),
        expires_at: newExpiresAt.toISOString(),
      } as never, { onConflict: "team_id" });

    if (subError) {
      setIsActivating(false);
      toast({ title: "Error", description: "Failed to activate subscription.", variant: "destructive" });
      return;
    }

    // Increment promo code usage
    await supabase
      .from("promo_codes")
      .update({ uses_count: promoData.uses_count + 1 })
      .eq("id", promoData.id);

    setIsActivating(false);
    
    const tierName = effectivePlan === "pro" ? "Pro" : "Pro Football";
    toast({ title: `Welcome to ${tierName}!`, description: `Your team is now activated with ${tierName} features.` });
    
    navigate(`/teams/${createdTeamId}`);
  };

  const renderStepIndicator = () => (
    <div className="space-y-3">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Step {step} of 5</span>
        <span>{Math.round(progressPercent)}% complete</span>
      </div>
      <Progress value={progressPercent} className="h-2" />
      <div className="flex justify-between text-xs">
        <span className={step >= 1 ? "text-primary font-medium" : "text-muted-foreground"}>Plan</span>
        <span className={step >= 2 ? "text-primary font-medium" : "text-muted-foreground"}>Account</span>
        <span className={step >= 3 ? "text-primary font-medium" : "text-muted-foreground"}>Club</span>
        <span className={step >= 4 ? "text-primary font-medium" : "text-muted-foreground"}>Team</span>
        <span className={step >= 5 ? "text-primary font-medium" : "text-muted-foreground"}>Activate</span>
      </div>
    </div>
  );

  // Check if club sport is soccer/football
  const isSoccerSport = (sport: string | null | undefined): boolean => {
    if (!sport) return false;
    const lowerSport = sport.toLowerCase();
    return lowerSport.includes("soccer") || lowerSport.includes("football") || lowerSport.includes("futsal");
  };

  const showFootballOption = isSoccerSport(clubSport);

  const renderPlanSelection = () => {
    // Force Pro plan if sport is not soccer/football
    const effectivePlan = !showFootballOption && selectedPlan === "pro_football" ? "pro" : selectedPlan;
    const pricing = effectivePlan === "pro" ? PRICING.pro : PRICING.proFootball;
    const features = effectivePlan === "pro" ? PRO_FEATURES : PRO_FOOTBALL_FEATURES;
    const price = isAnnual ? pricing.annual : pricing.monthly;
    const annualSavings = effectivePlan === "pro" ? 61 : 100;

    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold">Choose Your Plan</h2>
          <p className="text-muted-foreground">Select the best plan for your team</p>
        </div>

        {/* Plan Toggle - Only show Pro Football option for soccer/football sports */}
        {showFootballOption ? (
          <Tabs value={selectedPlan} onValueChange={(v) => setSelectedPlan(v as PlanType)} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="pro" className="gap-2">
                <Crown className="h-4 w-4" />
                Pro
              </TabsTrigger>
              <TabsTrigger value="pro_football" className="gap-2">
                <Target className="h-4 w-4" />
                Pro Football
              </TabsTrigger>
            </TabsList>
          </Tabs>
        ) : (
          <div className="flex justify-center">
            <Badge className="bg-yellow-500 text-yellow-950 text-lg px-4 py-2">
              <Crown className="h-4 w-4 mr-2" />
              PRO
            </Badge>
          </div>
        )}

        {/* Billing Toggle */}
        <div className="flex items-center justify-center gap-3">
          <span className={`text-sm ${!isAnnual ? "font-semibold" : "text-muted-foreground"}`}>Monthly</span>
          <Switch checked={isAnnual} onCheckedChange={setIsAnnual} />
          <span className={`text-sm ${isAnnual ? "font-semibold" : "text-muted-foreground"}`}>Annual</span>
          {isAnnual && (
            <Badge variant="secondary" className="bg-green-500/10 text-green-600 border-green-500/20">
              Save 20%
            </Badge>
          )}
        </div>

        {/* Pricing Card */}
        <Card className={effectivePlan === "pro" ? "border-primary/30" : "border-emerald-500/30"}>
          <CardHeader className="text-center pb-2">
            <Badge className={effectivePlan === "pro" ? "w-fit mx-auto bg-yellow-500 text-yellow-950" : "w-fit mx-auto bg-emerald-500 text-emerald-950"}>
              {effectivePlan === "pro" ? "PRO" : "PRO FOOTBALL"}
            </Badge>
            <CardTitle className="text-3xl mt-2">
              ${price}{" "}
              <span className="text-lg font-normal text-muted-foreground">
                AUD/{isAnnual ? "year" : "month"}
              </span>
            </CardTitle>
            {isAnnual && (
              <p className="text-sm text-green-600 font-medium">
                Save ${annualSavings} per year
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {features.map((feature) => (
              <div key={feature} className="flex items-center gap-3">
                <div className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 ${
                  effectivePlan === "pro" ? "bg-primary/20" : "bg-emerald-500/20"
                }`}>
                  <Check className={`h-3 w-3 ${effectivePlan === "pro" ? "text-primary" : "text-emerald-500"}`} />
                </div>
                <span className="text-sm">{feature}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Button className="w-full" size="lg" onClick={() => setStep(user ? 3 : 2)}>
          Get Started
          <ChevronRight className="h-4 w-4 ml-2" />
        </Button>

        <SubscriptionLegalLinks />
      </div>
    );
  };

  const renderAuthStep = () => (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => setStep(1)} className="mb-2">
        <ChevronLeft className="h-4 w-4 mr-1" />
        Back
      </Button>

      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">Create Your Account</h2>
        <p className="text-muted-foreground">Sign up or sign in to continue</p>
      </div>

      <Card>
        <Tabs value={authMode} onValueChange={(v) => setAuthMode(v as "signin" | "signup")} className="w-full">
          <CardHeader className="pb-2">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
              <TabsTrigger value="signin">Sign In</TabsTrigger>
            </TabsList>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="redacted@example.invalid"
                  className="pl-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  className="pl-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
            <Button 
              className="w-full" 
              onClick={() => handleAuth(authMode)}
              disabled={authLoading2 || googleLoading}
            >
              {authLoading2 ? <Loader2 className="h-4 w-4 animate-spin" /> : authMode === "signup" ? "Create Account" : "Sign In"}
            </Button>
            
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or</span>
              </div>
            </div>
            
            <Button 
              variant="outline" 
              className="w-full" 
              onClick={handleGoogleSignIn}
              disabled={authLoading2 || googleLoading}
            >
              {googleLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Continue with Google
                </>
              )}
            </Button>
          </CardContent>
        </Tabs>
      </Card>
    </div>
  );

  const renderClubStep = () => (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => setStep(2)} className="mb-2">
        <ChevronLeft className="h-4 w-4 mr-1" />
        Back
      </Button>

      <Suspense fallback={<div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}>
      <FindOrCreateClubWizard
        defaultSport={selectedPlan === "pro_football" ? "Soccer" : clubSport}
        onClubCreated={(clubId) => {
          setCreatedClubId(clubId);
          setStep(4);
        }}
        onJoinRequestSent={(_clubId, clubName) => {
          // User chose to join an existing club - they'll need to wait for approval
          // For now they stay on this step with the confirmation shown inside the wizard
        }}
      />
      </Suspense>
    </div>
  );

  const renderTeamStep = () => (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => setStep(3)} className="mb-2">
        <ChevronLeft className="h-4 w-4 mr-1" />
        Back
      </Button>

      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">Create Your Team</h2>
        <p className="text-muted-foreground">Add your first team to {clubName}</p>
      </div>

      {/* Logo Upload */}
      <Card>
        <CardContent className="py-6">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <Avatar className="h-24 w-24 border-4 border-primary/20">
                <AvatarImage src={teamLogoUrl || undefined} />
                <AvatarFallback className="bg-primary/10 text-primary text-2xl">
                  {teamName.charAt(0)?.toUpperCase() || <Users className="h-8 w-8" />}
                </AvatarFallback>
              </Avatar>
              <label className="absolute bottom-0 right-0 p-2 rounded-full bg-primary cursor-pointer hover:bg-primary/90 transition-colors shadow-lg">
                <Camera className="h-4 w-4 text-primary-foreground" />
                <input type="file" accept="image/*" className="hidden" onChange={handleTeamLogoUpload} />
              </label>
            </div>
            <p className="text-sm text-muted-foreground">Tap to add logo</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="teamName">Team Name *</Label>
            <Input
              id="teamName"
              placeholder="e.g., U12 Dragons"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="h-12"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="teamLevelAge">Level / Age Group</Label>
            <Input
              id="teamLevelAge"
              placeholder="e.g., Under 12s, Division 2"
              value={teamLevelAge}
              onChange={(e) => setTeamLevelAge(e.target.value)}
              className="h-12"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="teamDescription">Description</Label>
            <Textarea
              id="teamDescription"
              placeholder="Optional team description..."
              value={teamDescription}
              onChange={(e) => setTeamDescription(e.target.value)}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <Button className="w-full" size="lg" onClick={handleCreateTeam} disabled={saving || !teamName.trim()}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (
          <>
            Continue
            <ChevronRight className="h-4 w-4 ml-2" />
          </>
        )}
      </Button>
    </div>
  );

  const renderActivateStep = () => {
    // Use effective plan in case sport was changed
    const effectivePlan = !showFootballOption && selectedPlan === "pro_football" ? "pro" : selectedPlan;
    const pricing = effectivePlan === "pro" ? PRICING.pro : PRICING.proFootball;
    const price = isAnnual ? pricing.annual : pricing.monthly;
    const tierName = effectivePlan === "pro" ? "Pro" : "Pro Football";

    // On native platforms, skip promo code step per App Store Guideline 3.1.1
    if (isNativePlatform()) {
      return (
        <div className="space-y-6">
          <Button variant="ghost" size="sm" onClick={() => setStep(4)} className="mb-2">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>

          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold">Setup Complete!</h2>
            <p className="text-muted-foreground">Your club and team have been created. You can upgrade to {tierName} from your team settings.</p>
          </div>

          <Button 
            className="w-full" 
            size="lg" 
            onClick={() => navigate(createdTeamId ? `/team/${createdTeamId}` : "/")}
          >
            <Check className="h-4 w-4 mr-2" />
            Go to {createdTeamId ? "Team" : "Home"}
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => setStep(4)} className="mb-2">
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back
        </Button>

        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold">Activate {tierName}</h2>
          <p className="text-muted-foreground">Enter your promo code to activate your subscription</p>
        </div>

        {/* Summary Card */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Plan</span>
              <Badge className={effectivePlan === "pro" ? "bg-yellow-500 text-yellow-950" : "bg-emerald-500 text-emerald-950"}>
                {tierName}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Billing</span>
              <span className="font-medium">{isAnnual ? "Annual" : "Monthly"}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Club</span>
              <span className="font-medium">{clubName}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Team</span>
              <span className="font-medium">{teamName}</span>
            </div>
            <div className="border-t pt-3 flex justify-between items-center">
              <span className="font-semibold">Total</span>
              <span className="text-xl font-bold text-primary">${price} AUD/{isAnnual ? "year" : "month"}</span>
            </div>
          </CardContent>
        </Card>

        {/* Promo Code Input */}
        <Card>
          <CardContent className="py-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="promoCode">Promo Code</Label>
              <div className="relative">
                <Ticket className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="promoCode"
                  placeholder="Enter promo code"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  className="pl-10 h-12 uppercase"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Button 
          className="w-full" 
          size="lg" 
          onClick={handleActivateSubscription} 
          disabled={isActivating || !promoCode.trim()}
        >
          {isActivating ? <Loader2 className="h-4 w-4 animate-spin" /> : (
            <>
              <Check className="h-4 w-4 mr-2" />
              Activate Subscription
            </>
          )}
        </Button>
      </div>
    );
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md space-y-6 animate-slide-up">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="p-4 rounded-2xl bg-primary glow-emerald">
            <Flame className="h-10 w-10 text-primary-foreground" />
          </div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold text-gradient-emerald">Ignite</h1>
            <Badge variant="secondary" className="text-xs">Pro</Badge>
          </div>
          <p className="text-sm font-medium text-muted-foreground">Club HQ</p>
        </div>

        {/* Progress Indicator */}
        {renderStepIndicator()}

        {/* Step Content */}
        {step === 1 && renderPlanSelection()}
        {step === 2 && renderAuthStep()}
        {step === 3 && renderClubStep()}
        {step === 4 && renderTeamStep()}
        {step === 5 && renderActivateStep()}
      </div>
    </div>
  );
}
