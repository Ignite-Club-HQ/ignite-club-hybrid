import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const workflow = read(".github/workflows/promote-to-prod.yml");
const config = read("supabase/config.toml");
const msgFn = read("supabase/functions/process-message-notifications/index.ts");

/**
 * Production notification promotion safety.
 *
 * A promotion must never be able to (a) seed the PROD Vault from a key that may
 * belong to another project, (b) report a credential refresh as successful by
 * reading an unrelated pg_net response, or (c) rewrite every cron/trigger
 * notification caller onto a credential that the deployed functions reject.
 */
describe("promotion notification safety", () => {
  it("sync-dispatch-credentials skips platform JWT verification (bootstrap token auth)", () => {
    expect(config).toMatch(/\[functions\.sync-dispatch-credentials\]\s*\n\s*verify_jwt = false/);
  });

  it("requires a production-specific service-role key with no generic fallback", () => {
    expect(workflow).toMatch(/SUPABASE_PROD_SERVICE_ROLE_KEY/);
    expect(workflow).not.toMatch(/FALLBACK_SERVICE_ROLE_KEY/);
    expect(workflow).not.toMatch(/secrets\.SUPABASE_SERVICE_ROLE_KEY/);
    expect(workflow).toMatch(/SUPABASE_PROD_SERVICE_ROLE_KEY is not set/);
  });

  it("never claims success while relying on an unset key secret", () => {
    expect(workflow).not.toMatch(/No service-role key secret set/);
  });

  it("correlates the bootstrap response by pg_net request id, not 'latest response'", () => {
    // The old shape: sleep, then read whatever response happened to be last.
    expect(workflow).not.toMatch(/net\._http_response\s+order by id desc limit 1/i);
    expect(workflow).toMatch(/Bootstrap pg_net request id/);
    expect(workflow).toMatch(/from net\._http_response r\s*\n\s*where r\.id = \$\{REQ_ID\}/);
    expect(workflow).toMatch(/key_matches'\) = 'true'/);
  });

  it("fails promotion when the correlated bootstrap response is missing or not ok", () => {
    expect(workflow).toMatch(/UNVERIFIED — aborting promotion/);
    expect(workflow).toMatch(/did not report ok=true and key_matches=true/);
  });

  it("probes authentication before any notification caller is rewritten", () => {
    const probeAt = workflow.indexOf("- name: Probe PROD notification authentication");
    const cronRewriteAt = workflow.indexOf("- name: Reschedule PROD cron callers");
    const triggerRewriteAt = workflow.indexOf("- name: Repair legacy PROD trigger dispatch credentials");
    expect(probeAt).toBeGreaterThan(-1);
    expect(cronRewriteAt).toBeGreaterThan(probeAt);
    expect(triggerRewriteAt).toBeGreaterThan(probeAt);
    expect(workflow).toMatch(/x-notification-auth-probe/);

    expect(workflow).toMatch(/probe was REJECTED \(HTTP \$\{PSTATUS\}\)/);
  });

  it("the probe is authenticated first and is non-destructive", () => {
    const authAt = msgFn.indexOf("requireServiceRoleAuth(req, corsHeaders)");
    const probeAt = msgFn.indexOf("x-notification-auth-probe");
    expect(authAt).toBeGreaterThan(-1);
    expect(probeAt).toBeGreaterThan(authAt);
    expect(msgFn).toMatch(/probe: true, authenticated: true, correlation/);
  });

  it("does not print bootstrap or probe response bodies into CI logs", () => {
    expect(workflow).not.toMatch(/left\(coalesce\(content,''\)/);
  });
});
