import { useEffect, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/hooks/usePageTitle";
import { withFeatureBackend } from "@/live/featureRouter";
import { claimLiveShellTeam } from "@/live/features/club";

export default function ClaimTeamPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [status, setStatus] = useState<"idle" | "claiming" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [teamId, setTeamId] = useState<string | null>(null);
  usePageTitle("Claim your team");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMsg("Missing invite token.");
      return;
    }
    if (authLoading) return;
    if (!user) {
      sessionStorage.setItem("redirectAfterAuth", `/claim-team?token=${token}`);
      navigate("/auth", { replace: true });
      return;
    }
    if (status !== "idle") return;
    setStatus("claiming");
    (async () => {
      try {
        const teamId = await withFeatureBackend("membership", {
          supabase: async () => {
            const { data, error } = await supabase.rpc("claim_shell_team", { p_token: token });
            if (error || !data || !(data as any[]).length) {
              throw new Error(error?.message || "This invite is invalid or already used.");
            }
            return (data as any[])[0].team_id as string;
          },
          // Provisional: the canister's ClubTeam.id is the shell team's own
          // record id (no separate Supabase-style claim-row join).
          icp: async (ctx) => {
            const team = await claimLiveShellTeam(ctx, token);
            return (team as { id: string }).id;
          },
        });
        setTeamId(teamId);
        setStatus("done");
        toast({ title: "Team claimed", description: "You're now the team admin." });
      } catch (error) {
        setStatus("error");
        setErrorMsg(error instanceof Error ? error.message : "This invite is invalid or already used.");
      }
    })();
  }, [token, authLoading, user, status, navigate, toast]);

  return (
    <div className="container max-w-md mx-auto px-4 py-10">
      <Card>
        <CardContent className="p-6 space-y-4 text-center">
          {status === "idle" || status === "claiming" ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Claiming your team…</p>
            </>
          ) : status === "done" ? (
            <>
              <CheckCircle2 className="h-10 w-10 mx-auto text-primary" />
              <h1 className="text-lg font-semibold">You're in!</h1>
              <p className="text-sm text-muted-foreground">
                You've been added as the team admin. You can invite teammates, set up
                fixtures, and optionally connect to a club.
              </p>
              <div className="flex flex-col gap-2 pt-2">
                {teamId && (
                  <Button asChild>
                    <Link to={`/teams/${teamId}`}>Go to my team</Link>
                  </Button>
                )}
                <Button asChild variant="outline">
                  <Link to="/competitions">View competition</Link>
                </Button>
              </div>
            </>
          ) : (
            <>
              <AlertCircle className="h-10 w-10 mx-auto text-destructive" />
              <h1 className="text-lg font-semibold">Couldn't claim team</h1>
              <p className="text-sm text-muted-foreground">{errorMsg}</p>
              <Button asChild variant="outline">
                <Link to="/">Back to home</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
