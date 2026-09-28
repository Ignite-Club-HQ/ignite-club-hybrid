/**
 * Environment detection for the dev/prod split.
 *
 * Both DEV and PROD builds ship the same code; the only thing that differs
 * is which Supabase project the Vite build was pointed at (via the
 * VITE_SUPABASE_URL env var injected by Netlify / Codemagic).
 *
 * We derive IS_DEV_ENV from that URL so there is exactly ONE source of truth
 * and no risk of the ribbon / boot log drifting from the actual backend.
 *
 * If you rename the dev Supabase project, update DEV_PROJECT_REFS below.
 */

// Add every project ref that should be treated as DEV. The prod ref
// (yabcfiuntwqjwvschnji) is intentionally NOT here — anything not in this
// list is treated as prod.
const DEV_PROJECT_REFS: readonly string[] = [
  "REDACTED_LAB_VALUE", // Ignite Club HQ DEV
];

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseHost = (() => {
  try {
    return supabaseUrl ? new URL(supabaseUrl).host : "unknown";
  } catch {
    return "unknown";
  }
})();

// Extract the project ref from the Supabase URL (first subdomain label).
const projectRef = supabaseHost.split(".")[0] ?? "";

export const IS_DEV_ENV: boolean = DEV_PROJECT_REFS.includes(projectRef);
export const SUPABASE_HOST: string = supabaseHost;
export const SUPABASE_PROJECT_REF: string = projectRef;

// Boot log — always print so it's trivial to confirm which backend a given
// build is talking to (open the console on web, or `adb logcat | grep env`
// on Android).
// eslint-disable-next-line no-console
console.log(
  `[env] supabase=${supabaseHost} ref=${projectRef} mode=${IS_DEV_ENV ? "DEV" : "PROD"}`,
);
