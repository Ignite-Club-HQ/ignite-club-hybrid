/**
 * Local, dependency-injected port of `supabase/functions/recover-account/index.ts`
 * (see reference/backend/supabase/functions/recover-account/index.ts.md).
 *
 * The reference Edge Function is never imported, transpiled-and-executed, or
 * otherwise run here; only its pure control-flow logic (bearer-token
 * extraction, error-message sanitisation, rate limiting, and the handler's
 * ordering of checks) is faithfully re-implemented against injected fakes so
 * the same security properties can be exercised locally.
 */

const RATE_LIMIT_WINDOW_SECONDS = 3600;
const RATE_LIMIT_MAX_REQUESTS = 5;
const MAX_REQUEST_SIZE = 1024;

const SENSITIVE_PATTERNS = [
  /password/gi,
  /secret/gi,
  /key/gi,
  /token/gi,
  /credential/gi,
  /api[_-]?key/gi,
  /auth/gi,
  /bearer/gi,
  /connection.*string/gi,
  /database.*url/gi,
];

export function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  let sanitized = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized;
}

export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const trimmed = authHeader.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) return null;
  const token = trimmed.slice(7).trim();
  if (!token) return null;
  const lower = token.toLowerCase();
  if (lower === 'undefined' || lower === 'null') return null;
  return token;
}

export interface RateLimitRow {
  id: string;
  request_count: number;
  window_start: string;
}

export interface RateLimitTable {
  select: (identifier: string, endpoint: string) => Promise<RateLimitRow | null>;
  insert: (row: { identifier: string; endpoint: string; request_count: number; window_start: string }) => Promise<void>;
  update: (id: string, patch: { request_count: number; window_start?: string; updated_at: string }) => Promise<void>;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export async function checkRateLimit(
  table: RateLimitTable,
  identifier: string,
  endpoint: string,
  maxRequests: number = RATE_LIMIT_MAX_REQUESTS,
  windowSeconds: number = RATE_LIMIT_WINDOW_SECONDS,
): Promise<RateLimitResult> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowSeconds * 1000);

  const existing = await table.select(identifier, endpoint);

  if (existing) {
    const recordWindowStart = new Date(existing.window_start);

    if (recordWindowStart < windowStart) {
      await table.update(existing.id, {
        request_count: 1,
        window_start: now.toISOString(),
        updated_at: now.toISOString(),
      });
      return { allowed: true, remaining: maxRequests - 1, resetAt: new Date(now.getTime() + windowSeconds * 1000) };
    }

    if (existing.request_count >= maxRequests) {
      return { allowed: false, remaining: 0, resetAt: new Date(recordWindowStart.getTime() + windowSeconds * 1000) };
    }

    await table.update(existing.id, {
      request_count: existing.request_count + 1,
      updated_at: now.toISOString(),
    });
    return {
      allowed: true,
      remaining: maxRequests - existing.request_count - 1,
      resetAt: new Date(recordWindowStart.getTime() + windowSeconds * 1000),
    };
  }

  await table.insert({ identifier, endpoint, request_count: 1, window_start: now.toISOString() });
  return { allowed: true, remaining: maxRequests - 1, resetAt: new Date(now.getTime() + windowSeconds * 1000) };
}

export interface RecoverAccountDeps {
  getUser: (bearer: string) => Promise<{ user: { id: string } | null; error: unknown }>;
  rateLimitTable: RateLimitTable;
  updateProfile: (userId: string) => Promise<{ error: unknown }>;
}

export async function handleRecoverAccount(req: Request, deps: RecoverAccountDeps): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200 });
  }

  try {
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_REQUEST_SIZE) {
      return new Response(JSON.stringify({ error: 'Request too large' }), { status: 413 });
    }

    const authHeader = req.headers.get('Authorization');
    const bearer = extractBearerToken(authHeader);
    if (!bearer) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401 });
    }

    const { user, error: userError } = await deps.getUser(bearer);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401 });
    }

    const rateLimitResult = await checkRateLimit(deps.rateLimitTable, user.id, 'recover-account');
    if (!rateLimitResult.allowed) {
      const retryAfter = Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000);
      return new Response(
        JSON.stringify({ error: 'Too many attempts. Please try again later.', retryAfter }),
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      );
    }

    const { error: updateError } = await deps.updateProfile(user.id);
    if (updateError) {
      console.error('Error recovering account:', sanitizeError(updateError));
      return new Response(JSON.stringify({ error: 'Failed to process request' }), { status: 500 });
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Account recovered successfully' }),
      { status: 200 },
    );
  } catch (error) {
    console.error('Error:', sanitizeError(error));
    return new Response(JSON.stringify({ error: 'An unexpected error occurred' }), { status: 500 });
  }
}
