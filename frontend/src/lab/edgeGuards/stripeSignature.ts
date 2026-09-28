/**
 * Local port of the sanitized Stripe webhook signature verification module
 * (`reference/backend/supabase/functions/_shared/stripeSignature.ts.md`).
 *
 * Standards-compatible implementation of Stripe's `Stripe-Signature` scheme,
 * written against Web Crypto only so it runs identically in Deno (Supabase
 * Edge) and Node/vitest.
 *
 * Guarantees:
 *  - timestamp is parsed strictly as a finite integer; malformed / missing /
 *    non-numeric timestamps are rejected.
 *  - the ABSOLUTE difference between now and the timestamp must be <= 300s,
 *    so both stale AND future-dated signatures are rejected.
 *  - the exact raw request body is verified (never a re-serialised object).
 *  - multiple `v1` signatures are supported; the request is accepted if ANY
 *    of them matches.
 *  - signature bytes are compared in constant time.
 *  - nothing about the secret or the signature is ever logged.
 */

export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

export type StripeSignatureFailure =
  | 'missing_signature'
  | 'missing_secret'
  | 'malformed_signature'
  | 'malformed_timestamp'
  | 'timestamp_out_of_tolerance'
  | 'signature_mismatch';

export interface StripeSignatureResult {
  valid: boolean;
  reason?: StripeSignatureFailure;
}

interface ParsedHeader {
  timestamp: string | null;
  v1: string[];
}

export function parseStripeSignatureHeader(header: string): ParsedHeader {
  const parsed: ParsedHeader = { timestamp: null, v1: [] };
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 't' && parsed.timestamp === null) parsed.timestamp = value;
    else if (key === 'v1' && value.length > 0) parsed.v1.push(value);
  }
  return parsed;
}

/** Strict integer parse — rejects "", "abc", "12abc", "1.5", "NaN", "Infinity". */
export function parseStripeTimestamp(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
  return value;
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

/** Constant-time byte comparison. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyStripeSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string | undefined | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds: number = STRIPE_SIGNATURE_TOLERANCE_SECONDS,
): Promise<StripeSignatureResult> {
  if (!secret) return { valid: false, reason: 'missing_secret' };
  if (!signatureHeader) return { valid: false, reason: 'missing_signature' };

  const { timestamp, v1 } = parseStripeSignatureHeader(signatureHeader);
  if (v1.length === 0) return { valid: false, reason: 'malformed_signature' };

  const ts = parseStripeTimestamp(timestamp);
  if (ts === null) return { valid: false, reason: 'malformed_timestamp' };

  if (Math.abs(nowSeconds - ts) > toleranceSeconds) {
    return { valid: false, reason: 'timestamp_out_of_tolerance' };
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`${ts}.${payload}`)),
  );

  for (const candidate of v1) {
    const bytes = hexToBytes(candidate);
    if (bytes && timingSafeEqual(expected, bytes)) {
      return { valid: true };
    }
  }
  return { valid: false, reason: 'signature_mismatch' };
}

/** Test / caller helper: build a valid `Stripe-Signature` header value. */
export async function signStripePayload(
  payload: string,
  secret: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestampSeconds}.${payload}`)),
  );
  const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${timestampSeconds},v1=${hex}`;
}
