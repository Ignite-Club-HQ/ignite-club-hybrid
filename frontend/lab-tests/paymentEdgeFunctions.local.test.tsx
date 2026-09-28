/**
 * Local equivalent of the exported `paymentEdgeFunctions.security.test.ts`
 * suite: security contracts for payment-related Edge Functions.
 *
 * The handlers themselves import Deno/esm.sh modules and register `serve()`
 * at module load, so they cannot be invoked directly under Vitest. The
 * assertions below protect the security-critical ordering and fail-closed
 * checks in the sanitized, inert reference source (read as text only, never
 * executed) exactly as the original suite protects the real deployed source.
 * The pure verification/redirect-allowlisting helpers are exercised directly
 * via a faithful local port of the corresponding `_shared` modules.
 *
 * One marker had to be reconstructed: the export sanitizer replaced the
 * literal Stripe Checkout Sessions API URL in `create-event-checkout` with
 * a placeholder (`https://reference.invalid`), so the "URL validation
 * happens before the Stripe call" ordering check below looks for the
 * `fetch(` call site instead of the literal API URL — the ordering
 * assertion is otherwise identical.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  authoritativeEventAmountCents,
  verifyMemberPaymentRecord,
  verifyStripeCheckoutSession,
  verifyStripePaymentIntent,
} from '../src/lab/edgeGuards/eventPaymentVerification';
import {
  buildApprovedOrigins,
  resolveRedirectUrl,
} from '../src/lab/edgeGuards/redirectOrigins';

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

const functionsRoot = path.resolve(__dirname, '../../reference/backend/supabase/functions');
const readFunction = (name: string) =>
  extractSanitizedSource(readFileSync(path.join(functionsRoot, name, 'index.ts.md'), 'utf8'));

const confirmPayment = readFunction('confirm-event-payment');
const createCheckout = readFunction('create-event-checkout');
const cancelSubscription = readFunction('cancel-subscription');

function indexOfAny(source: string, patterns: RegExp[]): number {
  const indexes = patterns
    .map((pattern) => source.search(pattern))
    .filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : -1;
}

describe('confirm-event-payment — authoritative payment verification', () => {
  it('verifies the payment with Stripe before inserting a paid record', () => {
    const providerVerification = indexOfAny(confirmPayment, [
      /paymentIntents\.retrieve\s*\(/,
      /checkout\.sessions\.retrieve\s*\(/,
      /verify[_A-Za-z]*payment/i,
    ]);
    const paidInsert = confirmPayment.indexOf(".from('event_payments')", confirmPayment.indexOf('// Insert payment record'));

    expect(providerVerification).toBeGreaterThan(-1);
    expect(paidInsert).toBeGreaterThan(providerVerification);
  });

  it('never uses the caller-supplied amount as the recorded authoritative amount', () => {
    expect(confirmPayment).not.toMatch(/const\s*\{[^}]*\bamount\b[^}]*\}\s*=\s*await req\.json\(\)/s);
    expect(confirmPayment).toMatch(/authoritativeEventAmountCents\s*\(\s*event\.amount\s*\)/);
    expect(authoritativeEventAmountCents(12.34)).toBe(1234);
    expect(authoritativeEventAmountCents(0)).toBeNull();
  });

  it('binds verified provider metadata to the authenticated user and requested event', () => {
    const expected = {
      eventId: 'event-1',
      userId: 'user-1',
      clubId: 'club-1',
      amountCents: 1500,
      currency: 'aud',
    };
    const paidIntent = {
      status: 'succeeded',
      amount_received: 1500,
      currency: 'aud',
      metadata: { event_id: 'event-1', user_id: 'user-1', club_id: 'club-1' },
    };
    expect(verifyStripePaymentIntent(paidIntent, expected).ok).toBe(true);
    expect(verifyStripePaymentIntent({
      ...paidIntent,
      metadata: { ...paidIntent.metadata, event_id: 'another-event' },
    }, expected)).toEqual({ ok: false, code: 'payment_event_mismatch' });
    expect(verifyStripePaymentIntent({
      ...paidIntent,
      metadata: { ...paidIntent.metadata, user_id: 'another-user' },
    }, expected)).toEqual({ ok: false, code: 'payment_user_mismatch' });
  });

  it('requires a succeeded/paid provider state before recording payment', () => {
    const expected = {
      eventId: 'event-1', userId: 'user-1', clubId: 'club-1',
      amountCents: 1500, currency: 'aud',
    };
    const metadata = { event_id: 'event-1', user_id: 'user-1', club_id: 'club-1' };
    expect(verifyStripePaymentIntent({
      status: 'processing', amount: 1500, currency: 'aud', metadata,
    }, expected)).toEqual({ ok: false, code: 'payment_not_completed' });
    expect(verifyStripeCheckoutSession({
      status: 'complete', payment_status: 'unpaid', amount_total: 1500,
      currency: 'aud', metadata,
    }, expected)).toEqual({ ok: false, code: 'payment_not_completed' });
    expect(verifyMemberPaymentRecord({
      status: 'pending', amount_cents: 1500, currency: 'aud',
      event_id: 'event-1', user_id: 'user-1', club_id: 'club-1',
    }, expected)).toEqual({ ok: false, code: 'payment_not_completed' });
  });

  it('fails closed when club-membership authorization RPC errors', () => {
    expect(confirmPayment).toMatch(/\{\s*data:\s*isMember\s*,\s*error:\s*\w+/);
    expect(confirmPayment).toMatch(/membershipError[\s\S]{0,500}return fail\(['"]membership_lookup_failed['"],\s*503/);
  });

  it('fails closed when atomic payment recording errors', () => {
    expect(confirmPayment).toMatch(/recordVerifiedPayment[\s\S]*recorded\.status === ['"]error['"]/);
    expect(confirmPayment).toMatch(/recorded\.status === ['"]error['"][\s\S]{0,200}payment_record_failed/);
  });

  it('uses an atomic uniqueness boundary for concurrent confirmation retries', () => {
    const atomicRpc = /\.rpc\s*\(\s*['"](?:confirm|record|upsert)[^'"]*payment/i.test(confirmPayment);
    const conflictSafeUpsert = /\.from\s*\(\s*['"]event_payments['"]\s*\)[\s\S]{0,250}\.upsert\s*\(/.test(confirmPayment);
    expect(atomicRpc || conflictSafeUpsert).toBe(true);
  });

  it('returns sanitized failures without provider, database or credential details', () => {
    expect(confirmPayment).not.toMatch(/JSON\.stringify\s*\(\s*\{\s*error:\s*(?:error|err|\w+Error)\.message/);
    expect(confirmPayment).not.toMatch(/JSON\.stringify\s*\(\s*\{\s*error:\s*(?:stripe|payment)(?:Data|Error)/i);
  });
});

describe('create-event-checkout — validation and external failure safety', () => {
  it('has exactly one service-role client binding and remains syntactically deployable', () => {
    const declarations = createCheckout.match(/const\s+supabaseAdmin\s*=\s*createClient\s*\(/g) ?? [];
    expect(declarations).toHaveLength(1);
  });

  it('validates supplied success and cancellation URLs against an approved origin', () => {
    const urlValidation = indexOfAny(createCheckout, [
      /validate[A-Za-z]*Redirect/,
      /resolveRedirectUrl/,
      /allowed[A-Za-z]*Origin/i,
      /new URL\s*\([\s\S]{0,120}\.origin/,
    ]);
    // Reconstructed marker — see file header comment.
    const stripeCall = createCheckout.indexOf('stripeResponse = await fetch(');
    expect(urlValidation).toBeGreaterThan(-1);
    expect(stripeCall).toBeGreaterThan(urlValidation);
    const origins = buildApprovedOrigins({
      APP_PUBLIC_ORIGIN: 'https://app.ignite.example',
    });
    expect(resolveRedirectUrl(
      'https://evil.example/steal',
      'https://app.ignite.example/events/1',
      origins,
    ).ok).toBe(false);
    expect(resolveRedirectUrl(
      'https://app.ignite.example/events/1?payment=success',
      'https://app.ignite.example/events/1',
      origins,
    ).ok).toBe(true);
  });

  it('derives price and payment metadata from the stored event', () => {
    expect(createCheckout).toMatch(/Math\.round\(event\.amount \* 100\)/);
    expect(createCheckout).toMatch(/'metadata\[event_id\]'\s*:\s*eventId/);
    expect(createCheckout).toMatch(/'metadata\[user_id\]'\s*:\s*user\.id/);
    expect(createCheckout).toMatch(/'metadata\[club_id\]'\s*:\s*event\.club_id/);
  });

  it('fails closed when the existing-payment lookup errors', () => {
    expect(createCheckout).toMatch(/\{\s*data:\s*existingPayment\s*,\s*error:\s*\w+/);
    expect(createCheckout).toMatch(/(?:existingPaymentError|paymentLookupError)[\s\S]{0,250}(?:500|return new Response)/);
  });

  it("does not echo Stripe's raw error message to the caller", () => {
    expect(createCheckout).not.toMatch(/JSON\.stringify\(\{\s*error:\s*stripeData\.error\?\.message/);
    expect(createCheckout).not.toMatch(/JSON\.stringify\(stripeData\)/);
  });

  it('never logs the club Stripe secret or Authorization header', () => {
    const logs = [...createCheckout.matchAll(/console\.(?:log|warn|error)\(([^\n]*)\)/g)].map((match) => match[1]);
    for (const args of logs) {
      expect(args.replace(/['"][^'"]*['"]/g, '')).not.toMatch(/stripe_secret_key|authHeader|Authorization/);
    }
  });
});

describe('cancel-subscription — fail-closed cancellation ordering', () => {
  it('does not downgrade entitlements before Stripe cancellation succeeds', () => {
    const cancel = cancelSubscription.indexOf('subscriptions.cancel');
    const downgrade = indexOfAny(cancelSubscription, [
      /is_pro:\s*false/,
      /is_pro_football:\s*false/,
    ]);
    expect(cancel).toBeGreaterThan(-1);
    expect(downgrade).toBeGreaterThan(cancel);
  });

  it('does not downgrade a Stripe-backed subscription when no secret key exists', () => {
    const missingKey = cancelSubscription.indexOf('stripe_cancel_blocked_no_key');
    const downgrade = cancelSubscription.indexOf('is_pro: false');
    expect(missingKey).toBeGreaterThan(-1);
    expect(downgrade).toBeGreaterThan(missingKey);
    expect(cancelSubscription.slice(missingKey, downgrade)).toMatch(/status:\s*409/);
  });

  it('does not report success when the authoritative team entitlement update fails', () => {
    expect(cancelSubscription).toMatch(/if\s*\(teamUpdateError\)\s*\{[\s\S]*?return new Response/);
  });

  it('does not report success when the authoritative club fallback update fails', () => {
    expect(cancelSubscription).toMatch(/if\s*\(clubUpdateError\)\s*\{[\s\S]*?return new Response/);
  });

  it('returns sanitized catch-all failures', () => {
    expect(cancelSubscription).not.toMatch(/JSON\.stringify\(\{\s*error:\s*error\.message\s*\}\)/);
    expect(cancelSubscription).toMatch(/JSON\.stringify\(\{\s*error:\s*['"][^'"]+['"]\s*\}\)/);
  });
});
