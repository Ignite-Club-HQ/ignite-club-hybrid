import { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import igniteIcon from "@/assets/ignite-icon.png";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { Button } from "@/components/ui/button";

export default function ShortInviteRedirect() {
  const useIcpLab = resolveAuthBackend() === "icp";
  return useIcpLab ? <IcpShortInviteRedirect /> : <SupabaseShortInviteRedirect />;
}

function IcpShortInviteRedirect() {
  const { code } = useParams<{ code: string }>();
  const [inviteId, setInviteId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setInviteId(null);
    setNotFound(false);
    setFailed(false);

    if (!code) {
      setNotFound(true);
      return;
    }

    const resolvingCode = code;
    let cancelled = false;

    const resolve = async () => {
      try {
        const [{ getActiveIcpTarget }, { resolvePublicInviteCode }] = await Promise.all([
          import("@/live/targetRegistry"),
          import("@/live/invitePublicRead"),
        ]);
        const id = await resolvePublicInviteCode(getActiveIcpTarget(), resolvingCode);
        if (cancelled || resolvingCode !== code) return;
        if (!id) {
          setNotFound(true);
          return;
        }
        setInviteId(id);
      } catch (error) {
        if (cancelled || resolvingCode !== code) return;
        if (error instanceof Error && /Invite not found|Short code not found/.test(error.message)) setNotFound(true);
        else setFailed(true);
      }
    };

    resolve();

    return () => {
      cancelled = true;
    };
  }, [code, attempt]);

  if (failed) return <div className="min-h-screen flex flex-col items-center justify-center gap-4"><p>Couldn’t open this invitation.</p><Button onClick={() => setAttempt(a => a + 1)}>Try again</Button></div>;

  if (notFound) {
    return <Navigate to="/auth" replace />;
  }

  if (inviteId) {
    return <Navigate to={`/join/p/${encodeURIComponent(inviteId)}`} replace />;
  }

  return <InviteLoadingScreen />;
}

function SupabaseShortInviteRedirect() {
  const { code } = useParams<{ code: string }>();
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    // Reset transient state whenever the route's short code changes so a
    // stale "not found" or previously-resolved token from an earlier code
    // never leaks into the render for the current code.
    setInviteToken(null);
    setNotFound(false);

    if (!code) {
      setNotFound(true);
      return;
    }

    // Capture the code this effect run is resolving; a late response for an
    // older code must never replace the state for the current code.
    const resolvingCode = code;
    let cancelled = false;

    const resolve = async () => {
      const { data, error } = await supabase.rpc("resolve_invite_short_code", {
        _code: resolvingCode,
      });

      if (cancelled || resolvingCode !== code) return;

      if (error || !data) {
        setNotFound(true);
        return;
      }

      setInviteToken(data as string);
    };

    resolve();

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (notFound) {
    return <Navigate to="/auth" replace />;
  }

  if (inviteToken) {
    // Encode the token so any reserved-URL characters ("/", "?", "#", "..",
    // etc.) stay inside a single path segment.
    return <Navigate to={`/join/p/${encodeURIComponent(inviteToken)}`} replace />;
  }

  return <InviteLoadingScreen />;
}

function InviteLoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
      <img src={igniteIcon} alt="Ignite" className="h-32 w-32 rounded-[2rem]" />
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Loading invite...</p>
    </div>
  );
}
