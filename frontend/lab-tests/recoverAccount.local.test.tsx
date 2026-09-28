/**
 * Local equivalent of the exported `recoverAccount.test.ts` suite.
 *
 * The original bundle test dynamically transpiled and executed the
 * production `recover-account` Edge Function inline (via a data: module URL)
 * with globally-shimmed `Deno`/`createClient`/`serve`. That technique
 * literally runs reference Edge Function code, which the lab boundary
 * forbids regardless of mechanism. Instead, this suite:
 *  - statically verifies the reference source still parses as valid
 *    TypeScript (a compile-only diagnostic pass, never executed), and
 *  - exercises the faithfully ported, dependency-injected control flow in
 *    `frontend/src/lab/edgeGuards/recoverAccount.ts` against synthetic fakes,
 *    preserving every original assertion and its ordering.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleRecoverAccount,
  type RateLimitRow,
  type RateLimitTable,
  type RecoverAccountDeps,
} from '../src/lab/edgeGuards/recoverAccount';

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

const referencePath = path.resolve(
  __dirname,
  '../../reference/backend/supabase/functions/recover-account/index.ts.md',
);
const referenceSource = extractSanitizedSource(readFileSync(referencePath, 'utf8'));

describe('recover-account Edge Function deployability', () => {
  it('parses without TypeScript syntax errors', () => {
    const result = ts.transpileModule(referenceSource, {
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
    });
    const errors = (result.diagnostics ?? []).filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
    expect(errors.length).toBe(0);
  });
});

function request(token?: string, init: RequestInit = {}) {
  return new Request('http://127.0.0.1:54321/functions/v1/recover-account', {
    method: 'POST',
    body: '{}',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...init.headers,
    },
  });
}

interface HarnessOptions {
  userId?: string;
  userError?: unknown;
  rateLimitRecord?: RateLimitRow | null;
  profileUpdateResult?: { error: unknown };
}

function buildHarness(options: HarnessOptions = {}) {
  const getUser = vi.fn(async (_bearer: string) => ({
    user: options.userError ? null : { id: options.userId ?? 'synthetic-user-a' },
    error: options.userError ?? null,
  }));

  const rateSelect = vi.fn(async () => options.rateLimitRecord ?? null);
  const rateInsert = vi.fn(async () => undefined);
  const rateUpdate = vi.fn(async () => undefined);
  const rateLimitTable: RateLimitTable = {
    select: rateSelect,
    insert: rateInsert,
    update: rateUpdate,
  };

  const updateProfile = vi.fn(async (_userId: string) => options.profileUpdateResult ?? { error: null });

  const deps: RecoverAccountDeps = { getUser, rateLimitTable, updateProfile };
  return { deps, getUser, rateInsert, rateUpdate, updateProfile };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recover-account Edge Function security behaviour', () => {
  it.each([undefined, '', '   ', 'undefined', 'null'])(
    'rejects a missing or unusable bearer token %# before creating a Supabase client',
    async (token) => {
      const { deps, getUser } = buildHarness();
      const response = await handleRecoverAccount(request(token), deps);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Authentication required' });
      expect(getUser).not.toHaveBeenCalled();
    },
  );

  it('rejects an invalid authenticated session before creating the service-role client', async () => {
    const { deps, getUser, rateInsert } = buildHarness({ userError: { message: 'invalid JWT' } });
    const response = await handleRecoverAccount(request('malformed-token'), deps);
    expect(response.status).toBe(401);
    expect(getUser).toHaveBeenCalledOnce();
    expect(rateInsert).not.toHaveBeenCalled();
  });

  it("clears only the authenticated user's scheduled deletion date", async () => {
    const { deps, updateProfile } = buildHarness({ userId: 'synthetic-user-a' });
    const response = await handleRecoverAccount(
      request('valid-local-token', { body: JSON.stringify({ userId: 'synthetic-user-b' }) }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(updateProfile).toHaveBeenCalledWith('synthetic-user-a');
    expect(updateProfile).not.toHaveBeenCalledWith('synthetic-user-b');
  });

  it('returns 429 with Retry-After without updating a profile when rate limited', async () => {
    const { deps, updateProfile } = buildHarness({
      rateLimitRecord: {
        id: 'synthetic-rate-limit',
        request_count: 5,
        window_start: new Date().toISOString(),
      },
    });
    const response = await handleRecoverAccount(request('valid-local-token'), deps);
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('returns a sanitized 500 response for a profile update failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { deps } = buildHarness({
      profileUpdateResult: { error: { message: 'postgresql://host/db token=secret' } },
    });
    const response = await handleRecoverAccount(request('valid-local-token'), deps);
    const raw = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(raw)).toEqual({ error: 'Failed to process request' });
    expect(raw).not.toMatch(/postgres|password|token|secret/i);
  });

  it('does not expose sensitive details from unexpected failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { deps, getUser } = buildHarness();
    getUser.mockImplementationOnce(async () => {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY=secret postgres://host/database');
    });
    const response = await handleRecoverAccount(request('valid-local-token'), deps);
    const raw = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(raw)).toEqual({ error: 'An unexpected error occurred' });
    expect(raw).not.toMatch(/supabase|service.role|secret|postgres|database/i);
  });

  it('handles OPTIONS without authentication, rate-limit or profile mutations', async () => {
    const { deps, getUser, rateInsert, updateProfile } = buildHarness();
    const response = await handleRecoverAccount(
      new Request('http://127.0.0.1:54321/functions/v1/recover-account', { method: 'OPTIONS' }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(getUser).not.toHaveBeenCalled();
    expect(rateInsert).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('rejects an oversized request before authentication or mutation', async () => {
    const { deps, getUser, updateProfile } = buildHarness();
    const response = await handleRecoverAccount(
      request('valid-local-token', { headers: { 'content-length': '1025' } }),
      deps,
    );
    expect(response.status).toBe(413);
    expect(getUser).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
  });
});
