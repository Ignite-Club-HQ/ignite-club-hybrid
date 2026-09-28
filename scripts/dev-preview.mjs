// Preview/dev entry point for the Lovable sandbox: runs the guarded live
// frontend (frontend/vite.live.config.ts) on the port the preview expects,
// mapping the platform-provided Supabase connection variables onto the
// IGNITE_LIVE_* names the live target registry requires.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendDir = path.join(projectRoot, "frontend");

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

// The platform install step does not always run (or its node_modules end up
// incomplete, e.g. vite present in name only). Install before starting, then
// call the installed Vite binary directly so we never fall back to npx
// downloading a mismatched version.
const viteBin = path.join(frontendDir, "node_modules", "vite", "bin", "vite.js");
if (!existsSync(viteBin)) {
  console.log("frontend dependencies missing; running npm ci in frontend/...");
  const install = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["ci", "--no-fund", "--no-audit"],
    { cwd: frontendDir, stdio: "inherit" },
  );
  if (install.status !== 0) process.exit(install.status ?? 1);
  if (!existsSync(viteBin)) {
    console.error("frontend dependencies are still missing after npm ci; cannot start the preview.");
    process.exit(1);
  }
}

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
  console.error("Supabase connection variables are missing; cannot start the live frontend preview.");
  process.exit(1);
}

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vite", "--config", "vite.live.config.ts", "--mode", "live", "--host", "0.0.0.0", "--port", "8080", "--strictPort"],
  {
    cwd: frontendDir,
    env: {
      ...process.env,
      IGNITE_LIVE_BUILD: "1",
      IGNITE_LIVE_SUPABASE_URL: supabaseUrl,
      IGNITE_LIVE_SUPABASE_ANON_KEY: supabaseAnonKey,
    },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
