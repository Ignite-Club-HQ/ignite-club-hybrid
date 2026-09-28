import { useState, useEffect } from "react";
import { useParams, useSearchParams, Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trophy, Plus, Loader2, Check, X, Shield, Megaphone, Send, Settings, CircleCheck, Circle, ChevronDown, Users, Sparkles, CloudRain, CalendarClock, Bell, Pencil } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { CompetitionFixturesPanel, CompetitionLadderPanel } from "@/components/CompetitionFixturesPanel";
import CompetitionPlayerStatsPanel from "@/components/competitions/CompetitionPlayerStatsPanel";
import { CompetitionShareJoinLink } from "@/components/CompetitionShareJoinLink";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { ProFeatureLock } from "@/components/subscription/ProFeatureLock";
import { Crown } from "lucide-react";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { IcpCompetitionContent } from "@/components/competition/IcpCompetitionContent";
import {
  createLocalCompetitionSeason,
  getLocalCompetitionState,
  issueLocalCompetitionJoinToken,
  isLocalCompetitionCanisterUnavailable,
  registerLocalCompetitionTeam,
  recordLocalCompetitionMatch,
  setLocalCompetitionSeasonStatus,
  setLocalCompetitionMatchResult,
} from "@/lab/localCompetitionService";

export default function CompetitionDetailPage() {
  usePageTitle("Competition");
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return <IcpCompetitionDetailPage />;
  }

  return <SupabaseCompetitionDetailPage />;
}

function IcpCompetitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const localIcpPersona = user?.id?.startsWith("icp-") ? user.id.slice(4) : "member";
  const [seasonName, setSeasonName] = useState("");
  const [registrationTeamId, setRegistrationTeamId] = useState("");
  const [registrationClubId, setRegistrationClubId] = useState("");
  const [tokenTeamId, setTokenTeamId] = useState("");
  const [tokenExpiry, setTokenExpiry] = useState("");
  const [homeTeam, setHomeTeam] = useState("");
  const [awayTeam, setAwayTeam] = useState("");
  const [resultMatchId, setResultMatchId] = useState("");
  const [homeScore, setHomeScore] = useState("");
  const [awayScore, setAwayScore] = useState("");
  const { data: state, isLoading, error } = useQuery({
    queryKey: ["local-icp-competition", id, localIcpPersona],
    enabled: !!id,
    queryFn: () => getLocalCompetitionState(localIcpPersona, id!),
  });
  const competition = state?.competition;
  const unavailable = isLocalCompetitionCanisterUnavailable(error);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["local-icp-competition", id, localIcpPersona] });
  const seasonMutation = useMutation({
    mutationFn: () => {
      if (!id || !seasonName.trim()) throw new Error("Season name is required.");
      return createLocalCompetitionSeason(localIcpPersona, id, seasonName.trim());
    },
    onSuccess: async () => {
      setSeasonName("");
      await refresh();
      toast({ title: "Local ICP season created" });
    },
    onError: (mutationError: Error) => toast({ title: "Could not create season", description: mutationError.message, variant: "destructive" }),
  });
  const seasonStatusMutation = useMutation({
    mutationFn: ({ competitionId, status, revision }: { competitionId: string; status: string; revision: bigint }) =>
      setLocalCompetitionSeasonStatus(localIcpPersona, competitionId, status, revision),
    onSuccess: async () => {
      await refresh();
      toast({ title: "Local ICP season status updated" });
    },
    onError: (mutationError: Error) => toast({ title: "Could not update season status", description: mutationError.message, variant: "destructive" }),
  });
  const registerTeamMutation = useMutation({
    mutationFn: () => {
      if (!id || !registrationTeamId.trim()) throw new Error("Team ID is required.");
      const clubId = registrationClubId.trim() || competition?.organizer_club_id;
      if (!clubId) throw new Error("Club ID is required.");
      return registerLocalCompetitionTeam(localIcpPersona, id, registrationTeamId.trim(), clubId);
    },
    onSuccess: async () => {
      setRegistrationTeamId("");
      await refresh();
      toast({ title: "Local ICP team registered" });
    },
    onError: (mutationError: Error) => toast({ title: "Could not register team", description: mutationError.message, variant: "destructive" }),
  });
  const issueTokenMutation = useMutation({
    mutationFn: () => {
      if (!id || !tokenTeamId.trim()) throw new Error("Team ID is required.");
      const expiresAt = new Date(tokenExpiry);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
        throw new Error("Choose a future token expiry.");
      }
      return issueLocalCompetitionJoinToken(localIcpPersona, id, tokenTeamId.trim(), BigInt(expiresAt.getTime()));
    },
    onSuccess: async () => {
      setTokenTeamId("");
      setTokenExpiry("");
      await refresh();
      toast({ title: "Local ICP join token issued" });
    },
    onError: (mutationError: Error) => toast({ title: "Could not issue join token", description: mutationError.message, variant: "destructive" }),
  });
  const matchMutation = useMutation({
    mutationFn: () => {
      if (!id || !homeTeam.trim() || !awayTeam.trim()) throw new Error("Both team IDs are required.");
      return recordLocalCompetitionMatch(localIcpPersona, id, homeTeam.trim(), awayTeam.trim());
    },
    onSuccess: async () => {
      setHomeTeam("");
      setAwayTeam("");
      await refresh();
      toast({ title: "Local ICP match recorded" });
    },
    onError: (mutationError: Error) => toast({ title: "Could not record match", description: mutationError.message, variant: "destructive" }),
  });
  const resultMutation = useMutation({
    mutationFn: () => {
      const parsedHome = Number(homeScore);
      const parsedAway = Number(awayScore);
      if (!resultMatchId.trim()) throw new Error("Match ID is required.");
      if (!Number.isInteger(parsedHome) || parsedHome < 0 || !Number.isInteger(parsedAway) || parsedAway < 0) {
        throw new Error("Scores must be non-negative whole numbers.");
      }
      const match = state?.matches.find((candidate) => candidate.id === resultMatchId.trim());
      if (!match) throw new Error("Match not found in local canister state.");
      return setLocalCompetitionMatchResult(localIcpPersona, resultMatchId.trim(), parsedHome, parsedAway, match.revision);
    },
    onSuccess: async () => {
      setResultMatchId("");
      setHomeScore("");
      setAwayScore("");
      await refresh();
      toast({ title: "Local ICP match result saved" });
    },
    onError: (mutationError: Error) => toast({ title: "Could not save match result", description: mutationError.message, variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="p-6 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  if (error) {
    return (
      <div className="container max-w-3xl mx-auto px-4 py-10">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-6 space-y-4 text-center">
            <Trophy className="h-10 w-10 mx-auto text-muted-foreground" />
            <h1 className="text-lg font-semibold">
              {unavailable ? "Competition details need a local ICP canister" : "Competition details couldn't be loaded"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {unavailable
                ? "Deploy the local competition_domain canister to enable this page in ICP mode."
                : error.message}
            </p>
            <Button variant="outline" onClick={() => navigate("/competitions")}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to competitions
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!competition) {
    return <div className="p-6 text-center text-sm text-muted-foreground">Competition not found.</div>;
  }

  return (
    <IcpCompetitionContent
      competition={competition}
      state={state}
      onBack={() => navigate("/competitions")}
      registrationTeamId={registrationTeamId}
      registrationClubId={registrationClubId}
      onRegistrationTeamIdChange={setRegistrationTeamId}
      onRegistrationClubIdChange={setRegistrationClubId}
      onRegisterTeam={() => registerTeamMutation.mutate()}
      registerTeamPending={registerTeamMutation.isPending}
      seasonName={seasonName}
      onSeasonNameChange={setSeasonName}
      onCreateSeason={() => seasonMutation.mutate()}
      createSeasonPending={seasonMutation.isPending}
      homeTeam={homeTeam}
      awayTeam={awayTeam}
      onHomeTeamChange={setHomeTeam}
      onAwayTeamChange={setAwayTeam}
      onRecordMatch={() => matchMutation.mutate()}
      recordMatchPending={matchMutation.isPending}
      resultMatchId={resultMatchId}
      homeScore={homeScore}
      awayScore={awayScore}
      onResultMatchIdChange={setResultMatchId}
      onHomeScoreChange={setHomeScore}
      onAwayScoreChange={setAwayScore}
      onSaveResult={() => resultMutation.mutate()}
      saveResultPending={resultMutation.isPending}
      onActivateSeason={(args) => seasonStatusMutation.mutate(args)}
      activateSeasonPending={seasonStatusMutation.isPending}
      tokenTeamId={tokenTeamId}
      tokenExpiry={tokenExpiry}
      onTokenTeamIdChange={setTokenTeamId}
      onTokenExpiryChange={setTokenExpiry}
      onIssueToken={() => issueTokenMutation.mutate()}
      issueTokenPending={issueTokenMutation.isPending}
    />
  );
}

function SupabaseCompetitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const inviteFromUrl = searchParams.get("invite") === "1";
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/competitions");
  };

  // Clear the ?invite=1 param after we read it so refresh / back doesn't reopen the form.
  useEffect(() => {
    if (inviteFromUrl) {
      const next = new URLSearchParams(searchParams);
      next.delete("invite");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const { data: competition, isLoading } = useQuery({
    queryKey: ["competition", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitions")
        .select("*, clubs:organizer_club_id(id, name, kind)")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: isAdmin = false, isLoading: isAdminLoading } = useQuery({
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

  const organizerClubId = (competition as any)?.organizer_club_id ?? null;
  const { hasPro: organizerHasPro, isLoading: proLoading } = useClubProAccess(organizerClubId);
  const canManage = isAdmin && organizerHasPro;

  const { data: divisions = [], isLoading: divisionsLoading } = useQuery({
    queryKey: ["competition-divisions", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from("competition_divisions")
        .select("*")
        .eq("competition_id", id!)
        .order("sort_order");
      return data ?? [];
    },
  });

  const { data: entries = [] } = useQuery({
    queryKey: ["competition-entries", id],
    enabled: !!id,
    queryFn: async () => {
      // Soft-deleted teams are no longer participants and must not appear in the
      // entries list, counts or division allocation.
      const { data } = await supabase
        .from("competition_entries")
        .select("*, teams!inner(id, name, club_id, is_shell, shell_contact_name, shell_contact_email, deleted_at, clubs:club_id(name)), competition_divisions:division_id(name)")
        .eq("competition_id", id!)
        .is("teams.deleted_at", null)
        .order("created_at");
      return (data ?? []).filter((e: any) => !e?.teams?.deleted_at);
    },
  });


  // Summary metrics for header
  const { data: summary } = useQuery({
    queryKey: ["competition-summary", id],
    enabled: !!id,
    queryFn: async () => {
      const [{ count: matchCount }, { data: firstMatch }] = await Promise.all([
        supabase.from("competition_matches").select("id", { count: "exact", head: true }).eq("competition_id", id!),
        supabase.from("competition_matches").select("scheduled_at").eq("competition_id", id!).not("scheduled_at", "is", null).order("scheduled_at", { ascending: true }).limit(1).maybeSingle(),
      ]);
      return { matchCount: matchCount ?? 0, firstScheduledAt: firstMatch?.scheduled_at ?? null };
    },
  });

  // Teams the current user can manage (for accept/decline)
  const { data: myAdminTeamIds = [] } = useQuery<string[]>({
    queryKey: ["my-admin-team-ids", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("team_id")
        .eq("user_id", user!.id)
        .in("role", ["team_admin", "coach", "club_admin"]);
      return Array.from(
        new Set((data ?? []).map((r: any) => r.team_id).filter((teamId): teamId is string => typeof teamId === "string")),
      );
    },
  });

  const respondToInvite = async (entryId: string, status: "accepted" | "declined") => {
    const { error } = await supabase
      .from("competition_entries")
      .update({ status, responded_by: user!.id, responded_at: new Date().toISOString() })
      .eq("id", entryId);
    if (error) {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: status === "accepted" ? "Invite accepted" : "Invite declined" });
    qc.invalidateQueries({ queryKey: ["competition-entries", id] });
    qc.invalidateQueries({ queryKey: ["competition-pending-invites"] });
  };

  if (isLoading) {
    return <div className="p-6 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!competition) {
    return <div className="p-6 text-center text-sm text-muted-foreground">Competition not found.</div>;
  }
  if (competition.status === "draft" && !isAdmin) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground space-y-3">
        <p>This competition hasn't been published yet.</p>
        <Button variant="outline" size="sm" onClick={goBack}>Go back</Button>
      </div>
    );
  }

  const ladderVisibilityLoading = (!!user && isAdminLoading) || divisionsLoading;
  const hasHiddenDivisionLadder = divisions.some((d: any) => !!d.hide_ladder);
  const canViewLadder = !ladderVisibilityLoading && (isAdmin || !hasHiddenDivisionLadder);

  return (
    <div className="container max-w-3xl mx-auto px-4 py-4 space-y-4">
      <header className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" className="-ml-2 h-9 w-9 shrink-0" aria-label="Go back" onClick={goBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg sm:text-xl font-bold break-words flex-1 min-w-0 leading-tight">{competition.name}</h1>
          {canManage && !(competition.source === "playhq" && competition.clubs?.kind !== "association") && (
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Open competition broadcasts"
                  title="Send announcements to all accepted teams"
                  className="h-9 min-h-11 sm:min-h-9 px-2.5 sm:px-3 rounded-full gap-1.5 shrink-0 border-border/70 hover:border-primary/50 hover:bg-primary/5 hover:text-primary font-semibold whitespace-nowrap"
                >
                  <Megaphone className="h-4 w-4" />
                  <span className="text-[13px] hidden xs:inline sm:inline">Broadcast</span>
                  <BroadcastsHeaderBadge competitionId={id!} />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="bottom"
                className="h-[90dvh] max-h-[90dvh] p-0 rounded-t-[20px] border-t-0 flex flex-col gap-0 overflow-hidden"
              >
                <BroadcastsPanel
                  competitionId={id!}
                  competitionName={competition.name}
                  divisions={divisions}
                  acceptedTeamCount={entries.filter((e: any) => e.status === "accepted").length}
                />
              </SheetContent>
            </Sheet>
          )}
          {canManage && (
            <Button asChild variant="ghost" size="icon" className="h-9 w-9 min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 shrink-0" aria-label="Competition settings" title="Competition settings">
              <Link to={`/competitions/${id}/settings`}><Settings className="h-[18px] w-[18px]" /></Link>
            </Button>
          )}
        </div>
        {(() => {
          const acceptedTeams = entries.filter((e: any) => e.status === "accepted").length;
          const matchCount = summary?.matchCount ?? 0;
          const start = summary?.firstScheduledAt ? new Date(summary.firstScheduledAt) : null;
          const parts: string[] = [];
          if (acceptedTeams) parts.push(`${acceptedTeams} ${acceptedTeams === 1 ? "Team" : "Teams"}`);
          if (matchCount) parts.push(`${matchCount} ${matchCount === 1 ? "Match" : "Matches"}`);
          if (start) parts.push(`Starts ${start.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`);
          if (competition.status === "draft") parts.push("Draft");
          else if (competition.visibility !== "public") parts.push("Private");
          return parts.length ? (
            <p className="text-[13px] text-muted-foreground tabular-nums leading-snug pl-1">{parts.join(" • ")}</p>
          ) : null;
        })()}
      </header>

      {isAdmin && !organizerHasPro && !proLoading && organizerClubId && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex items-start gap-3">
          <Crown className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Managing competitions is a Pro feature</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Upgrade the organiser club to Pro to edit settings, invite teams, manage fixtures and send broadcasts.
            </p>
          </div>
          <Button size="sm" onClick={() => navigate(`/clubs/${organizerClubId}/upgrade`)} className="shrink-0">
            Upgrade
          </Button>
        </div>
      )}

      {canManage && competition.status === "draft" && (
        <DraftSetupProgress
          competitionId={id!}
          divisionsCount={divisions.length}
          acceptedCount={entries.filter((e: any) => e.status === "accepted").length}
          invitedCount={entries.filter((e: any) => e.status === "invited").length}
        />
      )}

      <Tabs defaultValue={
        inviteFromUrl && isAdmin
          ? "teams"
          : entries.some((e: any) => e.status === "invited" && myAdminTeamIds.includes(e.team_id))
            ? "teams"
            : competition.status === "draft" && isAdmin ? "teams" : "fixtures"
      }>
        <TabsList className="w-full">
          <TabsTrigger value="fixtures" className="flex-1">Fixtures</TabsTrigger>
          {canViewLadder && <TabsTrigger value="ladder" className="flex-1">Ladder</TabsTrigger>}
          {competition.source === "playhq" && (
            <TabsTrigger value="stats" className="flex-1">Stats</TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="teams" className="flex-1">
              Teams{entries.length > 0 ? ` (${entries.length})` : ""}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="fixtures" className="space-y-2">
          <CompetitionFixturesPanel competitionId={id!} isAdmin={canManage} divisions={divisions} entries={entries} source={competition.source} />
        </TabsContent>

        {canViewLadder && (
          <TabsContent value="ladder" className="space-y-2">
            <CompetitionLadderPanel competitionId={id!} divisions={divisions} isAdmin={canManage} />
          </TabsContent>
        )}

        {competition.source === "playhq" && (
          <TabsContent value="stats" className="space-y-2 mt-2">
            <CompetitionPlayerStatsPanel competitionId={id!} sport={competition.sport} />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="teams" className="space-y-2 mt-2">
            {canManage && competition.source !== "playhq" && (
              <>
                {/* Primary actions — equal-weight recruitment CTAs */}
                <div className="flex gap-2">
                  <div className="flex-1">
                    <InviteTeamForm
                      competitionId={id!}
                      divisions={divisions}
                      defaultOpen={inviteFromUrl}
                      onDone={() => qc.invalidateQueries({ queryKey: ["competition-entries", id] })}
                    />
                  </div>
                  <div className="flex-1">
                    <CompetitionShareJoinLink
                      competitionId={id!}
                      competitionName={competition.name}
                      triggerVariant="default"
                      triggerClassName="w-full"
                    />
                  </div>
                </div>
                {/* Secondary action — competition setup */}
                <div className="flex">
                  <AddDivisionForm
                    competitionId={id!}
                    onDone={() => qc.invalidateQueries({ queryKey: ["competition-divisions", id] })}
                  />
                </div>
              </>
            )}

            <TeamsByDivision
              competitionId={id!}
              divisions={divisions}
              entries={entries}
              myAdminTeamIds={myAdminTeamIds}
              onRespond={respondToInvite}
              isAdmin={canManage}
            />
          </TabsContent>
        )}

      </Tabs>
    </div>
  );
}

function DraftSetupProgress({
  competitionId,
  divisionsCount,
  acceptedCount,
  invitedCount,
}: {
  competitionId: string;
  divisionsCount: number;
  acceptedCount: number;
  invitedCount: number;
}) {
  const skipKey = `ignite_comp_skip_divisions_${competitionId}`;
  const [divisionsSkipped, setDivisionsSkipped] = useState<boolean>(() => {
    try { return localStorage.getItem(skipKey) === "1"; } catch { return false; }
  });
  const skipDivisions = () => {
    try { localStorage.setItem(skipKey, "1"); } catch {}
    setDivisionsSkipped(true);
  };

  const { data: matchesCount = 0 } = useQuery({
    queryKey: ["competition-matches-count", competitionId],
    queryFn: async () => {
      const { count } = await supabase
        .from("competition_matches")
        .select("id", { count: "exact", head: true })
        .eq("competition_id", competitionId);
      return count ?? 0;
    },
  });

  const steps = [
    {
      key: "invite",
      label: "Invite teams",
      done: invitedCount + acceptedCount > 0,
      hint:
        invitedCount + acceptedCount === 0
          ? "Send invites to the teams you want in this competition."
          : `${invitedCount + acceptedCount} invited · ${acceptedCount} accepted`,
      dismissible: false,
    },
    {
      key: "divisions",
      label: "Add divisions",
      done: divisionsCount > 0,
      hint:
        divisionsCount === 0
          ? "Optional — group teams by age, gender or skill."
          : `${divisionsCount} division${divisionsCount === 1 ? "" : "s"}`,
      dismissible: divisionsCount === 0,
    },
    {
      key: "fixtures",
      label: "Generate fixtures",
      done: matchesCount > 0,
      hint:
        acceptedCount < 2
          ? "Needs at least 2 accepted teams."
          : matchesCount > 0
            ? `${matchesCount} match${matchesCount === 1 ? "" : "es"} scheduled`
            : "Use 'Generate round-robin' on the Fixtures tab.",
      dismissible: false,
    },
    {
      key: "publish",
      label: "Publish competition",
      done: false,
      hint: "Open Settings and switch from Draft to Published.",
      dismissible: false,
    },
  ].filter((s) => !(s.key === "divisions" && divisionsSkipped));

  return (
    <Card className="border-primary/30 bg-primary/[0.03]">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Set up your competition</h2>
          <Badge variant="outline" className="ml-auto text-[11px]">Draft</Badge>
        </div>
        <ol className="space-y-2">
          {steps.map((s) => (
            <li key={s.key} className="flex items-start gap-2 text-sm">
              {s.done ? (
                <CircleCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className={s.done ? "font-medium line-through text-muted-foreground" : "font-medium"}>
                  {s.label}
                </div>
                <div className="text-xs text-muted-foreground">{s.hint}</div>
              </div>
              {s.dismissible && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 -mt-1 -mr-1 text-muted-foreground hover:text-foreground"
                  onClick={s.key === "divisions" ? skipDivisions : undefined}
                  aria-label={`Dismiss ${s.label}`}
                  title="Skip this step"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function TeamsByDivision({
  competitionId,
  divisions,
  entries,
  myAdminTeamIds,
  onRespond,
  isAdmin,
}: {
  competitionId: string;
  divisions: any[];
  entries: any[];
  myAdminTeamIds: string[];
  onRespond: (entryId: string, status: "accepted" | "declined") => void;
  isAdmin: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [moveConfirm, setMoveConfirm] = useState<{
    entryId: string;
    teamId: string;
    teamName: string;
    fromDivisionId: string | null;
    toDivisionId: string | null;
    toName: string;
    affectedMatchCount: number;
  } | null>(null);
  const [clearFixtures, setClearFixtures] = useState(true);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const requestAssignDivision = async (entry: any, divisionId: string | null) => {
    if ((entry.division_id ?? null) === (divisionId ?? null)) return;
    const toName = divisionId
      ? (divisions.find((d: any) => d.id === divisionId)?.name ?? "Unassigned")
      : "Unassigned";
    const divFilter = [entry.division_id, divisionId].filter(Boolean) as string[];
    let count = 0;
    try {
      let q = supabase
        .from("competition_matches")
        .select("id", { count: "exact", head: true })
        .eq("competition_id", competitionId)
        .or(`home_team_id.eq.${entry.team_id},away_team_id.eq.${entry.team_id}`);
      if (divFilter.length > 0) q = q.in("division_id", divFilter);
      const { count: c } = await q;
      count = c ?? 0;
    } catch {
      count = 0;
    }
    if (count === 0) {
      await doAssignDivision(entry.id, divisionId, false, entry.team_id, divFilter);
      return;
    }
    setClearFixtures(true);
    setMoveConfirm({
      entryId: entry.id,
      teamId: entry.team_id,
      teamName: entry.teams?.name ?? "Team",
      fromDivisionId: entry.division_id ?? null,
      toDivisionId: divisionId,
      toName,
      affectedMatchCount: count,
    });
  };

  const doAssignDivision = async (
    entryId: string,
    divisionId: string | null,
    alsoClear: boolean,
    teamId?: string,
    affectedDivisionIds: string[] = [],
  ) => {
    setSavingId(entryId);
    const { error } = await supabase
      .from("competition_entries")
      .update({ division_id: divisionId })
      .eq("id", entryId);
    if (error) {
      setSavingId(null);
      toast({ title: "Could not move team", description: error.message, variant: "destructive" });
      return;
    }
    let cleared = false;
    if (alsoClear && teamId) {
      // IMPORTANT: never delete completed matches — those carry the team's
      // points/results which now follow them to the new division via the
      // competition_ladder view. Only clear scheduled/pending fixtures.
      let dq = supabase
        .from("competition_matches")
        .delete()
        .eq("competition_id", competitionId)
        .neq("status", "completed")
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`);
      if (affectedDivisionIds.length > 0) dq = dq.in("division_id", affectedDivisionIds);
      const { error: delErr } = await dq;
      if (delErr) {
        toast({ title: "Team moved, fixtures not cleared", description: delErr.message, variant: "destructive" });
      } else {
        cleared = true;
      }
    }
    setSavingId(null);
    toast({
      title: "Team moved",
      description: cleared
        ? "Affected fixtures cleared. Open the Fixtures tab to regenerate."
        : alsoClear ? undefined : "Existing fixtures kept as-is.",
    });
    qc.invalidateQueries({ queryKey: ["competition-entries", competitionId] });
    qc.invalidateQueries({ queryKey: ["competition-matches", competitionId] });
    qc.invalidateQueries({ queryKey: ["competition-ladder", competitionId] });
  };
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No teams yet.</p>;
  }

  const groups: { id: string | null; name: string; meta?: string; entries: any[] }[] = [];
  for (const d of divisions) {
    groups.push({
      id: d.id,
      name: d.name,
      meta: [d.age_group, d.gender, d.skill_level].filter(Boolean).join(" · "),
      entries: entries.filter((e: any) => e.division_id === d.id),
    });
  }
  const unassigned = entries.filter((e: any) => !e.division_id);
  if (unassigned.length > 0 && divisions.length > 0) {
    groups.push({ id: null, name: "Unassigned", entries: unassigned });
  } else if (divisions.length === 0 && unassigned.length > 0) {
    groups.push({ id: null, name: "", entries: unassigned });
  }

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.id ?? "unassigned"} className="space-y-1.5">

          {(g.name || g.entries.length > 0) && (
            <div className="flex items-baseline justify-between">
              <div>
                {g.name && <h3 className="text-sm font-semibold">{g.name}</h3>}
                {g.meta && <p className="text-xs text-muted-foreground">{g.meta}</p>}
              </div>
              {g.name && (
                <span className="text-xs text-muted-foreground">
                  {g.entries.length} team{g.entries.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}
          {g.entries.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No teams in this division yet.</p>
          ) : (
            g.entries.map((e: any) => {
              const canRespond = e.status === "invited" && myAdminTeamIds.includes(e.team_id);
              const statusBadge = e.teams?.is_shell ? (
                <Badge variant="outline">Awaiting signup</Badge>
              ) : e.status === "accepted" ? (
                <Badge variant="default">Accepted</Badge>
              ) : e.status === "invited" ? (
                <Badge variant="secondary">Invite sent</Badge>
              ) : (
                <Badge variant="outline" className="capitalize">{e.status}</Badge>
              );
              return (
                <Card key={e.id}>
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate leading-tight">{e.teams?.name}</div>
                        <div className="text-xs text-muted-foreground truncate leading-tight">
                          {e.teams?.clubs?.name || "—"}
                        </div>
                        {e.teams?.is_shell && (
                          <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                            Invited: {e.teams?.shell_contact_name ? `${e.teams.shell_contact_name} · ` : ""}{e.teams?.shell_contact_email}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0">{statusBadge}</div>
                    </div>

                    {(canRespond || (isAdmin && divisions.length > 0 && e.status !== "declined")) && (
                      <div className="flex items-center gap-2">
                        {canRespond && (
                          <div className="flex gap-1">
                            <Button size="sm" onClick={() => onRespond(e.id, "accepted")} aria-label="Accept invite">
                              <Check className="h-4 w-4 mr-1" />
                              Accept
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => onRespond(e.id, "declined")} aria-label="Decline invite">
                              <X className="h-4 w-4 mr-1" />
                              Decline
                            </Button>
                          </div>
                        )}
                        {isAdmin && divisions.length > 0 && e.status !== "declined" && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 ml-auto text-xs font-normal"
                                disabled={savingId === e.id}
                              >
                                {divisions.find((d: any) => d.id === e.division_id)?.name ?? "Unassigned"}
                                <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => requestAssignDivision(e, null)}>
                                Unassigned
                              </DropdownMenuItem>
                              {divisions.map((d: any) => (
                                <DropdownMenuItem key={d.id} onClick={() => requestAssignDivision(e, d.id)}>
                                  {d.name}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })

          )}
        </div>
      ))}
      <Dialog open={!!moveConfirm} onOpenChange={(o) => { if (!o && !confirmBusy) setMoveConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move team to {moveConfirm?.toName}?</DialogTitle>
            <DialogDescription>
              {moveConfirm?.teamName} has {moveConfirm?.affectedMatchCount} existing fixture
              {moveConfirm?.affectedMatchCount === 1 ? "" : "s"} in the affected division
              {moveConfirm?.fromDivisionId && moveConfirm?.toDivisionId ? "s" : ""}.
              Moving the team won't update those fixtures automatically.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer">
            <Checkbox checked={clearFixtures} onCheckedChange={(v) => setClearFixtures(!!v)} className="mt-0.5" />
            <span className="text-sm">
              Also clear upcoming/unplayed fixtures involving this team in the affected division{moveConfirm?.fromDivisionId && moveConfirm?.toDivisionId ? "s" : ""} so they can be regenerated.
              <span className="block text-xs text-muted-foreground mt-1">
                Completed match results are kept — the team's existing points carry across to the new division automatically. You'll need to re-run "Generate round-robin" in the Fixtures tab afterwards.
              </span>
            </span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveConfirm(null)} disabled={confirmBusy}>Cancel</Button>
            <Button
              disabled={confirmBusy}
              onClick={async () => {
                if (!moveConfirm) return;
                setConfirmBusy(true);
                const divs = [moveConfirm.fromDivisionId, moveConfirm.toDivisionId].filter(Boolean) as string[];
                await doAssignDivision(moveConfirm.entryId, moveConfirm.toDivisionId, clearFixtures, moveConfirm.teamId, divs);
                setConfirmBusy(false);
                setMoveConfirm(null);
              }}
            >
              {confirmBusy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {clearFixtures ? "Move & clear fixtures" : "Move team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function BroadcastsHeaderBadge({ competitionId }: { competitionId: string }) {
  const { data } = useQuery({
    queryKey: ["competition-broadcasts-count", competitionId],
    queryFn: async () => {
      const { count } = await supabase
        .from("competition_broadcasts")
        .select("id", { count: "exact", head: true })
        .eq("competition_id", competitionId);
      return count ?? 0;
    },
    staleTime: 60_000,
  });
  if (data == null) return null;
  if (data === 0) {
    return (
      <span className="ml-0.5 hidden sm:inline-flex items-center px-1.5 py-px rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
        New
      </span>
    );
  }
  return (
    <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary/15 text-primary text-[10px] font-bold tabular-nums">
      {data > 99 ? "99+" : data}
    </span>
  );
}

const BROADCAST_TEMPLATES: { id: string; label: string; icon: any; text: string }[] = [
  { id: "fixtures", label: "Fixture Update", icon: CalendarClock, text: "Round fixtures have been updated — please check the schedule for your latest match details." },
  { id: "weather", label: "Weather Alert", icon: CloudRain, text: "Weather update: please monitor conditions ahead of this weekend's fixtures. Further updates to follow if matches are affected." },
  { id: "competition", label: "Competition Update", icon: Sparkles, text: "Quick update from the competition organisers — " },
  { id: "reminder", label: "Reminder", icon: Bell, text: "Friendly reminder: " },
  { id: "custom", label: "Custom", icon: Pencil, text: "" },
];

function BroadcastsPanel({ competitionId, competitionName, divisions, acceptedTeamCount }: { competitionId: string; competitionName: string; divisions: any[]; acceptedTeamCount: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const [selectedDivisionIds, setSelectedDivisionIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [showDivisions, setShowDivisions] = useState(false);

  const MAX_LEN = 1000;

  const { data: history = [] } = useQuery({
    queryKey: ["competition-broadcasts", competitionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("competition_broadcasts")
        .select("*")
        .eq("competition_id", competitionId)
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  const toggleDivision = (divId: string) => {
    setSelectedDivisionIds((prev) => {
      const next = new Set(prev);
      if (next.has(divId)) next.delete(divId); else next.add(divId);
      return next;
    });
  };

  const applyTemplate = (id: string) => {
    const tmpl = BROADCAST_TEMPLATES.find((t) => t.id === id);
    if (!tmpl) return;
    setActiveTemplate(id);
    if (tmpl.text) setMessage(tmpl.text);
  };

  const recipientCount = selectedDivisionIds.size > 0
    ? acceptedTeamCount // we don't know per-division count; show total as best-effort
    : acceptedTeamCount;

  const send = async () => {
    if (!message.trim()) return;
    setSending(true);
    const { data, error } = await supabase.functions.invoke("send-competition-broadcast", {
      body: {
        competition_id: competitionId,
        message: message.trim(),
        division_ids: selectedDivisionIds.size > 0 ? Array.from(selectedDivisionIds) : null,
      },
    });
    setSending(false);
    if (error || (data as any)?.error) {
      toast({ title: "Could not send broadcast", description: (data as any)?.error || error?.message, variant: "destructive" });
      return;
    }
    const count = (data as any).recipient_team_count;
    try { (navigator as any).vibrate?.(15); } catch {}
    toast({ title: `Broadcast sent to ${count} team${count === 1 ? "" : "s"}` });
    setMessage("");
    setActiveTemplate(null);
    setSelectedDivisionIds(new Set());
    qc.invalidateQueries({ queryKey: ["competition-broadcasts", competitionId] });
  };

  const initials = competitionName.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const recentThree = history.slice(0, 3);

  return (
    <div className="flex flex-col h-full min-h-0 bg-muted/30">
      {/* Drag handle */}
      <div className="pt-2 pb-1 flex justify-center shrink-0">
        <div className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
      </div>

      {/* Header */}
      <div className="px-5 pb-3 shrink-0">
        <SheetHeader className="space-y-1 text-left">
          <SheetTitle className="text-[22px] font-bold tracking-tight leading-tight">Competition Broadcast</SheetTitle>
          <p className="text-sm text-muted-foreground leading-snug">Send an announcement to teams in this competition</p>
        </SheetHeader>
        <div className="mt-2.5">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
            <Trophy className="h-3 w-3" />
            <span className="truncate max-w-[240px]">{competitionName}</span>
          </span>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4 space-y-4">
        {/* Audience Card */}
        <div className="rounded-2xl bg-card border border-border/60 shadow-sm p-4 flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Users className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-foreground">Recipients</span>
              {acceptedTeamCount > 0 && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px] font-semibold uppercase tracking-wider">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Ready
                </span>
              )}
            </div>
            <p className="text-[13px] text-muted-foreground leading-snug mt-0.5">
              <span className="font-semibold text-foreground">{acceptedTeamCount} accepted team{acceptedTeamCount === 1 ? "" : "s"}</span> will receive this broadcast
            </p>
            {divisions.length > 0 && (
              <button
                type="button"
                onClick={() => setShowDivisions((v) => !v)}
                className="mt-1 text-[11px] font-medium text-primary hover:underline"
              >
                {selectedDivisionIds.size > 0
                  ? `Limited to ${selectedDivisionIds.size} division${selectedDivisionIds.size === 1 ? "" : "s"}`
                  : "Limit to specific divisions"}
                <ChevronDown className={`inline h-3 w-3 ml-0.5 transition-transform ${showDivisions ? "rotate-180" : ""}`} />
              </button>
            )}
          </div>
        </div>

        {showDivisions && divisions.length > 0 && (
          <div className="rounded-2xl bg-card border border-border/60 shadow-sm p-2 space-y-0.5 animate-fade-in">
            {divisions.map((d: any) => (
              <label key={d.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer text-sm">
                <Checkbox checked={selectedDivisionIds.has(d.id)} onCheckedChange={() => toggleDivision(d.id)} />
                <span className="flex-1">{d.name}</span>
              </label>
            ))}
          </div>
        )}

        {/* Template chips */}
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-0.5">Quick templates</div>
          <div className="flex flex-wrap gap-1.5">
            {BROADCAST_TEMPLATES.map((t) => {
              const Icon = t.icon;
              const active = activeTemplate === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-foreground border-border/60 hover:border-primary/40 hover:bg-primary/5"
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Composer */}
        <div className="rounded-2xl bg-card border border-border/60 shadow-sm overflow-hidden">
          <Textarea
            id="broadcast-msg"
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MAX_LEN))}
            rows={5}
            placeholder="Write your competition announcement..."
            className="border-0 shadow-none focus-visible:ring-0 resize-none text-[15px] leading-relaxed min-h-[120px] bg-transparent"
          />
          <div className="flex items-center justify-between px-3 py-2 border-t border-border/40 text-[11px] text-muted-foreground">
            <span>Posts to each team's chat as an official announcement</span>
            <span className={`tabular-nums ${message.length > MAX_LEN * 0.9 ? "text-amber-600 font-semibold" : ""}`}>
              {message.length}/{MAX_LEN}
            </span>
          </div>
        </div>

        {/* Live Preview */}
        {message.trim() && (
          <div className="space-y-1.5 animate-fade-in">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-0.5">Preview</div>
            <div className="rounded-2xl bg-card border border-border/60 shadow-sm p-3.5">
              <div className="flex items-start gap-2.5">
                <div className="h-9 w-9 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[12px] font-bold shrink-0">
                  {initials || <Trophy className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[13px] font-semibold text-foreground truncate">{competitionName}</span>
                    <span className="inline-flex items-center px-1.5 py-px rounded text-[9px] font-bold uppercase tracking-wider bg-primary/10 text-primary">
                      Announcement
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-none mt-0.5">Just now</div>
                  <div className="mt-2 text-[14px] text-foreground whitespace-pre-wrap leading-relaxed break-words">
                    {message}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Recent broadcasts */}
        {recentThree.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-0.5">Recent broadcasts</div>
            <div className="space-y-2">
              {recentThree.map((b: any) => (
                <div key={b.id} className="rounded-2xl bg-card border border-border/60 shadow-sm p-3.5">
                  <div className="text-[14px] text-foreground line-clamp-2 leading-snug">{b.message}</div>
                  <div className="flex items-center justify-between mt-2 gap-2">
                    <div className="text-[11px] text-muted-foreground">
                      {formatDistanceToNow(new Date(b.created_at), { addSuffix: true })} · Sent to {b.recipient_team_count} team{b.recipient_team_count === 1 ? "" : "s"}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px] font-semibold text-primary hover:text-primary"
                      onClick={() => { setMessage(b.message); setActiveTemplate(null); }}
                    >
                      Reuse
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sticky footer */}
      <div
        className="shrink-0 border-t border-border/60 bg-background/95 px-5 pt-3 flex items-center gap-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
      >
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-muted-foreground leading-none">Sending to</div>
          <div className="text-[13px] font-semibold text-foreground leading-tight mt-0.5">
            {recipientCount} team{recipientCount === 1 ? "" : "s"}
          </div>
        </div>
        <Button
          size="lg"
          onClick={send}
          disabled={!message.trim() || sending || acceptedTeamCount === 0}
          className="h-12 px-6 rounded-xl font-semibold text-[15px] shadow-md min-w-[160px]"
        >
          {sending ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending...</>
          ) : (
            <><Send className="h-4 w-4 mr-2" /> Send Broadcast</>
          )}
        </Button>
      </div>
    </div>
  );
}

function InviteTeamForm({ competitionId, divisions, defaultOpen, onDone }: { competitionId: string; divisions: any[]; defaultOpen?: boolean; onDone: () => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [open, setOpen] = useState(!!defaultOpen);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [teamId, setTeamId] = useState("");
  const [divisionId, setDivisionId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [clubFilterId, setClubFilterId] = useState<string>("");
  const [clubSearch, setClubSearch] = useState("");

  // "Not on Ignite yet" fields
  const [newTeamName, setNewTeamName] = useState("");
  const [newClubName, setNewClubName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  const { data: clubs = [] } = useQuery({
    queryKey: ["clubs-for-team-invite", clubSearch],
    enabled: open && mode === "existing",
    queryFn: async () => {
      let q = supabase.from("clubs").select("id, name").order("name").limit(50);
      if (clubSearch.trim()) q = q.ilike("name", `%${clubSearch.trim()}%`);
      const { data } = await q;
      return data ?? [];
    },
  });

  const selectedClub = clubs.find((c: any) => c.id === clubFilterId);

  const { data: teams = [] } = useQuery({
    queryKey: ["all-teams-for-invite", search, clubFilterId],
    enabled: open && mode === "existing",
    queryFn: async () => {
      let q = supabase.from("teams").select("id, name, clubs:club_id(name)").order("name").limit(50);
      if (search.trim()) q = q.ilike("name", `%${search.trim()}%`);
      if (clubFilterId) q = q.eq("club_id", clubFilterId);
      const { data } = await q;
      return data ?? [];
    },
  });

  const submitExisting = async () => {
    if (!teamId) return;
    setSaving(true);
    const { error } = await supabase.from("competition_entries").insert({
      competition_id: competitionId,
      team_id: teamId,
      division_id: divisionId || null,
      invited_by: user!.id,
      status: "invited",
    });
    setSaving(false);
    if (error) {
      toast({ title: "Could not invite team", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Team invited" });
    setTeamId(""); setDivisionId(""); setOpen(false); onDone();
  };

  const submitNew = async () => {
    const tName = newTeamName.trim();
    const email = contactEmail.trim().toLowerCase();
    if (!tName) { toast({ title: "Team name required", variant: "destructive" }); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: "Valid contact email required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("invite_shell_team_to_competition", {
      p_competition_id: competitionId,
      p_team_name: tName,
      p_club_name: newClubName.trim() || null,
      p_contact_name: contactName.trim() || null,
      p_contact_email: email,
      p_division_id: divisionId || null,
    });
    if (error || !data || !(data as any[]).length) {
      setSaving(false);
      toast({ title: "Could not send invite", description: error?.message || "Unknown error", variant: "destructive" });
      return;
    }
    const row: any = (data as any[])[0];
    const claimLink = `${window.location.origin}/claim-team?token=${row.token}`;
    try {
      await supabase.functions.invoke("send-email", {
        body: {
          to: email,
          subject: `You're invited to join a competition on Ignite`,
          template: "team-invite",
          templateData: {
            recipientName: contactName.trim() || email.split("@")[0],
            invitedEmail: email,
            teamName: tName,
            clubName: newClubName.trim() || tName,
            roleName: "Team Admin",
            inviteLink: claimLink,
          },
        },
      });
    } catch (err) {
      console.error("send-email failed", err);
    }
    setSaving(false);
    toast({ title: "Invite sent", description: `Magic link emailed to ${email}` });
    setNewTeamName(""); setNewClubName(""); setContactName(""); setContactEmail(""); setDivisionId("");
    setOpen(false); onDone();
  };

  const selectedTeam = teams.find((t: any) => t.id === teamId);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" className="w-full">
          <Plus className="h-4 w-4 mr-1" /> Invite team
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] overflow-y-auto rounded-t-2xl p-0"
      >
        <SheetHeader className="px-4 pt-5 pb-3 border-b">
          <SheetTitle className="text-base">Invite a team</SheetTitle>
        </SheetHeader>
        <div className="px-4 py-4 space-y-3">
          <div className="flex gap-1 rounded-md bg-muted p-1 text-xs">
            <button
              type="button"
              onClick={() => setMode("existing")}
              className={`flex-1 rounded px-2 py-1.5 ${mode === "existing" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
            >
              On Ignite
            </button>
            <button
              type="button"
              onClick={() => setMode("new")}
              className={`flex-1 rounded px-2 py-1.5 ${mode === "new" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
            >
              Not on Ignite yet
            </button>
          </div>

          {mode === "existing" ? (
            <>
              <p className="text-xs text-muted-foreground">Search for an existing team — optionally filter by club to narrow it down.</p>
              <div className="space-y-1.5">
                <Label>Filter by club (optional)</Label>
                {selectedClub ? (
                  <div className="mt-1 flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                    <div className="text-sm font-medium">{selectedClub.name}</div>
                    <Button size="sm" variant="ghost" onClick={() => { setClubFilterId(""); setClubSearch(""); setTeamId(""); }}>Clear</Button>
                  </div>
                ) : (
                  <>
                    <Input
                      value={clubSearch}
                      onChange={(e) => setClubSearch(e.target.value)}
                      placeholder="Search clubs"
                    />
                    {clubSearch.trim().length > 0 && (
                      <div className="mt-2 max-h-40 overflow-y-auto rounded-md border divide-y">
                        {clubs.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-muted-foreground">No clubs found.</div>
                        ) : clubs.map((c: any) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => { setClubFilterId(c.id); setClubSearch(""); setTeamId(""); }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                          >
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="competition-invite-team-search">Find team</Label>
                {selectedTeam ? (
                  <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                    <div className="text-sm">
                      <span className="font-medium">{selectedTeam.name}</span>
                      {selectedTeam.clubs?.name ? <span className="text-muted-foreground"> — {selectedTeam.clubs.name}</span> : null}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => { setTeamId(""); setSearch(""); }}>Change</Button>
                  </div>
                ) : (
                  <>
                    <Input
                      id="competition-invite-team-search"
                      value={search}
                      onChange={(e) => { setSearch(e.target.value); setTeamId(""); }}
                      placeholder="Search by team name"
                    />
                    {(search.trim().length > 0 || clubFilterId) && (
                      <div className="mt-2 max-h-56 overflow-y-auto rounded-md border divide-y">
                        {teams.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-muted-foreground">No teams found.</div>
                        ) : teams.map((t: any) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => { setTeamId(t.id); setSearch(""); }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                          >
                            <div className="font-medium">{t.name}</div>
                            {t.clubs?.name && <div className="text-xs text-muted-foreground">{t.clubs.name}</div>}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">We'll create a placeholder team and email a magic link so the contact can claim it. Fixtures and ladder work immediately.</p>
              <div className="space-y-1.5">
                <Label>Team name *</Label>
                <Input value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="e.g. Basket Range U14 Red" />
              </div>
              <div className="space-y-1.5">
                <Label>Club name (optional)</Label>
                <Input value={newClubName} onChange={(e) => setNewClubName(e.target.value)} placeholder="e.g. Basket Range Cricket Club" />
              </div>
              <div className="space-y-1.5">
                <Label>Contact name (optional)</Label>
                <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="e.g. Sam Smith" />
              </div>
              <div className="space-y-1.5">
                <Label>Contact email *</Label>
                <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="redacted@example.invalid" />
                <p className="text-[11px] text-muted-foreground">This person will receive the invite and become the first team admin when they claim it.</p>
              </div>
            </>
          )}

          {divisions.length > 0 && (
            <div className="space-y-1.5">
              <Label>Division (optional)</Label>
              <Select value={divisionId} onValueChange={setDivisionId}>
                <SelectTrigger><SelectValue placeholder="No division" /></SelectTrigger>
                <SelectContent>
                  {divisions.map((d: any) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="sticky bottom-0 left-0 right-0 flex gap-2 border-t bg-background px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          <Button variant="ghost" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
          {mode === "existing" ? (
            <Button className="flex-1" onClick={submitExisting} disabled={!teamId || saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send invite"}
            </Button>
          ) : (
            <Button className="flex-1" onClick={submitNew} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send invite"}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AddDivisionForm({ competitionId, onDone }: { competitionId: string; onDone: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ageGroup, setAgeGroup] = useState("");
  const [gender, setGender] = useState("");
  const [playWeekdays, setPlayWeekdays] = useState<number[]>([]);
  const [dayStart, setDayStart] = useState("09:00");
  const [dayEnd, setDayEnd] = useState("16:00");
  const [saving, setSaving] = useState(false);

  const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const toggleWeekday = (d: number) => {
    setPlayWeekdays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());
  };

  const submit = async () => {
    if (!name.trim()) return;
    if (dayEnd <= dayStart) {
      toast({ title: "Day window invalid", description: "Latest kickoff must be after earliest.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("competition_divisions").insert({
      competition_id: competitionId,
      name: name.trim(),
      age_group: ageGroup.trim() || null,
      gender: gender || null,
      play_weekdays: playWeekdays.length ? playWeekdays : null,
      day_start_time: dayStart,
      day_end_time: dayEnd,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Could not add division", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Division added" });
    setName(""); setAgeGroup(""); setGender("");
    setPlayWeekdays([]); setDayStart("09:00"); setDayEnd("16:00");
    setOpen(false); onDone();
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" /> Add division
      </Button>
    );
  }


  return (
    <Card className="w-full">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Add a new division</h3>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
        </div>
        <p className="text-xs text-muted-foreground">Divisions group teams (e.g. by age or skill) so fixtures and ladders are organised.</p>
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. U12 Mixed Div 1" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Age group</Label>
            <Input value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)} placeholder="e.g. U12" />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mixed">Mixed</SelectItem>
                <SelectItem value="boys">Boys</SelectItem>
                <SelectItem value="girls">Girls</SelectItem>
                <SelectItem value="mens">Men's</SelectItem>
                <SelectItem value="womens">Women's</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="pt-2 border-t">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Scheduling defaults</Label>
          <p className="text-xs text-muted-foreground mt-1 mb-2">
            Used when generating fixtures for this division. Leave weekdays empty for "any day".
          </p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {WEEKDAY_SHORT.map((label, i) => {
              const active = playWeekdays.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleWeekday(i)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-foreground border-border hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Earliest kickoff</Label>
              <Input type="time" value={dayStart} onChange={(e) => setDayStart(e.target.value)} />
            </div>
            <div>
              <Label>Latest kickoff</Label>
              <Input type="time" value={dayEnd} onChange={(e) => setDayEnd(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button size="sm" onClick={submit} disabled={!name.trim() || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}
