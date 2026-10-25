// Must be the first import: silences hot-path console.log/debug in
// production builds before any other module can log on evaluation.
import "./lib/prodConsoleSilencer";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App, { appCacheReady } from "./App";
import { initWebVitalsTelemetry } from "./lib/observability/webVitals";
import { installSupabaseAuthRetry } from "./lib/supabaseAuthRetry";
import { initDeepLinkHandler } from "./lib/deepLinkHandler";
import { ICP_FALLBACK_BLOCKED_EVENT, installStrictIcpTransport } from "./live/strictIcpTransport";
import { toast } from "./hooks/use-toast";
import "./index.css";

installSupabaseAuthRetry();
// Installed outside auth retry, so refused fallback requests never refresh/retry.
installStrictIcpTransport();
let lastBlocked = "";
let lastBlockedAt = 0;
window.addEventListener(ICP_FALLBACK_BLOCKED_EVENT, event => {
  const message = (event as CustomEvent<unknown>).detail;
  if (typeof message !== "string") return;
  if (message === lastBlocked && Date.now() - lastBlockedAt < 5000) return;
  lastBlocked = message;
  lastBlockedAt = Date.now();
  toast({ title: "ICP fallback blocked", description: message, variant: "destructive" });
});
initWebVitalsTelemetry();
// Native only: resolves the cold-start launch URL and releases the startup
// boundary. Without this the gate stays "pending" forever and the app hangs
// on "Starting up...".
initDeepLinkHandler();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Product root element is missing");
}

// Phone sign-in returns here with Internet Identity's reply in the address.
// Finish it before the app renders so the router can't disturb that reply.
// Bounded so a stuck network never leaves a blank page.
const phoneSignInReturn = /[#&]message=/.test(window.location.hash) && /[#&]state=/.test(window.location.hash)
  ? import("@/live/internetIdentityAuth")
      .then((mod) => Promise.race([
        mod.completeInternetIdentityRedirect(),
        new Promise<void>((resolve) => setTimeout(resolve, 30000)),
      ]))
      .catch(() => undefined)
  : Promise.resolve();

// Bounded (≤ ~400ms) wait so cached ICP pages are in place for first paint.
void Promise.all([appCacheReady, phoneSignInReturn]).finally(() => createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
));
