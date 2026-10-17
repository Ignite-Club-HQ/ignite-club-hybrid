import { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import igniteIcon from "@/assets/ignite-icon.png";
import { resolveAuthBackend } from "@/live/authBackendMode";

export default function ShortInviteRedirect() {
  const useIcpLab = resolveAuthBackend() === "icp";
  return useIcpLab ? <IcpShortInviteRedirect /> : <SupabaseShortInviteRedirect />;
}

function IcpShortInviteRedirect() {
  const { code } = useParams<{ code: string }>();
  const [inviteId, setInviteId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setInviteId(null);
    setNotFound(false);

    if (!code) {
      setNotFound(true);
      return;
    }

    const resolvingCode = code;
    let cancelled = false;

    const resolve = async () => {
      try {
        const [{ AnonymousIdentity }, { getActiveIcpTarget }, { resolveLiveInviteShortCode }] = await Promise.all([
          import("@icp-sdk/core/agent"),
          import("@/live/targetRegistry"),
          import("@/live/features/club"),
        ]);
        const id = await resolveLiveInviteShortCode(
          { identity: new AnonymousIdentity(), target: getActiveIcpTarget() },
          resolvingCode,
        );
        if (cancelled || resolvingCode !== code) return;
        if (!id) {
          setNotFound(true);
          return;
        }
        setInviteId(id);
      } catch {
        if (cancelled || resolvingCode !== code) return;
        setNotFound(true);
      }
    };

    resolve();

    return () => {
      cancelled = true;
    };
  }, [code]);

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
