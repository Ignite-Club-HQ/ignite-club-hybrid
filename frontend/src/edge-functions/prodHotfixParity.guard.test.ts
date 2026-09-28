/**
 * Guards the PROD hotfix applied on 2026-07-31 (see docs/EDGE_FUNCTION_AUTH.md).
 *
 * PROD pg_cron jobs authenticate with a service-role bearer token, so every
 * cron-invoked Edge Function must authorise via the shared
 * `isAuthorizedCronCaller` helper (CRON_SECRET *or* service-role). Reverting any
 * of these to a CRON_SECRET-only check makes the schedules 401 silently.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const CRON_FUNCTIONS = [
  "notify-game-kickoff",
  "send-event-reminders",
  "process-duty-points",
  "expire-subscriptions",
  "auto-purge-trash",
  "cleanup-deleted-accounts",
  "send-renewal-reminders",
  "send-engagement-reminders",
  "send-storage-warnings",
  "process-weekly-engagement-digest",
  "reconcile-legacy-subscriptions",
];

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("PROD notification hotfix stays in the codebase", () => {
  it("ships the shared cron caller auth helper", () => {
    expect(existsSync(resolve(process.cwd(), "supabase/functions/_shared/cron-auth.ts"))).toBe(true);
    const src = read("supabase/functions/_shared/cron-auth.ts");
    expect(src).toContain("export async function isAuthorizedCronCaller");
    expect(src).toContain("CRON_SECRET");
    expect(src).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(src).toContain("/auth/v1/admin/users");
  });

  it.each(CRON_FUNCTIONS)("%s authorises via isAuthorizedCronCaller", (fn) => {
    const src = read(`supabase/functions/${fn}/index.ts`);
    expect(src).toContain('from "../_shared/cron-auth.ts"');
    expect(src).toMatch(/await isAuthorizedCronCaller\(req\)/);
    // No bare CRON_SECRET-only gate left behind.
    expect(src).not.toMatch(/cronSecret\s*!==\s*expected/);
  });

  it("process-message-notifications dispatches with the defined service key", () => {
    const src = read("supabase/functions/process-message-notifications/index.ts");
    expect(src).not.toContain("supabaseServiceKey");
    expect(src).toContain("Bearer ${SUPABASE_SERVICE_KEY}");
  });
});
