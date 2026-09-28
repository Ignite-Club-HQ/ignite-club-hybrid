import { useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { cn } from "@/lib/utils";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { ProFeatureLock } from "@/components/subscription/ProFeatureLock";
import { CompetitionAdminsCard } from "@/components/competitions/CompetitionAdminsCard";
import { CompetitionMemberChatCard } from "@/components/competitions/CompetitionMemberChatCard";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabCompetitionSettings } from "@/lab/fixtureDataLayer";
import { getLocalCompetition, isLocalCompetitionCanisterUnavailable } from "@/lab/localCompetitionService";

export default function CompetitionSettingsPage() {
  usePageTitle("Competition settings");
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return <IcpCompetitionSettingsPage />;
  }

  return <SupabaseCompetitionSettingsPage />;
}

function IcpCompetitionSettingsPage() {
  const { id = "competition-icp-001" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const persona = user?.id?.startsWith("icp-") ? user.id.slice(4) : "member";
  const { data: settings, error, isLoading } = useQuery({
    queryKey: ["icp-competition-settings", id, persona],
    queryFn: async () => {
      try {
        const competition = await getLocalCompetition(persona, id);
        return {
          name: competition.name,
          format: competition.season || "local",
          status: competition.status,
          visibility: competition.visibility,
          source: "icp" as const,
        };
      } catch (error) {
        if (!isLocalCompetitionCanisterUnavailable(error)) throw error;
        const fixture = getLocalLabCompetitionSettings(id);
        return {
          name: fixture.name,
          format: fixture.format,
          status: fixture.registration_open ? "registration_open" : "registration_closed",
          visibility: "local",
          source: "fixture" as const,
        };
      }
    },
  });

  return (
    <div className="container max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">Competition Settings</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        {settings?.source === "icp"
          ? "Loaded from the local competition_domain canister. Editing, administrators, and chat remain disabled until their contracts are connected."
          : "The local competition_domain canister is not configured. Showing a synthetic read-only preview; no Supabase request was made."}
      </p>
      {isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {error && <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Unable to load competition settings."}</p>}
      {settings && (
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-sm font-medium">{settings.name}</p>
            <p className="text-xs text-muted-foreground">Format: {settings.format}</p>
            <p className="text-xs text-muted-foreground">Status: {settings.status}</p>
            <p className="text-xs text-muted-foreground">Visibility: {settings.visibility}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SupabaseCompetitionSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data: competition, isLoading, refetch } = useQuery({
    queryKey: ["competition", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitions")
        .select("*, clubs:club_id(kind)")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: isAdmin = false, isLoading: adminLoading } = useQuery({
    queryKey: ["competition-isadmin", id, user?.id],
    enabled: !!id && !!user,
    queryFn: async () => {
      const { data } = await supabase.rpc("is_competition_admin", {
        _user_id: user!.id,
        _competition_id: id!,
      });
      return !!data;
    },
  });

  const { hasPro: organizerHasPro, isLoading: proLoading } = useClubProAccess(
    (competition as any)?.organizer_club_id ?? null,
  );

  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [visibility, setVisibility] = useState("");
  const [description, setDescription] = useState("");
  const [pointsWin, setPointsWin] = useState("3");
  const [pointsDraw, setPointsDraw] = useState("1");
  const [pointsLoss, setPointsLoss] = useState("0");
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  if (competition && !hydrated) {
    setName(competition.name);
    setStatus(competition.status);
    setVisibility(competition.visibility);
    setDescription(competition.description ?? "");
    setPointsWin(String(competition.points_win ?? 3));
    setPointsDraw(String(competition.points_draw ?? 1));
    setPointsLoss(String(competition.points_loss ?? 0));
    setHydrated(true);
  }

  // Derived dirty state — Save is a page-level action
  const initial = useMemo(() => competition ? ({
    name: competition.name ?? "",
    status: competition.status ?? "draft",
    visibility: competition.visibility ?? "private",
    description: competition.description ?? "",
    pointsWin: String(competition.points_win ?? 3),
    pointsDraw: String(competition.points_draw ?? 1),
    pointsLoss: String(competition.points_loss ?? 0),
  }) : null, [competition]);

  const current = { name, status, visibility, description, pointsWin, pointsDraw, pointsLoss };
  const isDirty = !!initial && (
    initial.name !== name ||
    initial.status !== status ||
    initial.visibility !== visibility ||
    initial.description !== description ||
    initial.pointsWin !== pointsWin ||
    initial.pointsDraw !== pointsDraw ||
    initial.pointsLoss !== pointsLoss
  );

  const [justSaved, setJustSaved] = useState(false);

  const clampPoint = (v: string) => {
    const n = Number.parseInt(v, 10);
    if (Number.isNaN(n) || n < 0) return "0";
    return String(n);
  };

  const save = async () => {
    if (!isDirty) return;
    setSaving(true);
    const { error } = await supabase
      .from("competitions")
      .update({
        name: name.trim(),
        status,
        visibility,
        description: description.trim() || null,
        points_win: Number.parseInt(pointsWin, 10) || 0,
        points_draw: Number.parseInt(pointsDraw, 10) || 0,
        points_loss: Number.parseInt(pointsLoss, 10) || 0,
      })
      .eq("id", competition!.id);
    setSaving(false);
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
    refetch();
  };

  if (isLoading || adminLoading) {
    return <div className="p-6 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!competition) {
    return <div className="p-6 text-center text-sm text-muted-foreground">Competition not found.</div>;
  }
  if (!isAdmin) {
    return (
      <div className="container max-w-3xl mx-auto px-4 py-6 space-y-4">
        <Button asChild variant="ghost" size="icon" className="-ml-2 h-11 w-11" aria-label={`Back to ${competition.name}`}>
          <Link to={`/competitions/${id}`}><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <p className="text-sm text-muted-foreground">You don't have permission to manage this competition.</p>
      </div>
    );
  }

  if (!organizerHasPro && !proLoading) {
    return (
      <div className="container max-w-3xl mx-auto px-4 py-6 space-y-4">
        <Button asChild variant="ghost" size="icon" className="-ml-2 h-11 w-11" aria-label={`Back to ${competition.name}`}>
          <Link to={`/competitions/${id}`}><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <ProFeatureLock
          title="Managing competitions is a Pro feature"
          description="Upgrade the organiser club to Pro to edit competition settings, fixtures and broadcasts."
          clubId={(competition as any).organizer_club_id}
        />
      </div>
    );
  }

  // Map DB status values to simplified UI options
  const statusOptions: { value: string; label: string }[] = [
    { value: "draft", label: "Draft" },
    { value: "active", label: "Published" },
    { value: "archived", label: "Archived" },
  ];
  // Preserve any legacy value (open, completed) so it isn't silently dropped
  if (!statusOptions.find((o) => o.value === status) && status) {
    statusOptions.splice(2, 0, { value: status, label: status.charAt(0).toUpperCase() + status.slice(1) });
  }

  const publicLinkOn = visibility === "public";
  const isPlayHqReadOnly = (competition as any).source === "playhq" && (competition as any).clubs?.kind !== "association";

  return (
    <div className="container max-w-3xl mx-auto px-4 py-6 pb-32 space-y-5">
      <div className="flex items-start gap-2">
        <Button asChild variant="ghost" size="icon" className="-ml-2 h-11 w-11 shrink-0" aria-label={`Back to ${competition.name}`}>
          <Link to={`/competitions/${id}`}><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <div className="space-y-1 pt-1.5">
          <h1 className="text-2xl font-bold leading-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage competition details, visibility and scoring.</p>
        </div>
      </div>

      {/* 1. Competition details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Competition details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="comp-name">Name</Label>
            <Input id="comp-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="comp-desc">Description</Label>
            <Textarea
              id="comp-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add competition details, rules or notes"
              rows={4}
              className="resize-y min-h-[96px]"
            />
          </div>
        </CardContent>
      </Card>

      {/* 2. Publishing — hidden for read-only PlayHQ comps */}
      {!isPlayHqReadOnly && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Publishing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="comp-status">Competition status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="comp-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statusOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 3. Ladder scoring — hidden for read-only PlayHQ comps (PlayHQ controls scoring) */}
      {!isPlayHqReadOnly && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Ladder scoring</CardTitle>
            <CardDescription>Set the points awarded for each result.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pts-win" className="text-xs">Win</Label>
                <Input
                  id="pts-win"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={pointsWin}
                  onChange={(e) => setPointsWin(e.target.value)}
                  onBlur={(e) => setPointsWin(clampPoint(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pts-draw" className="text-xs">Draw</Label>
                <Input
                  id="pts-draw"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={pointsDraw}
                  onChange={(e) => setPointsDraw(e.target.value)}
                  onBlur={(e) => setPointsDraw(clampPoint(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pts-loss" className="text-xs">Loss</Label>
                <Input
                  id="pts-loss"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={pointsLoss}
                  onChange={(e) => setPointsLoss(e.target.value)}
                  onBlur={(e) => setPointsLoss(clampPoint(e.target.value))}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 4. Ladder visibility — hidden for read-only PlayHQ comps */}
      {!isPlayHqReadOnly && <DivisionLadderVisibility competitionId={id!} />}

      {/* 5. Competition admins — manage per-competition admin access */}
      <CompetitionAdminsCard
        competitionId={id!}
        competitionName={competition.name}
        organizerClubId={(competition as any).organizer_club_id ?? null}
      />

      {/* 6. Competition-wide chat — opt-in thread for all members of entered teams */}
      <CompetitionMemberChatCard competitionId={id!} />




      {/* Sticky save bar — page-level action */}
      <div
        className={cn(
          "fixed inset-x-0 z-[45] border-t bg-background shadow-lg transition-transform",
          isDirty || justSaved ? "translate-y-0" : "translate-y-full"
        )}
        style={{
          bottom: "var(--bottom-nav-offset, calc(4rem + env(safe-area-inset-bottom, 1rem)))",
        }}
      >

        <div className="container max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {justSaved ? "Changes saved" : isDirty ? "You have unsaved changes" : ""}
          </p>
          <Button onClick={save} disabled={!isDirty || saving || !name.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : justSaved ? <Check className="h-4 w-4 mr-2" /> : null}
            {justSaved ? "Saved" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DivisionLadderVisibility({ competitionId }: { competitionId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: divisions = [], isLoading } = useQuery({
    queryKey: ["competition-divisions", competitionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("competition_divisions")
        .select("*")
        .eq("competition_id", competitionId)
        .order("sort_order");
      return data ?? [];
    },
  });

  const toggle = async (divisionId: string, hide: boolean) => {
    const { error } = await supabase
      .from("competition_divisions")
      .update({ hide_ladder: hide })
      .eq("id", divisionId);
    if (error) {
      toast({ title: "Could not update", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["competition-divisions", competitionId] });
    qc.invalidateQueries({ queryKey: ["competition-ladder", competitionId] });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Ladder visibility</CardTitle>
        <CardDescription>Choose which divisions or grades show a ladder. Fixtures and results stay visible.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : divisions.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-center">
            <p className="text-sm text-muted-foreground">No divisions yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Add divisions from the Teams tab to manage ladder visibility.</p>
          </div>
        ) : (
          <div className="divide-y border rounded-md">
            {divisions.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{d.name}</div>
                  {[d.age_group, d.gender, d.skill_level].filter(Boolean).length > 0 && (
                    <div className="text-xs text-muted-foreground truncate">
                      {[d.age_group, d.gender, d.skill_level].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">Hide ladder</span>
                  <Switch
                    checked={!!d.hide_ladder}
                    onCheckedChange={(v) => toggle(d.id, v)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
