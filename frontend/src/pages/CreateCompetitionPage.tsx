import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Loader2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfileById } from "@/lib/profileCache";
import { SPORT_EMOJIS } from "@/lib/sportEmojis";
import { usePageTitle } from "@/hooks/usePageTitle";
import { ensureFreshSession } from "@/lib/ensureFreshSession";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { useUserHasAnyClubPro } from "@/hooks/useUserHasAnyClubPro";
import { ProFeatureLock } from "@/components/subscription/ProFeatureLock";
import { cn } from "@/lib/utils";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { createLocalCompetition } from "@/lab/localCompetitionService";

const SPORTS = Object.keys(SPORT_EMOJIS);
const PERSONAL_ORGANISER = "__personal__";

const VISIBILITY_LABELS: Record<string, string> = {
  private: "Private",
  unlisted: "Unlisted",
  public: "Public",
};

export default function CreateCompetitionPage() {
  usePageTitle("New competition");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return <IcpCreateCompetitionPage preselectedOrganizer={searchParams.get("organizer")} />;
  }

  return <SupabaseCreateCompetitionPage />;
}

function IcpCreateCompetitionPage({ preselectedOrganizer }: { preselectedOrganizer: string | null }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const localIcpPersona = user?.id?.startsWith("icp-") ? user.id.slice(4) : "member";
  const [name, setName] = useState("");
  const [season, setSeason] = useState("");
  const [clubId, setClubId] = useState(preselectedOrganizer || "local-club");

  const createMutation = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      const trimmedSeason = season.trim();
      const trimmedClubId = clubId.trim();
      if (!trimmedName) throw new Error("Competition name is required.");
      if (!trimmedSeason) throw new Error("Season is required.");
      if (!trimmedClubId) throw new Error("Local club ID is required.");
      return createLocalCompetition(localIcpPersona, trimmedClubId, trimmedName, trimmedSeason);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["local-icp-competitions", localIcpPersona] });
      toast({ title: "Local ICP competition created" });
      navigate("/competitions");
    },
    onError: (error: Error) => {
      toast({
        title: "Could not create local ICP competition",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="container max-w-2xl mx-auto px-4 pt-4 pb-32">
      <div className="flex items-center gap-2 mb-3">
        <Button variant="ghost" size="icon" className="-ml-2 shrink-0" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Trophy className="h-5 w-5 text-primary shrink-0" />
        <h1 className="text-xl font-semibold leading-none">New local ICP competition</h1>
      </div>
      <p className="text-[13px] text-muted-foreground mb-5 pl-10">
        Creates the supported local canister competition record only. Invitations, visibility, descriptions, and external sync stay disabled.
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          createMutation.mutate();
        }}
        className="space-y-5"
      >
        <div className="space-y-1.5">
          <label htmlFor="icp-name" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground pl-1">
            Competition name
          </label>
          <Input
            id="icp-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Twilight Twenty 2026"
            required
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="icp-season" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground pl-1">
            Season
          </label>
          <Input
            id="icp-season"
            value={season}
            onChange={(event) => setSeason(event.target.value)}
            placeholder="2026"
            required
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="icp-club-id" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground pl-1">
            Local club ID
          </label>
          <Input
            id="icp-club-id"
            value={clubId}
            onChange={(event) => setClubId(event.target.value)}
            placeholder="local-club"
            required
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create local ICP competition
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate("/competitions")}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

function SupabaseCreateCompetitionPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedOrganizer = searchParams.get("organizer");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sport, setSport] = useState("");
  const [season, setSeason] = useState("");
  const [organizerClubId, setOrganizerClubId] = useState(preselectedOrganizer || PERSONAL_ORGANISER);
  const [visibility, setVisibility] = useState<"private" | "unlisted" | "public">("private");
  const [saving, setSaving] = useState(false);

  const { data: organisers = [], isLoading: loadingClubs } = useQuery({
    queryKey: ["my-organiser-clubs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("club_id, role, clubs:club_id(id, name, kind)")
        .eq("user_id", user!.id)
        .in("role", ["club_admin", "association_admin", "app_admin"]);
      const seen = new Set<string>();
      return (data ?? [])
        .map((r: any) => r.clubs)
        .filter((c: any) => c && c.kind !== "shell" && !seen.has(c.id) && (seen.add(c.id), true));
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!user || !name.trim() || !organizerClubId) return;
    setSaving(true);

    try {
      await ensureFreshSession();
    } catch (err: any) {
      setSaving(false);
      toast({ title: "Session expired", description: "Please sign in again and retry.", variant: "destructive" });
      return;
    }

    const trimmedName = name.trim();
    const trimmedDesc = description.trim() || null;
    const trimmedSport = sport || null;
    const trimmedSeason = season.trim() || null;

    if (organizerClubId === PERSONAL_ORGANISER) {
      // Atomic personal-organiser creation via transactional RPC.
      const { data: profile } = await selectCachedProfileById(user.id);
      const who = profile?.display_name?.trim() || "My";
      const shellName = `${who}'s competitions`;

      const { data, error } = await supabase.rpc("create_personal_competition", {
        p_name: trimmedName,
        p_description: trimmedDesc,
        p_sport: trimmedSport,
        p_season: trimmedSeason,
        p_visibility: visibility,
        p_shell_name: shellName,
      });
      setSaving(false);
      if (error) {
        toast({ title: "Could not create competition", description: error.message, variant: "destructive" });
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      const newId = row?.competition_id;
      if (!newId) {
        toast({ title: "Could not create competition", description: "Unexpected response from server.", variant: "destructive" });
        return;
      }
      toast({ title: "Competition created" });
      navigate(`/competitions/${newId}`);
      return;
    }

    // Existing behaviour: competition created under an existing organiser club.
    const { data, error } = await supabase
      .from("competitions")
      .insert({
        name: trimmedName,
        description: trimmedDesc,
        sport: trimmedSport,
        season: trimmedSeason,
        organizer_club_id: organizerClubId,
        visibility,
        status: "draft",
        created_by: user.id,
      })
      .select("id")
      .single();
    setSaving(false);
    if (error || !data) {
      toast({ title: "Could not create competition", description: error?.message, variant: "destructive" });
      return;
    }
    toast({ title: "Competition created" });
    navigate(`/competitions/${data.id}`);
  };

  const kindLabel = (kind: string) =>
    kind === "association" ? "Association" : kind === "full" ? "Club" : kind;

  const organiserValueLabel = (() => {
    if (organizerClubId === PERSONAL_ORGANISER) return "Personal (just me)";
    const c = organisers.find((c: any) => c.id === organizerClubId);
    return c?.name ?? "Choose";
  })();

  return (
    <div className="container max-w-2xl mx-auto px-4 pt-4 pb-32">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Button variant="ghost" size="icon" className="-ml-2 shrink-0" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Trophy className="h-5 w-5 text-primary shrink-0" />
        <h1 className="text-xl font-semibold leading-none">New competition</h1>
      </div>
      <p className="text-[13px] text-muted-foreground mb-5 pl-10">
        Create a competition and invite teams to join.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Primary field: name */}
        <div className="space-y-1.5">
          <label htmlFor="name" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground pl-1">
            Competition name
          </label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Twilight Twenty 2026"
            required
            className="h-14 rounded-2xl bg-muted/40 border-border/60 px-4 text-base font-medium placeholder:font-normal placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary"
          />
        </div>

        {/* Grouped settings card */}
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground pl-1">
            Details
          </div>
          <div className="rounded-2xl bg-muted/40 border border-border/60 overflow-hidden divide-y divide-border/50">
            {/* Organiser */}
            <SettingsRow label="Organiser">
              <Select value={organizerClubId} onValueChange={setOrganizerClubId}>
                <SettingsSelectTrigger>{organiserValueLabel}</SettingsSelectTrigger>
                <SelectContent>
                  <SelectItem value={PERSONAL_ORGANISER}>Personal organiser (just me)</SelectItem>
                  {!loadingClubs && organisers.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} <span className="text-muted-foreground">· {kindLabel(c.kind)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>

            {/* Sport */}
            <SettingsRow label="Sport">
              <Select value={sport} onValueChange={setSport}>
                <SettingsSelectTrigger placeholder>{sport || "Optional"}</SettingsSelectTrigger>
                <SelectContent>
                  {SPORTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </SettingsRow>

            {/* Season */}
            <SettingsRow label="Season">
              <Input
                value={season}
                onChange={(e) => setSeason(e.target.value)}
                placeholder="e.g. 2026"
                className="h-9 w-28 border-0 bg-transparent text-right text-sm font-medium px-0 focus-visible:ring-0 placeholder:text-muted-foreground/60"
              />
            </SettingsRow>

            {/* Visibility */}
            <SettingsRow label="Visibility">
              <Select value={visibility} onValueChange={(v: any) => setVisibility(v)}>
                <SettingsSelectTrigger>{VISIBILITY_LABELS[visibility]}</SettingsSelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Private — admins and entered teams only</SelectItem>
                  <SelectItem value="unlisted">Unlisted — admins and entered teams only</SelectItem>
                  <SelectItem value="public">Public — anyone signed in</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label htmlFor="description" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground pl-1">
            Description
          </label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Add competition details (optional)"
            className="rounded-2xl bg-muted/40 border-border/60 px-4 py-3 text-sm resize-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary"
          />
        </div>
      </form>

      {/* Sticky bottom action */}
      <div
        className="fixed left-0 right-0 z-40 bg-background border-t border-border/60 px-4 pt-3"
        style={{ bottom: "var(--bottom-nav-height, 56px)", paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="container max-w-2xl mx-auto px-0">
          <CreateCompetitionSubmitButton
            organizerClubId={organizerClubId === PERSONAL_ORGANISER ? null : organizerClubId}
            saving={saving}
            name={name}
            onSubmit={() => handleSubmit(new Event("submit") as any)}
          />
        </div>
      </div>
    </div>
  );
}

function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 min-h-[52px]">
      <div className="text-sm text-foreground/80">{label}</div>
      <div className="flex-1 flex justify-end min-w-0">{children}</div>
    </div>
  );
}

function SettingsSelectTrigger({ children, placeholder }: { children: React.ReactNode; placeholder?: boolean }) {
  return (
    <SelectTrigger
      className={cn(
        "h-9 border-0 bg-transparent px-0 py-0 shadow-none focus:ring-0 focus-visible:ring-0 gap-1.5 [&>svg:last-child]:hidden text-sm font-medium justify-end max-w-full",
        placeholder && "text-muted-foreground font-normal"
      )}
    >
      <span className="truncate text-right">{children}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </SelectTrigger>
  );
}

function CreateCompetitionSubmitButton({
  organizerClubId,
  saving,
  name,
  onSubmit,
}: {
  organizerClubId: string | null;
  saving: boolean;
  name: string;
  onSubmit: () => void;
}) {
  const scoped = useClubProAccess(organizerClubId);
  const any = useUserHasAnyClubPro();
  const hasPro = organizerClubId ? scoped.hasPro : any.hasAnyClubPro;
  const loading = organizerClubId ? scoped.isLoading : any.isLoading;

  if (!loading && !hasPro) {
    return (
      <ProFeatureLock
        title="Competitions is a Pro feature"
        description="Upgrade the organiser club to Pro to create competitions."
        clubId={organizerClubId}
      />
    );
  }
  return (
    <Button
      type="button"
      onClick={onSubmit}
      disabled={saving || !name.trim()}
      className="w-full h-12 rounded-2xl text-base font-semibold"
    >
      {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
      Create competition
    </Button>
  );
}
