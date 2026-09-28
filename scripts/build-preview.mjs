// Build counterpart of dev-preview.mjs for the Lovable sandbox: builds the
// guarded live frontend (frontend/vite.live.config.ts) with the
// platform-provided Supabase connection variables mapped onto the
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

const supabaseUrl =
  process.env.IGNITE_LIVE_SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey =
  process.env.IGNITE_LIVE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Supabase connection variables are missing; cannot build the live frontend.");
  process.exit(1);
}

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vite", "build", "--config", "vite.live.config.ts", "--mode", "live"],
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
