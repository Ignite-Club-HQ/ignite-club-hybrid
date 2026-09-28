import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

/**
 * The self-healing credential repair is a two-phase state machine:
 * Phase 1 queues a bootstrap request and records the exact pg_net request id.
 * Phase 2 (cron) correlates that id, and only reports success on
 * HTTP 2xx + ok=true + key_matches=true.
 *
 * These guards assert the latest definition of each function/table in the
 * migration history has those properties.
 */
const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ name: f, sql: readFileSync(resolve(MIGRATIONS_DIR, f), "utf8") }));

const latestContaining = (needle: string) => {
  const hit = [...migrations].reverse().find((m) => m.sql.includes(needle));
  if (!hit) throw new Error(`No migration defines ${needle}`);
  return hit.sql;
};

const initiation = latestContaining("FUNCTION public.self_heal_dispatch_credentials()");
const verification = latestContaining("FUNCTION public.verify_dispatch_credential_repair()");
const table = latestContaining("public.dispatch_repair_attempts");

describe("production notification dispatch promotion safety", () => {
  it("does not let self-healing report success merely because an HTTP request was queued", () => {
    // No fire-and-forget PERFORM followed by an unconditional true.
    expect(initiation).not.toMatch(/PERFORM\s+public\.bootstrap_dispatch_credentials/);
    expect(initiation).not.toMatch(/RETURN\s+true\s*;/i);
    expect(initiation).toMatch(/RETURNS\s+text/i);
    expect(initiation).toMatch(/RETURN 'pending'/);
    expect(initiation).toMatch(/RETURN 'not_needed'/);
  });

  it("captures and persists the exact pg_net request id", () => {
    expect(initiation).toMatch(/v_request_id\s*:=\s*public\.bootstrap_dispatch_credentials\(v_base\)/);
    expect(initiation).toMatch(
      /INSERT INTO public\.dispatch_repair_attempts[\s\S]*?VALUES \(v_request_id/,
    );
  });

  it("cannot enqueue an overlapping active attempt", () => {
    expect(initiation).toMatch(/pg_try_advisory_xact_lock/);
    expect(initiation).toMatch(/IF EXISTS \(SELECT 1 FROM public\.dispatch_repair_attempts WHERE status = 'pending'\)/);
    expect(table).toMatch(/CREATE UNIQUE INDEX[\s\S]*?dispatch_repair_attempts \(status\)[\s\S]*?WHERE status = 'pending'/);
  });

  it("correlates the response by stored request id, never 'latest response'", () => {
    expect(verification).toMatch(/FROM net\._http_response r\s*\n\s*WHERE r\.id = v_attempt\.request_id/);
    expect(verification).not.toMatch(/ORDER BY id DESC\s+LIMIT 1/i);
  });

  it("keeps pending before the deadline and fails on expiry with a sanitised reason", () => {
    expect(verification).toMatch(/IF v_attempt\.deadline_at <= now\(\) THEN[\s\S]*?failure_reason = 'timeout'/);
    expect(verification).toMatch(/SET checked_at = now\(\)[\s\S]*?RETURN 'pending'/);
    expect(initiation).toMatch(/status = 'failed',\s*\n\s*failure_reason = 'timeout'/);
  });

  it("treats non-2xx, 401/403, bad JSON, ok=false and key_matches=false as failures", () => {
    expect(verification).toMatch(/v_status_code < 200 OR v_status_code > 299/);
    expect(verification).toMatch(/v_status_code IN \(401, 403\) THEN 'unauthorized'/);
    expect(verification).toMatch(/EXCEPTION WHEN others THEN\s*\n\s*v_json := NULL;/);
    expect(verification).toMatch(/'invalid_json'/);
    expect(verification).toMatch(/v_json->>'ok', ''\) <> 'true'/);
    expect(verification).toMatch(/v_json->>'key_matches', ''\) <> 'true'/);
  });

  it("only marks verified after proof of success", () => {
    const verifiedAt = verification.indexOf("SET status = 'verified'");
    const reasonGate = verification.indexOf("IF v_reason IS NOT NULL THEN");
    expect(reasonGate).toBeGreaterThan(-1);
    expect(verifiedAt).toBeGreaterThan(reasonGate);
    expect(verification).toMatch(/RETURN 'verified'/);
  });

  it("never persists or logs tokens or response bodies", () => {
    for (const sql of [initiation, verification]) {
      expect(sql).not.toMatch(/v_content[\s\S]{0,40}RAISE/);
      expect(sql).not.toMatch(/failure_reason = v_content/);
      expect(sql).not.toMatch(/bootstrap_token/);
    }
    expect(verification).toMatch(/RAISE WARNING 'Dispatch credential repair failed \(%\)', v_reason/);
  });

  it("restricts the repair table and functions to service_role only", () => {
    expect(table).toMatch(/ALTER TABLE public\.dispatch_repair_attempts ENABLE ROW LEVEL SECURITY/);
    expect(table).not.toMatch(/CREATE POLICY[\s\S]*dispatch_repair_attempts/);
    expect(table).toMatch(/REVOKE ALL ON TABLE public\.dispatch_repair_attempts FROM anon/);
    expect(table).toMatch(/REVOKE ALL ON TABLE public\.dispatch_repair_attempts FROM authenticated/);
    expect(table).toMatch(/GRANT SELECT, INSERT, UPDATE ON TABLE public\.dispatch_repair_attempts TO service_role/);

    for (const sql of [initiation, verification]) {
      expect(sql).toMatch(/SECURITY DEFINER/);
      expect(sql).toMatch(/SET search_path = public/);
      expect(sql).toMatch(/FROM anon/);
      expect(sql).toMatch(/FROM authenticated/);
      expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.\w+\(\) TO service_role/);
    }
  });

  it("schedules both phases idempotently", () => {
    const sql = latestContaining("verify-dispatch-credential-repair");
    for (const job of ["self-heal-dispatch-credentials", "verify-dispatch-credential-repair"]) {
      expect(sql).toMatch(new RegExp(`cron\\.unschedule\\('${job}'\\)`));
      expect(sql).toMatch(new RegExp(`cron\\.schedule\\(\\s*\\n?\\s*'${job}'`));
    }
  });

  it("allows a bounded retry after a failed or expired attempt", () => {
    // Expired pendings are swept to 'failed' first, which frees the unique
    // partial index so a later cycle can queue a fresh attempt.
    const sweepAt = initiation.indexOf("AND deadline_at <= now()");
    const gateAt = initiation.indexOf("IF EXISTS (SELECT 1 FROM public.dispatch_repair_attempts WHERE status = 'pending')");
    expect(sweepAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(sweepAt);
  });
});
