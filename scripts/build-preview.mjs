// Build counterpart of dev-preview.mjs for the Lovable sandbox: builds the
// guarded live frontend (frontend/vite.live.config.ts) with the
// platform-provided Supabase connection variables mapped onto the
// IGNITE_LIVE_* names the live target registry requires.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, rmSync, cpSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ensureFrontendDeps } from "./ensure-frontend-deps.mjs";
import { syncCanisterIds } from "./sync-canister-ids.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendDir = path.join(projectRoot, "frontend");

// Install only if package-lock changed, serialized with the platform install
// and the dev server so concurrent `npm ci` runs can't corrupt node_modules.
const viteCli = path.join(frontendDir, "node_modules", "vite", "bin", "vite.js");
try {
  ensureFrontendDeps();
} catch (err) {
  console.error(`cannot build: ${err?.message ?? err}`);
  process.exit(1);
}

// The platform build step does not always inject the Supabase connection
// variables, so fall back to the project-root .env file (and the VITE_*
// aliases) when they are absent from the environment.
function loadRootEnvFile() {
  const envPath = path.join(projectRoot, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith("#")) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}
loadRootEnvFile();
syncCanisterIds();

// The live Vite config only exposes IGNITE_LIVE_* values. Map rendering uses
// the connector's public browser key, never its server-side gateway key.
process.env.IGNITE_LIVE_GOOGLE_MAPS_BROWSER_KEY ||= process.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY || "";

// Last-resort fallback: the connected project's public URL and anon key.
// Both are browser-safe (the anon key ships in the client bundle anyway) and
// are only used when neither the environment nor .env provides the values.
const FALLBACK_SUPABASE_URL = "https://cdrxmelhysdqrccttsjg.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkcnhtZWxoeXNkcXJjY3R0c2pnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1NzIxMTMsImV4cCI6MjEwNjE0ODExM30.vRVXXZuoh-9VliT7vt6lw2nANooLwlgOeyfBTFLQjXw";

const supabaseUrl =
  process.env.IGNITE_LIVE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  FALLBACK_SUPABASE_URL;
const supabaseAnonKey =
  process.env.IGNITE_LIVE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  FALLBACK_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Supabase connection variables are missing; cannot build the live frontend.");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [viteCli, "build", "--config", "vite.live.config.ts", "--mode", "live"],
  {
    cwd: frontendDir,
    env: {
      ...process.env,
      IGNITE_LIVE_BUILD: "1",
      // Large bundle: give the build enough heap so it can't OOM on the host.
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--max-old-space-size=4096"].filter(Boolean).join(" "),
      IGNITE_LIVE_SUPABASE_URL: supabaseUrl,
      IGNITE_LIVE_SUPABASE_ANON_KEY: supabaseAnonKey,
    },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

// Lovable deploys the static output from <projectRoot>/dist, but the live
// frontend build writes to frontend/dist-live. Copy it into place so the
// platform dist-check and deploy step find it.
const distLive = path.join(frontendDir, "dist-live");
const distRoot = path.join(projectRoot, "dist");
rmSync(distRoot, { recursive: true, force: true });
cpSync(distLive, distRoot, { recursive: true });
console.log("copied frontend/dist-live -> dist/");

// The live build's HTML entry is live-index.html, but static hosting serves
// index.html for "/" and as the SPA fallback for every page route. Without
// it, every URL on the hosted preview answers "Not found".
const liveIndex = path.join(distRoot, "live-index.html");
const rootIndex = path.join(distRoot, "index.html");
if (!existsSync(liveIndex)) {
  console.error("dist/live-index.html missing after build; cannot create index.html.");
  process.exit(1);
}
// Ship the service worker (refresh fallback: a 404 page load is answered
// with the app shell) and register it from the hosted HTML only — dev keeps
// the Vite server's own SPA fallback and never registers it.
cpSync(path.join(projectRoot, "scripts", "static", "sw.js"), path.join(distRoot, "sw.js"));
const swRegistration =
  "<script>if('serviceWorker' in navigator){window.addEventListener('load',function(){" +
  "navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(function(){});});}</script>";
const liveHtml = readFileSync(liveIndex, "utf8");
if (!liveHtml.includes("</body>")) {
  console.error("dist/live-index.html has no </body>; cannot inject the service worker registration.");
  process.exit(1);
}
writeFileSync(rootIndex, liveHtml.replace("</body>", `${swRegistration}</body>`));
console.log("wrote dist/index.html (live-index.html + service worker registration) and dist/sw.js");

// Deep links (e.g. /auth, /admin/placement-settings) must also reach the app.
// The Lovable static hosting for this project has NO SPA fallback: unmatched
// paths get a plain-text "Not Found" (verified 2026-10-04 — 404.html,
// _redirects, vercel.json and firebase.json rewrite conventions are all
// ignored, and netlify.toml is only used by the separate Netlify deploy).
// Directory shells below are served only at exact /route/index.html paths;
// the service worker covers refreshes on every other address once the app
// has been opened from "/" once.
const appTsx = readFileSync(path.join(frontendDir, "src", "App.tsx"), "utf8");
const staticRoutes = [...appTsx.matchAll(/path="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((p) => p !== "*" && p !== "/" && !p.includes(":") && !p.endsWith(".html"));
for (const route of staticRoutes) {
  const dir = path.join(distRoot, ...route.split("/").filter(Boolean));
  mkdirSync(dir, { recursive: true });
  cpSync(rootIndex, path.join(dir, "index.html"));
}
console.log(`pre-rendered ${staticRoutes.length} static route shells (dist<route>/index.html)`);
