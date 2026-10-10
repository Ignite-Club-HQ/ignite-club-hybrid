// Must be the first import: silences hot-path console.log/debug in
// production builds before any other module can log on evaluation.
import "./lib/prodConsoleSilencer";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App, { appCacheReady } from "./App";
import { initWebVitalsTelemetry } from "./lib/observability/webVitals";
import { installSupabaseAuthRetry } from "./lib/supabaseAuthRetry";
import "./index.css";

installSupabaseAuthRetry();
initWebVitalsTelemetry();

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
