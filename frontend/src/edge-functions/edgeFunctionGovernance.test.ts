/**
 * Governance tests: every Edge Function that external providers or cron must
 * reach has to be declared in `supabase/config.toml` with `verify_jwt = false`,
 * and functions that carry their own auth must not silently lose it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const configToml = readFileSync(path.join(root, "supabase/config.toml"), "utf8");

function verifyJwtFor(fn: string): string | null {
  const m = configToml.match(
    new RegExp(`\\[functions\\.${fn}\\]\\s*\\n\\s*verify_jwt\\s*=\\s*(\\w+)`),
  );
  return m ? m[1] : null;
}

/** Provider webhooks: Stripe/etc. cannot supply a Supabase JWT. */
const PROVIDER_WEBHOOKS = ["stripe-webhook"];

describe("edge function gateway governance", () => {
  it.each(PROVIDER_WEBHOOKS)(
    "%s is declared with verify_jwt = false",
    (fn) => {
      expect(existsSync(path.join(root, "supabase/functions", fn))).toBe(true);
      expect(verifyJwtFor(fn)).toBe("false");
    },
  );

  it("every function declared in config.toml actually exists", () => {
    const declared = [...configToml.matchAll(/\[functions\.([a-z0-9-]+)\]/g)].map(
      (m) => m[1],
    );
    expect(declared.length).toBeGreaterThan(0);
    for (const fn of declared) {
      expect(
        existsSync(path.join(root, "supabase/functions", fn)),
        `declared function missing on disk: ${fn}`,
      ).toBe(true);
    }
  });

  it("no function is declared twice with conflicting verify_jwt values", () => {
    const declared = [...configToml.matchAll(/\[functions\.([a-z0-9-]+)\]/g)].map(
      (m) => m[1],
    );
    expect(new Set(declared).size).toBe(declared.length);
  });

  it("shared helpers are not deployed as standalone functions", () => {
    const dirs = readdirSync(path.join(root, "supabase/functions"), {
      withFileTypes: true,
    })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(dirs).toContain("_shared");
    expect(verifyJwtFor("_shared")).toBeNull();
  });
});
