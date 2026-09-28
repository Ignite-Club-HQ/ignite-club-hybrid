/**
 * Authentication contract for Edge Functions deployed with `verify_jwt = false`.
 *
 * These functions do privileged work (service-role database access, email and
 * push delivery, exports, cleanups). Because the gateway does not verify a JWT
 * for them, each one MUST authenticate its caller in code, and must do so
 * BEFORE any privileged operation: creating a service-role client, reading the
 * request payload, querying data, or sending anything outbound.
 *
 * The checks here are static (source-level) so they run in CI without a Deno
 * runtime or network access.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const fnDir = (fn: string) => path.join(root, "supabase/functions", fn);
const source = (fn: string) => readFileSync(path.join(fnDir(fn), "index.ts"), "utf8");
const configToml = readFileSync(path.join(root, "supabase/config.toml"), "utf8");

/** Functions whose only legitimate caller is internal (cron, DB trigger, another function). */
const SERVICE_ROLE_ONLY = [
  "backfill-chat-vault-groups",
  "check-push-failure-rate",
  "cleanup-old-notifications",
  "export-write-audit",
  "process-message-notifications",
  "process-weekly-engagement-bonus",
  "retry-missed-push-notifications",
  "send-block-alert-email",
  "send-invite-reminders",
];

/** Cron-driven, but also manually runnable by an app admin from the admin UI. */
const SERVICE_ROLE_OR_APP_ADMIN = ["cleanup-push-subscriptions", "post-game-photo-prompts"];

/** Called by the app on behalf of a signed-in user. */
const AUTHENTICATED_USER = ["send-feedback-email", "send-welcome-dm"];

const ALL = [...SERVICE_ROLE_ONLY, ...SERVICE_ROLE_OR_APP_ADMIN, ...AUTHENTICATED_USER];

/** Endpoints that are intentionally public reads — the ONLY allowed exceptions. */
const INTENTIONALLY_PUBLIC = ["public-club-events", "public-club-teams"];

/** Start of the request handler body (module scope above it is not request work). */
function handlerStart(src: string): number {
  const idx = [src.indexOf("Deno.serve("), src.indexOf("serve(async")]
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];
  return idx ?? -1;
}

/** First privileged operation inside the handler, or Infinity. */
function firstPrivilegedIndex(src: string): number {
  const start = handlerStart(src);
  const body = src.slice(start);
  const markers = [
    "createClient(",
    "req.json(",
    "new Resend(",
    "serviceClient(",
  ];
  const found = markers
    .map((m) => body.indexOf(m))
    .filter((i) => i >= 0)
    .map((i) => i + start);
  return found.length ? Math.min(...found) : Number.POSITIVE_INFINITY;
}

function authIndex(src: string): number {
  const start = handlerStart(src);
  const body = src.slice(start);
  const markers = [
    "requireServiceRoleAuth(req",
    "requireServiceRoleOrAppAdmin(req",
    "authenticateUser(req",
    "isServiceRoleCaller(req",
  ];
  const found = markers
    .map((m) => body.indexOf(m))
    .filter((i) => i >= 0)
    .map((i) => i + start);
  return found.length ? Math.min(...found) : -1;
}

describe("edge function authentication contract", () => {
  it.each(ALL)("%s exists and is declared verify_jwt = false", (fn) => {
    expect(existsSync(fnDir(fn)), `${fn} missing on disk`).toBe(true);
    const m = configToml.match(
      new RegExp(`\\[functions\\.${fn}\\]\\s*\\n\\s*verify_jwt\\s*=\\s*(\\w+)`),
    );
    expect(m?.[1], `${fn} not declared in config.toml`).toBe("false");
  });

  it.each(ALL)("%s authenticates its caller", (fn) => {
    const src = source(fn);
    expect(src).toContain("_shared/callerAuth.ts");
    expect(authIndex(src), `${fn} has no caller authentication in its handler`).toBeGreaterThan(-1);
  });

  it.each(ALL)("%s authenticates before any privileged work", (fn) => {
    const src = source(fn);
    const auth = authIndex(src);
    const privileged = firstPrivilegedIndex(src);
    expect(
      auth < privileged,
      `${fn} performs privileged work before authenticating`,
    ).toBe(true);
  });

  it.each(ALL)("%s still handles OPTIONS preflight", (fn) => {
    const src = source(fn);
    expect(src).toMatch(/req\.method === ['"]OPTIONS['"]/);
    // Preflight must be answered before auth so browsers can complete CORS.
    expect(src.indexOf("OPTIONS")).toBeLessThan(authIndex(src));
  });

  it.each(ALL)("%s returns 401 on missing/invalid credentials", (fn) => {
    const src = source(fn);
    const helper = readFileSync(
      path.join(root, "supabase/functions/_shared/callerAuth.ts"),
      "utf8",
    );
    const internal = readFileSync(
      path.join(root, "supabase/functions/_shared/internal-auth.ts"),
      "utf8",
    );
    // The 401 lives in the shared helpers the function delegates to.
    expect(helper).toContain("401");
    expect(internal).toContain("401");
    expect(src).toContain("_shared/callerAuth.ts");
  });

  it.each(SERVICE_ROLE_ONLY)("%s uses the service-role boundary", (fn) => {
    expect(source(fn)).toContain("requireServiceRoleAuth(req");
  });

  it.each(SERVICE_ROLE_OR_APP_ADMIN)("%s uses the service-role-or-app-admin boundary", (fn) => {
    expect(source(fn)).toContain("requireServiceRoleOrAppAdmin(req");
  });

  it.each(AUTHENTICATED_USER)("%s validates an end-user token", (fn) => {
    expect(source(fn)).toContain("authenticateUser(req");
  });

  it("send-welcome-dm only lets a user request their own welcome DM", () => {
    const src = source("send-welcome-dm");
    expect(src).toContain("__callerUserId");
    expect(src).toMatch(/userId !== __callerUserId/);
    expect(src).toContain("forbidden(corsHeaders)");
  });

  it("send-feedback-email derives identity from the token, not the payload", () => {
    const src = source("send-feedback-email");
    expect(src).toContain("__user.email");
    // Payload-supplied email must not be trusted.
    expect(src).not.toMatch(/const \{[^}]*userEmail[^}]*\} = await req\.json\(\)/);
    // Length limits on free-text fields.
    expect(src).toContain("slice(0, 5000)");
    expect(src).toContain("title.length > 200");
  });

  it("no credential is compared without a constant-time-ish check", () => {
    const helper = readFileSync(
      path.join(root, "supabase/functions/_shared/callerAuth.ts"),
      "utf8",
    );
    expect(helper).toContain("charCodeAt(i) ^ expected.charCodeAt(i)");
  });

  it("role lookup failures fail closed with a retriable error, not success", () => {
    const helper = readFileSync(
      path.join(root, "supabase/functions/_shared/callerAuth.ts"),
      "utf8",
    );
    expect(helper).toContain("503");
    expect(helper).toContain("Authorization check unavailable");
  });

  it("public read endpoints remain the only unauthenticated exceptions", () => {
    for (const fn of INTENTIONALLY_PUBLIC) {
      expect(existsSync(fnDir(fn))).toBe(true);
    }
    for (const fn of ALL) {
      expect(INTENTIONALLY_PUBLIC).not.toContain(fn);
    }
  });

  it("no hardcoded anon-key bearer tokens remain in the secured functions", () => {
    for (const fn of ALL) {
      const src = source(fn);
      const matches = src.match(/Bearer eyJ[A-Za-z0-9._-]+/g) ?? [];
      expect(matches, `${fn} embeds a hardcoded bearer token`).toEqual([]);
    }
  });
});
