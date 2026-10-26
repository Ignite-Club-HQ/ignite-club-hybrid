import { useEffect, useRef, useState } from "react";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getCurrentInternetIdentity, signInWithInternetIdentity } from "@/live/internetIdentityAuth";
import { clearPendingClaim, parseClaimLink, readPendingClaim, redeemAccountClaim, savePendingClaim, type PendingClaim } from "@/live/accountClaim";

type State = { kind: "ready" } | { kind: "working" } | { kind: "done" } | { kind: "error"; message: string } | { kind: "invalid" };

export default function ClaimAccountPage() {
  const [claim, setClaim] = useState<PendingClaim | null>(null);
  const [state, setState] = useState<State>({ kind: "ready" });
  const started = useRef(false);

  const redeem = async (c: PendingClaim, signIn: boolean) => {
    setState({ kind: "working" });
    try {
      if (signIn) await signInWithInternetIdentity(`${window.location.pathname}${window.location.search}`);
      const identity = await getCurrentInternetIdentity();
      if (!identity) { setState({ kind: "ready" }); return; }
      await redeemAccountClaim(identity, c);
      clearPendingClaim();
      setState({ kind: "done" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong.";
      if (/already been used|expired|isn't valid|another account/.test(message)) clearPendingClaim();
      setState({ kind: "error", message });
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const fromLink = parseClaimLink(window.location.search, window.location.hash);
    if (fromLink) {
      savePendingClaim(fromLink);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    const c = fromLink ?? readPendingClaim();
    if (!c) { setState({ kind: "invalid" }); return; }
    setClaim(c);
    // Returning from Internet Identity sign-in: finish without another tap.
    void getCurrentInternetIdentity().then((id) => { if (id && !fromLink) void redeem(c, false); });
  }, []);

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" />Link your account</CardTitle>
          <CardDescription>Your club is moving to Internet Identity. Link once so your children, RSVPs and points come with you.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.kind === "invalid" && <p className="text-sm text-muted-foreground">This link isn't complete. Open the newest email from your club and tap the link again.</p>}
          {state.kind === "done" && (
            <div className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
              <p>You're linked. Keep using the app as usual — when your club finishes moving, sign in with Internet Identity and everything will be there.</p>
            </div>
          )}
          {state.kind === "error" && <p className="text-sm text-destructive">{state.message}</p>}
          {claim && (state.kind === "ready" || state.kind === "working" || state.kind === "error") && (
            <Button className="w-full" disabled={state.kind === "working"} onClick={() => void redeem(claim, true)}>
              {state.kind === "working" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue with Internet Identity
            </Button>
          )}
          <p className="text-xs text-muted-foreground">Each link works once and only for the person it was sent to. Your email address isn't shared with the club service.</p>
        </CardContent>
      </Card>
    </main>
  );
}
