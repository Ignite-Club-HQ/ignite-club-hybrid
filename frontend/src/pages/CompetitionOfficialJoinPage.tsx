import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, Loader2, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { safeSessionSet, buildAuthPathWithIntent } from "@/lib/authRedirectStorage";
import { withFeatureBackend } from "@/live/featureRouter";
import { getEffectiveBackendForFeature } from "@/live/loadBackendRouting";
import {
  acceptLiveRoleLink,
  acceptLiveCompetitionOfficialEmailInvite,
  getLiveCompetitionOfficialEmailInvitePreview,
  getLiveRoleLinkPreview,
} from "@/live/features/competitions";
import { hashOfficialInviteCode, hashOfficialInviteEmail } from "@/features/competitions/officialEmailInvite";

type OfficialRole = "referee" | "committee_member";
type LinkInfo = {
  status: "valid" | "invalid" | "archived" | "expired" | "used" | "revoked";
  competitionId: string | null;
  competitionName: string | null;
  role: OfficialRole | null;
};

const roleLabel = (role: OfficialRole) => role === "referee" ? "referee" : "committee member";

export default function CompetitionOfficialJoinPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const emailInvite = params.get("email") === "1";
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const nextPath = `/competitions/officials/join?token=${encodeURIComponent(token)}`;
  const isIcpLink = !emailInvite && token.startsWith("crl-");

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
        if (isIcpLink) {
          const [{ AnonymousIdentity }, { getActiveIcpTarget }] = await Promise.all([
            import("@icp-sdk/core/agent"),
            import("@/live/targetRegistry"),
          ]);
          const preview = await getLiveRoleLinkPreview(
            { identity: new AnonymousIdentity(), target: getActiveIcpTarget() } as any,
            token,
          );
          if (active) {
            setInfo(preview
              ? {
                  status: "valid",
                  competitionId: preview.competition_id,
                  competitionName: preview.name,
                  role: preview.role as OfficialRole,
                }
              : { status: "invalid", competitionId: null, competitionName: null, role: null });
          }
          return;
        }
        const result = await withFeatureBackend("competitions", {
          supabase: async () => {
            if (emailInvite) {
              const { data, error: rpcError } = await (supabase as any).rpc("get_competition_role_email_invite_status", { p_token: token });
              if (rpcError) throw rpcError;
              const row = data?.[0];
              if (!row || !["referee", "committee_member"].includes(row.role)) {
                return { status: "invalid", competitionId: null, competitionName: null, role: null } as LinkInfo;
              }
              return {
                status: row.status as LinkInfo["status"],
                competitionId: row.competition_id,
                competitionName: row.competition_name,
                role: row.role as OfficialRole,
              } satisfies LinkInfo;
            }
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
            if (emailInvite) {
              const preview = await getLiveCompetitionOfficialEmailInvitePreview(ctx, token);
              if (!["referee", "committee_member"].includes(preview.role)) {
                return {
                  status: preview.status as LinkInfo["status"],
                  competitionId: preview.competition_id,
                  competitionName: preview.competition_name,
                  role: null,
                } satisfies LinkInfo;
              }
              return {
                status: preview.status as LinkInfo["status"],
                competitionId: preview.competition_id,
                competitionName: preview.competition_name,
                role: preview.role as OfficialRole,
              } satisfies LinkInfo;
            }
            return { status: "invalid", competitionId: null, competitionName: null, role: null } satisfies LinkInfo;
          },
        }, { inviteToken: token ?? "" });
        if (active) setInfo(result);
      } catch {
        if (active) setInfo({ status: "invalid", competitionId: null, competitionName: null, role: null });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token, emailInvite, isIcpLink]);

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
      if (emailInvite) {
        const codeHash = await hashOfficialInviteCode(token, verificationCode.trim());
        const result = await withFeatureBackend("competitions", {
          supabase: async () => {
            const { data, error: rpcError } = await (supabase as any).rpc("accept_competition_role_email_invite", {
              p_token: token,
              p_verification_code_hash: codeHash,
            });
            if (rpcError) throw rpcError;
            return data?.[0] as { status: string; competition_id: string | null; role: string | null } | undefined;
          },
          icp: async (ctx) => {
            const emailHash = await hashOfficialInviteEmail(token, inviteEmail.trim());
            const grant = await acceptLiveCompetitionOfficialEmailInvite(ctx, token, emailHash, codeHash);
            // Best-effort: the delivery service re-reads the recipient and
            // message from the canister, so a failed send never fails the join.
            try {
              const { error: welcomeError } = await supabase.functions.invoke("send-welcome-email-icp", { body: { competitionWelcomeToken: token } });
              if (welcomeError) console.error("[welcome-email] competition delivery request failed", welcomeError);
            } catch (welcomeError) {
              console.error("[welcome-email] competition delivery request failed", welcomeError);
            }
            return { status: "joined", competition_id: grant.competition_id, role: grant.role };
          },
        }, { inviteToken: token ?? "" });
        if (!result || !["joined", "already"].includes(result.status)) {
          const errors: Record<string, string> = {
            email_unverified: "Verify your invited email address before joining.",
            code_invalid: "The email address or verification code is incorrect.",
            locked: "Too many incorrect codes. Ask for a new invitation.",
            expired: "This invitation has expired.",
            used: "This invitation has already been used.",
            revoked: "This invitation has been revoked.",
          };
          throw new Error(errors[result?.status ?? ""] ?? "This official invitation is no longer valid.");
        }
        setJoined(true);
        navigate(`/competitions/${info.competitionId}`, { replace: true });
        return;
      }

      await withFeatureBackend("competitions", {
        supabase: async () => {
          const { data, error: rpcError } = await (supabase as any).rpc("accept_competition_role_link", { p_token: token });
          if (rpcError) throw rpcError;
          const row = data?.[0];
          if (!row || !["joined", "already"].includes(row.status)) throw new Error("This official link is no longer valid.");
        },
        icp: async (ctx) => { await acceptLiveRoleLink(ctx, token); },
      }, { inviteToken: token ?? "" });
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
    : info?.status === "expired" ? "This invitation has expired."
    : info?.status === "used" ? "This invitation has already been used."
    : info?.status === "revoked" ? "This invitation has been revoked."
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
              {emailInvite && (
                <div className="w-full space-y-2 text-left">
                  {getEffectiveBackendForFeature("competitions") === "icp" && (
                    <>
                      <Label htmlFor="official-invite-email">Invited email</Label>
                      <Input id="official-invite-email" type="email" autoComplete="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
                    </>
                  )}
                  <Label htmlFor="official-invite-code">One-time email code</Label>
                  <Input id="official-invite-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 8))} />
                  {getEffectiveBackendForFeature("competitions") !== "icp" && (
                    <p className="text-xs text-muted-foreground">Sign in with the email address this invitation was sent to.</p>
                  )}
                </div>
              )}
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
