import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, Loader2, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { safeSessionSet, buildAuthPathWithIntent } from "@/lib/authRedirectStorage";
import { officialLinkProblem, type OfficialLinkStatus } from "@/lib/officialLinkStatus";

const LABEL: Record<string, string> = { referee: "referee", committee: "committee member" };

type Info = { status: OfficialLinkStatus; competition_id: string | null; competition_name: string | null; role: string | null };

/** Landing page for a referee / committee join link or QR code. Roles are decided server-side only. */
export default function CompetitionOfficialJoinPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { user, loading: authLoading } = useAuth() as any;
  const navigate = useNavigate();
  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<null | "joined" | "already">(null);

  useEffect(() => {
    (async () => {
      if (!token) { setInfo({ status: "invalid", competition_id: null, competition_name: null, role: null }); setLoading(false); return; }
      const { data, error } = await (supabase as any).rpc("get_competition_role_link_status", { p_token: token });
      const row = (data as Info[] | null)?.[0];
      setInfo(error || !row ? { status: "invalid", competition_id: null, competition_name: null, role: null } : row);
      setLoading(false);
    })();
  }, [token]);

  const nextPath = `/competitions/officials/join?token=${encodeURIComponent(token)}`;

  const join = async () => {
    if (!user) {
      safeSessionSet("redirectAfterAuth", nextPath);
      try { localStorage.setItem("ignite_pending_official_link", nextPath); } catch { /* ignore */ }
      navigate(buildAuthPathWithIntent({ next: nextPath, mode: "signup" }));
      return;
    }
    setJoining(true);
    setProblem(null);
    const { data, error } = await (supabase as any).rpc("accept_competition_role_link", { p_token: token });
    setJoining(false);
    const row = (data as { status: OfficialLinkStatus | "joined" | "already"; competition_id: string | null; chat_group_id: string | null }[] | null)?.[0];
    if (error || !row) { setProblem("Something went wrong. Please try again."); return; }
    if (row.status !== "joined" && row.status !== "already") { setProblem(officialLinkProblem(row.status)); return; }
    try { localStorage.removeItem("ignite_pending_official_link"); } catch { /* ignore */ }
    setDone(row.status);
    const dest = row.chat_group_id ? `/groups/${row.chat_group_id}` : `/competitions/${row.competition_id}`;
    setTimeout(() => navigate(dest, { replace: true }), 1200);
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const role = LABEL[info?.role ?? ""] ?? "official";
  const linkProblem = info && info.status !== "valid" ? officialLinkProblem(info.status) : null;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="py-8 flex flex-col items-center text-center gap-4">
          {done ? (
            <>
              <CheckCircle2 className="h-10 w-10 text-primary" />
              <p className="font-semibold">{done === "already" ? `You're already a ${role}` : "You're in!"}</p>
              <p className="text-sm text-muted-foreground">Taking you to the {info?.role === "referee" ? "referees" : "committee"} chat…</p>
            </>
          ) : linkProblem || problem ? (
            <>
              <AlertCircle className="h-10 w-10 text-destructive" />
              {info?.competition_name && <p className="font-semibold">{info.competition_name}</p>}
              <p className="font-semibold">{problem ?? linkProblem}</p>
              <p className="text-sm text-muted-foreground">Ask the competition organisers for a new link.</p>
              {problem && <Button variant="outline" onClick={() => navigate("/")}>Go home</Button>}
            </>
          ) : (
            <>
              <Trophy className="h-10 w-10 text-primary" />
              <div>
                <p className="font-semibold text-lg">{info?.competition_name}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  You've been invited to join as a {role}. You'll also be added to the{" "}
                  {info?.role === "referee" ? "referees" : "committee"} chat.
                </p>
              </div>
              <Button className="w-full" onClick={join} disabled={joining}>
                {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : user ? `Join as ${role}` : "Sign up or sign in to join"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
