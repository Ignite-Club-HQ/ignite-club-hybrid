// Preview/dev entry point for the Lovable sandbox: runs the guarded live
// frontend (frontend/vite.live.config.ts) on the port the preview expects,
// mapping the platform-provided Supabase connection variables onto the
// IGNITE_LIVE_* names the live target registry requires.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "frontend");

const supabaseUrl = process.env.IGNITE_LIVE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.IGNITE_LIVE_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

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
