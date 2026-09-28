import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { Loader2, CheckCircle2, AlertCircle, Trophy, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/hooks/usePageTitle";
import { safeSessionSet, buildAuthPathWithIntent } from "@/lib/authRedirectStorage";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { claimLocalCompetitionJoinToken } from "@/lab/localCompetitionService";

type CompInfo = {
  id: string;
  name: string;
  organizer_club_id: string;
  organizer_club_name: string | null;
  sport: string | null;
  season: string | null;
  status: string;
};
type Division = { id: string; name: string };
type TeamOpt = { id: string; name: string; club_id: string; club_name: string | null };

const ENTERED_STATUSES = new Set(["accepted", "invited"]);

export default function CompetitionJoinPage() {
  usePageTitle("Join competition");
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return <IcpCompetitionJoinPage />;
  }

  return <SupabaseCompetitionJoinPage />;
}

function IcpCompetitionJoinPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const localIcpPersona = user?.id?.startsWith("icp-") ? user.id.slice(4) : "member";
  const [token, setToken] = useState(searchParams.get("token") || "");
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);

  const handleClaim = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      toast({ title: "Join token is required", variant: "destructive" });
      return;
    }
    setClaiming(true);
    try {
      const result = await claimLocalCompetitionJoinToken(localIcpPersona, trimmedToken);
      setClaimed(true);
      toast({ title: "Local ICP join token claimed", description: result || "The token was accepted." });
    } catch (error) {
      toast({
        title: "Could not claim local ICP join token",
        description: error instanceof Error ? error.message : "The local canister rejected the token.",
        variant: "destructive",
      });
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="container max-w-md mx-auto px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" /> Join local ICP competition
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This local path claims the supported competition join token. Team selection, division assignment, and membership changes remain disabled until their canister methods exist.
          </p>
          <form onSubmit={handleClaim} className="space-y-3">
            <Label htmlFor="icp-join-token">Join token</Label>
            <Input
              id="icp-join-token"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste the local ICP join token"
              disabled={claiming || claimed}
            />
            <Button type="submit" disabled={claiming || claimed} className="w-full">
              {claiming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {claimed ? "Token claimed" : "Claim token"}
            </Button>
          </form>
          {claimed && (
            <Button variant="outline" onClick={() => navigate("/competitions")} className="w-full">
              Back to competitions
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SupabaseCompetitionJoinPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [comp, setComp] = useState<CompInfo | null>(null);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [teams, setTeams] = useState<TeamOpt[]>([]);
  const [enteredTeamIds, setEnteredTeamIds] = useState<Set<string>>(new Set());
  const [teamId, setTeamId] = useState<string>("");
  const [divisionId, setDivisionId] = useState<string>("");
  const [teamSearch, setTeamSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string>("");
  const [done, setDone] = useState(false);

  // Load competition info + token status (works pre-auth via SECURITY DEFINER RPCs)
  useEffect(() => {
    if (!token) {
      setError("This join link is missing its token. Ask the organiser for a fresh link.");
      setLoading(false);
      return;
    }
    (async () => {
      const [{ data: compRows, error: cErr }, { data: divRows }, { data: statusVal }] =
        await Promise.all([
          supabase.rpc("get_competition_by_join_token", { p_token: token }),
          supabase.rpc("list_divisions_by_join_token", { p_token: token }),
          supabase.rpc("get_competition_join_token_status", { p_token: token }),
        ]);

      if (cErr || !compRows || !(compRows as any[]).length) {
        const status = (statusVal as unknown as string) || "unknown";
        if (status === "disabled") {
          setError("The organiser has disabled this join link. Ask them for a new one.");
        } else if (status === "archived") {
          setError("This competition has been archived and is no longer accepting entries.");
        } else {
          setError("This join link isn't recognised. Double-check the URL or ask the organiser for a new one.");
        }
        setLoading(false);
        return;
      }
      setComp((compRows as any[])[0]);
      setDivisions((divRows as any[]) || []);
      setLoading(false);
    })();
  }, [token]);

  // Load user's admin teams + already-entered teams once signed in
  useEffect(() => {
    if (!user) return;
    (async () => {
      // 1) Direct team-admin rows (team-scoped)
      const teamAdminRowsP = supabase
        .from("user_roles")
        .select("team_id, teams:team_id(id, name, club_id, clubs:club_id(name))")
        .eq("user_id", user.id)
        .in("role", ["team_admin", "app_admin"])
        .not("team_id", "is", null);

      // 2) Club-scoped admin/app_admin rows → expand to all teams in those clubs
      const clubAdminRowsP = supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user.id)
        .in("role", ["club_admin", "app_admin"])
        .not("club_id", "is", null);

      // 3) Teams already entered in this comp (any status)
      const enteredP = supabase.rpc("list_entered_team_ids_by_join_token", { p_token: token });

      const [
        { data: teamRows },
        { data: clubRows },
        { data: enteredRows },
      ] = await Promise.all([teamAdminRowsP, clubAdminRowsP, enteredP]);

      const seen = new Set<string>();
      const opts: TeamOpt[] = [];

      for (const row of (teamRows as any[]) || []) {
        const t = row.teams;
        if (!t || seen.has(t.id)) continue;
        seen.add(t.id);
        opts.push({ id: t.id, name: t.name, club_id: t.club_id, club_name: t.clubs?.name ?? null });
      }

      const clubIds = Array.from(
        new Set(((clubRows as any[]) || []).map((r) => r.club_id).filter(Boolean))
      );
      if (clubIds.length > 0) {
        const { data: clubTeams } = await supabase
          .from("teams")
          .select("id, name, club_id, clubs:club_id(name)")
          .in("club_id", clubIds);
        for (const t of (clubTeams as any[]) || []) {
          if (seen.has(t.id)) continue;
          seen.add(t.id);
          opts.push({ id: t.id, name: t.name, club_id: t.club_id, club_name: t.clubs?.name ?? null });
        }
      }

      opts.sort((a, b) => a.name.localeCompare(b.name));
      setTeams(opts);

      const entered = new Set<string>(
        ((enteredRows as any[]) || [])
          .filter((r) => ENTERED_STATUSES.has(r.status))
          .map((r) => r.team_id as string)
      );
      setEnteredTeamIds(entered);

      // Auto-select only if exactly one eligible (not already-entered) team
      const eligible = opts.filter((o) => !entered.has(o.id));
      if (eligible.length === 1) setTeamId(eligible[0].id);
    })();
  }, [user, token]);

  const filteredTeams = useMemo(() => {
    const q = teamSearch.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.club_name ?? "").toLowerCase().includes(q)
    );
  }, [teams, teamSearch]);

  const requireSignIn = () => {
    // Guarded storage: an unguarded write throws in restricted webviews and
    // used to abort before `navigate`, making the button look dead.
    const nextPath = `/competitions/join?token=${token}`;
    safeSessionSet("redirectAfterAuth", nextPath);
    console.log("[SignupFlow] CompetitionJoin → /auth", { nextPath });
    navigate(buildAuthPathWithIntent({ next: nextPath, mode: "signup" }));
  };

  const handleJoin = async () => {
    if (!user) return requireSignIn();
    if (!teamId) {
      toast({ title: "Pick a team to enter", variant: "destructive" });
      return;
    }
    if (enteredTeamIds.has(teamId)) {
      // Already entered — just take them to the competition page
      navigate(`/competitions/${comp!.id}`);
      return;
    }
    if (divisions.length > 0 && !divisionId) {
      toast({ title: "Pick a division", variant: "destructive" });
      return;
    }
    setJoining(true);
    const { data, error } = await supabase.rpc("join_competition_with_token", {
      p_token: token,
      p_team_id: teamId,
      p_division_id: divisionId || null,
    });
    setJoining(false);
    if (error) {
      const msg = (error.message || "").toLowerCase();
      let friendly = error.message;
      if (msg.includes("not_team_admin")) friendly = "You don't have admin rights for that team.";
      else if (msg.includes("invalid_token")) friendly = "This join link is no longer valid.";
      else if (msg.includes("team_not_found")) friendly = "That team could not be found.";
      else if (msg.includes("auth_required")) friendly = "Please sign in first.";
      toast({ title: "Could not join", description: friendly, variant: "destructive" });
      return;
    }
    setDone(true);
    const compId = (data as any[])?.[0]?.competition_id;
    setTimeout(() => navigate(`/competitions/${compId}`), 1200);
  };

  const goStartTeam = () => {
    const back = `/competitions/join?token=${token}`;
    safeSessionSet("redirectAfterAuth", back);
    safeSessionSet("pendingCompetitionJoinToken", token ?? "");
    navigate("/teams/new");
  };

  const heading = useMemo(() => comp?.name ?? "Competition", [comp]);
  const selectedAlreadyEntered = teamId && enteredTeamIds.has(teamId);
  const eligibleCount = teams.filter((t) => !enteredTeamIds.has(t.id)).length;

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !comp) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <AlertCircle className="h-10 w-10 text-destructive mx-auto" />
            <p>{error || "Competition not found."}</p>
            <Button asChild variant="outline"><Link to="/">Go home</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <CheckCircle2 className="h-10 w-10 text-primary mx-auto" />
            <p className="font-medium">You're in!</p>
            <p className="text-sm text-muted-foreground">Taking you to {heading}…</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Trophy className="h-4 w-4" /> Join competition
          </div>
          <CardTitle>{heading}</CardTitle>
          {comp.organizer_club_name && (
            <p className="text-sm text-muted-foreground">
              Organised by {comp.organizer_club_name}
              {comp.season ? ` · ${comp.season}` : ""}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!user ? (
            <>
              <p className="text-sm">Sign in to enter one of your teams in this competition.</p>
              <Button className="w-full" onClick={requireSignIn}>Sign in to join</Button>
            </>
          ) : teams.length === 0 ? (
            <>
              <p className="text-sm">
                You don't admin any teams yet. Start a team to enter it in this competition.
              </p>
              <Button className="w-full" onClick={goStartTeam}>Start a new team</Button>
              <Button asChild variant="outline" className="w-full">
                <Link to="/teams">Go to my teams</Link>
              </Button>
            </>
          ) : eligibleCount === 0 ? (
            <>
              <p className="text-sm">
                All of your teams are already entered in this competition.
              </p>
              <Button className="w-full" onClick={() => navigate(`/competitions/${comp.id}`)}>
                View competition
              </Button>
              <Button variant="outline" className="w-full" onClick={goStartTeam}>
                Enter a new team
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Choose team</Label>
                {teams.length > 8 && (
                  <div className="relative">
                    <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={teamSearch}
                      onChange={(e) => setTeamSearch(e.target.value)}
                      placeholder="Search teams…"
                      className="pl-8"
                    />
                  </div>
                )}
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger><SelectValue placeholder="Select a team" /></SelectTrigger>
                  <SelectContent>
                    {filteredTeams.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-muted-foreground">
                        No teams match "{teamSearch}".
                      </div>
                    ) : filteredTeams.map((t) => {
                      const already = enteredTeamIds.has(t.id);
                      return (
                        <SelectItem key={t.id} value={t.id} disabled={already}>
                          <span className="flex items-center gap-2">
                            <span>{t.name}{t.club_name ? ` · ${t.club_name}` : ""}</span>
                            {already && (
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                already in
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={goStartTeam}
                  className="text-xs text-primary underline underline-offset-2"
                >
                  Don't see your team? Start a new one
                </button>
              </div>

              {divisions.length > 0 && !selectedAlreadyEntered && (
                <div className="space-y-2">
                  <Label>Division</Label>
                  <Select value={divisionId} onValueChange={setDivisionId}>
                    <SelectTrigger><SelectValue placeholder="Pick a division" /></SelectTrigger>
                    <SelectContent>
                      {divisions.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Button
                className="w-full"
                onClick={handleJoin}
                disabled={
                  joining ||
                  !teamId ||
                  (!selectedAlreadyEntered && divisions.length > 0 && !divisionId)
                }
              >
                {joining && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {selectedAlreadyEntered ? "View competition" : "Join competition"}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Organisers can remove teams later from the Teams tab.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
