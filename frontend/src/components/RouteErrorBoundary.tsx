import React from "react";

/**
 * Catches uncaught render errors anywhere inside the route tree so a single
 * bad component (commonly during a notification-tap cold start on Android
 * WebView) does NOT tear React down to a blank white screen.
 *
 * Symptom before this existed: tap a chat push notification → app launches →
 * page mid-render throws → React unmounts the entire tree → user sees a
 * blank white WebView until they force-quit. With this boundary in place,
 * we render a recovery surface with a "Go to Inbox" button and stash the
 * error in localStorage so we can diagnose on the next session.
 */

interface State {
  error: Error | null;
}

const LAST_ERROR_KEY = "ignite_last_route_error";
const CHUNK_RELOAD_KEY = "ignite_chunk_reload_at";

/**
 * Detects the "stale chunk" failure that happens after a redeploy: the
 * currently-loaded HTML references a hashed JS file (e.g.
 * `/assets/GroupChatPage-CqEE3-CX.js`) that no longer exists on the CDN
 * because a newer build replaced it. Triggered by lazy `import()`.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const msg =
    (error as { message?: string })?.message ??
    (typeof error === "string" ? error : "");
  if (!msg) return false;
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /ChunkLoadError/i.test(msg) ||
    /Loading chunk \d+ failed/i.test(msg) ||
    /Loading CSS chunk/i.test(msg)
  );
}

/**
 * Hard-reload once to pick up the new asset manifest, but never loop:
 * if we already reloaded in the last 60s, surface the error instead.
 */
export function tryRecoverFromChunkError(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  window.location.reload();
  return true;
}

export class RouteErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Stale-chunk auto-recovery: after a redeploy the cached HTML points at
    // hashed JS files that no longer exist. Reload once to pick up the new
    // manifest before showing the error UI.
    if (isChunkLoadError(error) && tryRecoverFromChunkError()) {
      return;
    }
    try {
      const payload = {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null,
        componentStack: info?.componentStack ?? null,
        url: typeof window !== "undefined" ? window.location.href : null,
        at: new Date().toISOString(),
      };
      localStorage.setItem(LAST_ERROR_KEY, JSON.stringify(payload));
      // eslint-disable-next-line no-console
      console.error("[RouteErrorBoundary] caught render error", payload);
    } catch {
      /* ignore */
    }
  }

  private handleReset = () => {
    this.setState({ error: null });
  };

  private handleHome = () => {
    try {
      // Clear any pending notification-driven jump so the inbox doesn't
      // immediately re-trigger the same broken path.
      sessionStorage.removeItem("pendingPushNavigationUrl");
      sessionStorage.removeItem("ignite_pending_chat_jump_v1");
      sessionStorage.removeItem("ignite_pending_web_push_nav");
    } catch { /* ignore */ }
    this.setState({ error: null });
    if (typeof window !== "undefined") {
      window.location.replace("/messages");
    }
  };

  private handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  private handleCopy = async () => {
    const err = this.state.error;
    if (!err) return;
    const payload = `${err.message}\n\n${err.stack ?? ""}`;
    try {
      await navigator.clipboard.writeText(payload);
      // eslint-disable-next-line no-alert
      alert("Error copied to clipboard");
    } catch {
      // eslint-disable-next-line no-alert
      alert(payload.slice(0, 1500));
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    const err = this.state.error;

    return (
      <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center px-6 py-8 bg-background text-foreground">
        <div className="max-w-sm w-full space-y-4">
          <h1 className="text-xl font-semibold text-center">Something went wrong</h1>
          <p className="text-sm text-muted-foreground leading-snug text-center">
            We hit an unexpected error opening this screen. You can head back
            to your inbox or try again.
          </p>
          <details className="text-left bg-muted/50 rounded-lg p-3 text-[11px] leading-snug">
            <summary className="cursor-pointer font-medium">Error details</summary>
            <div className="mt-2 font-mono break-words whitespace-pre-wrap max-h-64 overflow-auto">
              <div className="font-semibold">{err.message}</div>
              {err.stack ? <div className="mt-2 opacity-70">{err.stack}</div> : null}
            </div>
            <button
              type="button"
              onClick={this.handleCopy}
              className="mt-2 text-xs underline text-primary"
            >
              Copy error
            </button>
          </details>
          <div className="flex flex-col gap-2 pt-2">
            <button
              type="button"
              onClick={this.handleHome}
              className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-medium"
            >
              Go to Inbox
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="w-full h-11 rounded-xl border border-border font-medium"
            >
              Reload app
            </button>
            <button
              type="button"
              onClick={this.handleReset}
              className="w-full h-9 text-xs text-muted-foreground underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    );
  }
}
