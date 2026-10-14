import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, Loader2, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { safeSessionSet, buildAuthPathWithIntent } from "@/lib/authRedirectStorage";
import { withFeatureBackend } from "@/live/featureRouter";
import { getEffectiveBackendForFeature } from "@/live/loadBackendRouting";
import { getLiveJoinLinkPreview, joinLiveCompetitionByToken } from "@/live/features/competitions";

type OfficialRole = "referee" | "committee_member";
type LinkInfo = {
  status: "valid" | "invalid" | "archived";
  competitionId: string | null;
  competitionName: string | null;
  role: OfficialRole | null;
};

const roleLabel = (role: OfficialRole) => role === "referee" ? "referee" : "committee member";

export default function CompetitionOfficialJoinPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextPath = `/competitions/officials/join?token=${encodeURIComponent(token)}`;

  useEffect(() => {
    let active = true;
    (async () => {
      if (!token) {
        if (active) {
          setInfo({ status: "invalid", competitionId: null, competitionName: null, role: null });
          setLoading(false);
        }
        return;
      }
      try {
        const result = await withFeatureBackend("competitions", {
          supabase: async () => {
            const { data, error: rpcError } = await (supabase as any).rpc("get_competition_role_link_status", { p_token: token });
            if (rpcError) throw rpcError;
            const row = data?.[0];
            if (!row || !["referee", "committee_member"].includes(row.role)) {
              return { status: "invalid", competitionId: null, competitionName: null, role: null } as LinkInfo;
            }
            return {
              status: row.status === "archived" ? "archived" : row.status === "valid" ? "valid" : "invalid",
              competitionId: row.competition_id,
              competitionName: row.competition_name,
              role: row.role as OfficialRole,
            } satisfies LinkInfo;
          },
          icp: async (ctx) => {
            const result = await getLiveJoinLinkPreview(ctx, token);
            const preview = result.preview;
            if (!preview || !["referee", "committee_member"].includes(preview.role)) {
              return {
                status: result.status === "archived" ? "archived" : "invalid",
                competitionId: null,
                competitionName: null,
                role: null,
              } as LinkInfo;
            }
            return {
              status: "valid",
              competitionId: preview.competition_id,
              competitionName: preview.name,
              role: preview.role as OfficialRole,
            } satisfies LinkInfo;
          },
        });
        if (active) setInfo(result);
      } catch {
        if (active) setInfo({ status: "invalid", competitionId: null, competitionName: null, role: null });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token]);

  const join = async () => {
    if (!user) {
      safeSessionSet("redirectAfterAuth", nextPath);
      navigate(buildAuthPathWithIntent({ next: nextPath, mode: "signup" }));
      return;
    }
    if (!info?.competitionId || !info.role) return;
    setJoining(true);
    setError(null);
    try {
      await withFeatureBackend("competitions", {
        supabase: async () => {
          const { data, error: rpcError } = await (supabase as any).rpc("accept_competition_role_link", { p_token: token });
          if (rpcError) throw rpcError;
          const row = data?.[0];
          if (!row || !["joined", "already"].includes(row.status)) throw new Error("This official link is no longer valid.");
        },
        icp: async (ctx) => { await joinLiveCompetitionByToken(ctx, token); },
      });
      setJoined(true);
      navigate(`/competitions/${info.competitionId}`, { replace: true });
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Could not join this competition.");
    } finally {
      setJoining(false);
    }
  };

  const loadingAuth = getEffectiveBackendForFeature("competitions") === "icp" && authLoading;
  if (loading || loadingAuth) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div>;
  }

  const linkError = info?.status === "archived"
    ? "This competition has been archived."
    : info?.status !== "valid" ? "This official join link is invalid or has been revoked." : error;
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Trophy className="h-5 w-5" /> Join as an official</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {joined ? (
            <><CheckCircle2 className="mx-auto h-9 w-9 text-primary" /><p>You're in.</p></>
          ) : linkError ? (
            <><AlertCircle className="mx-auto h-9 w-9 text-destructive" /><p>{linkError}</p></>
          ) : (
            <>
              <div>
                <p className="font-semibold">{info?.competitionName}</p>
                <p className="mt-1 text-sm text-muted-foreground">Join as a {roleLabel(info!.role!)}.</p>
              </div>
              <Button className="w-full" disabled={joining} onClick={() => void join()}>
                {joining && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {user ? `Join as ${roleLabel(info!.role!)}` : "Sign in to join"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}