/**
 * Local equivalent of the exported `edgeFunctionGovernance.test.ts` suite.
 * Governance tests: every Edge Function that external providers or cron
 * must reach has to be declared in `supabase/config.toml` with
 * `verify_jwt = false`, and functions that carry their own auth must not
 * silently lose it. Reads the sanitized reference config/function tree as
 * inert text/directory structure only.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function extractSanitizedSource(mdText: string): string {
  const lines = mdText.split('\n');
  const openIndex = lines.findIndex((line) => /^`{4,}/.test(line));
  if (openIndex === -1) throw new Error('Missing fenced source block in reference markdown');
  const closeIndex = lines.findIndex(
    (line, index) => index > openIndex && /^`{4,}\s*$/.test(line),
  );
  if (closeIndex === -1) throw new Error('Unterminated fenced source block in reference markdown');
  return lines.slice(openIndex + 1, closeIndex).join('\n');
}

const supabaseRoot = path.resolve(__dirname, '../../reference/backend/supabase');
const configToml = extractSanitizedSource(
  readFileSync(path.join(supabaseRoot, 'config.toml.md'), 'utf8'),
);

function verifyJwtFor(fn: string): string | null {
  const m = configToml.match(new RegExp(`\\[functions\\.${fn}\\]\\s*\\n\\s*verify_jwt\\s*=\\s*(\\w+)`));
  return m ? m[1] : null;
}

/** Provider webhooks: Stripe/etc. cannot supply a Supabase JWT. */
const PROVIDER_WEBHOOKS = ['stripe-webhook'];

describe('edge function gateway governance', () => {
  it.each(PROVIDER_WEBHOOKS)('%s is declared with verify_jwt = false', (fn) => {
    expect(existsSync(path.join(supabaseRoot, 'functions', fn))).toBe(true);
    expect(verifyJwtFor(fn)).toBe('false');
  });

  it('every function declared in config.toml actually exists', () => {
    const declared = [...configToml.matchAll(/\[functions\.([a-z0-9-]+)\]/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    for (const fn of declared) {
      expect(
        existsSync(path.join(supabaseRoot, 'functions', fn)),
        `declared function missing on disk: ${fn}`,
      ).toBe(true);
    }
  });

  it('no function is declared twice with conflicting verify_jwt values', () => {
    const declared = [...configToml.matchAll(/\[functions\.([a-z0-9-]+)\]/g)].map((m) => m[1]);
    expect(new Set(declared).size).toBe(declared.length);
  });

  it('shared helpers are not deployed as standalone functions', () => {
    const dirs = readdirSync(path.join(supabaseRoot, 'functions'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(dirs).toContain('_shared');
    expect(verifyJwtFor('_shared')).toBeNull();
  });
});
