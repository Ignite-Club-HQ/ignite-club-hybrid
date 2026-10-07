import { ExternalLink, Flame, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isLikelyInAppBrowser } from "@/lib/internetIdentitySignInHelp";
import { readRedirectParam, safeSessionGet } from "@/lib/authRedirectStorage";
import { AuthLegalLinks } from "@/components/AuthLegalLinks";

interface IcpSignInScreenProps {
  shellStyle: React.CSSProperties;
  onContinue: () => void;
  busy: boolean;
  preparing: boolean;
  native: boolean;
  online: boolean;
  error: string | null;
}

// Android can request an external browser. iOS embedded browsers do not
// provide a reliable web API for opening Safari; do not claim otherwise.
export function externalChromeHref(): string | null {
  if (!/Android/i.test(navigator.userAgent)) return null;
  const url = new URL(window.location.href);
  if (url.protocol !== "https:") return null;
  const next = readRedirectParam(url.search) ?? safeSessionGet("redirectAfterAuth");
  if (next?.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")) {
    url.searchParams.set("next", next);
  }
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url.href)};end`;
}

export function IcpSignInScreen({ shellStyle, onContinue, busy, preparing, native, online, error }: IcpSignInScreenProps) {
  const embedded = !native && isLikelyInAppBrowser();
  const browserHref = embedded ? externalChromeHref() : null;

  return (
    <main className="flex flex-col bg-background overflow-hidden" style={shellStyle}>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-12">
        <div className="my-auto w-full max-w-sm text-center">
          <div className="mx-auto mb-8 w-fit rounded-2xl bg-primary glow-emerald p-4" aria-hidden="true">
            <Flame className="h-10 w-10 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-gradient-emerald leading-tight">Welcome to Ignite</h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">Sign in or create your account to continue.</p>

          <div className="mt-10">
            <Button type="button" size="lg" className="w-full min-h-12" onClick={onContinue} disabled={busy || preparing} aria-busy={busy}>
              {(busy || preparing) && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {busy ? "Signing you in…" : "Continue securely"}
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">Powered by Internet Identity</p>
          </div>

          <p className="mt-8 text-sm leading-relaxed text-muted-foreground">New to Ignite? Just continue — we'll create your account automatically.</p>
          <div className="mt-8"><AuthLegalLinks /></div>

          {error && <p className="mt-5 text-sm leading-relaxed text-destructive" role="alert">{error}</p>}
          {!online && <p className="mt-5 text-sm text-destructive" role="alert">You're offline. Reconnect to sign in.</p>}
          {embedded && (
            <aside className="mt-8 border-t border-border pt-5 text-left text-sm" aria-label="Browser sign-in guidance">
              <h2 className="font-medium text-foreground">Open Ignite in your browser</h2>
              <p className="mt-2 leading-relaxed text-muted-foreground">Secure sign-in may not work inside this app. Open this page in your device's browser to continue.</p>
              {browserHref && <Button asChild variant="link" className="mt-2 h-auto px-0"><a href={browserHref}><ExternalLink aria-hidden="true" />Open in browser</a></Button>}
            </aside>
          )}
        </div>
      </div>
    </main>
  );
}