/**
 * Local equivalent of the exported `edgeFunctionSourceValidation.test.ts`
 * suite: source-level validation of the Stripe webhook handler. These
 * assertions guard security ordering that cannot be observed from the
 * outside (verification before privileged-client creation, no secret /
 * signature / raw-body logging), read as inert text from the sanitized
 * reference sources.
 */
import { readFileSync } from 'node:fs';
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

const functionsRoot = path.resolve(__dirname, '../../reference/backend/supabase/functions');
const read = (relPath: string) =>
  extractSanitizedSource(readFileSync(path.join(functionsRoot, relPath), 'utf8'));

const src = read('stripe-webhook/index.ts.md');
const shared = read('_shared/stripeSignature.ts.md');

describe('stripe-webhook source validation', () => {
  it('verifies the signature before creating a service-role Supabase client', () => {
    const verifyIdx = src.indexOf('await verifyStripeSignature(');
    const clientIdx = src.indexOf('createClient(');
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(clientIdx).toBeGreaterThan(-1);
    // The only createClient call in the request path must come after verification.
    const requestPathClient = src.indexOf("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')");
    expect(requestPathClient).toBeGreaterThan(verifyIdx);
  });

  it('parses the JSON body only after verification succeeds', () => {
    const verifyIdx = src.indexOf('await verifyStripeSignature(');
    expect(src.indexOf('JSON.parse(body)')).toBeGreaterThan(verifyIdx);
  });

  it('fails closed with 503 when the webhook secret is not configured', () => {
    expect(src).toMatch(/STRIPE_WEBHOOK_SECRET[\s\S]{0,400}status: 503/);
  });

  it('claims the event in the ledger before applying business mutations', () => {
    const claimIdx = src.indexOf('claim_stripe_webhook_event');
    const switchIdx = src.indexOf('switch (eventType)');
    expect(claimIdx).toBeGreaterThan(-1);
    expect(switchIdx).toBeGreaterThan(claimIdx);
  });

  it('marks the event completed only after handlers succeed and failed on error', () => {
    expect(src).toMatch(/complete_stripe_webhook_event/);
    expect(src).toMatch(/fail_stripe_webhook_event/);
    const completeIdx = src.indexOf('complete_stripe_webhook_event');
    const catchIdx = src.indexOf('} catch (error) {', completeIdx);
    expect(catchIdx).toBeGreaterThan(completeIdx);
  });

  it('acknowledges already-completed duplicates with 2xx', () => {
    expect(src).toMatch(/duplicate_completed[\s\S]{0,300}received: true/);
  });

  it('never logs the webhook secret, the signature header or the raw body', () => {
    const logs = [...src.matchAll(/console\.(log|error|warn)\(([^\n]*)\)/g)].map((m) => m[2]);
    for (const args of logs) {
      expect(args).not.toMatch(/webhookSecret|STRIPE_WEBHOOK_SECRET"?\s*\)/);
      // String literals may mention these words; interpolating the values must not happen.
      const interpolated = args.replace(/"[^"]*"|'[^']*'/g, '');
      expect(interpolated).not.toMatch(/\bsignature\b/);
      expect(interpolated).not.toMatch(/\bwebhookSecret\b/);
      expect(interpolated).not.toMatch(/\bbody\b/);
      expect(args).not.toMatch(/JSON\.stringify\(event\)/);
    }
  });

  it('never returns internal error details to Stripe', () => {
    expect(src).toMatch(/error: 'Webhook processing failed'/);
    expect(src).not.toMatch(/JSON\.stringify\(\{\s*error: (error|err)[^a-zA-Z]/);
  });

  it('the signature module uses only Web Crypto and constant-time comparison', () => {
    expect(shared).toMatch(/crypto\.subtle\.importKey/);
    expect(shared).toMatch(/function timingSafeEqual/);
    expect(shared).not.toMatch(/Deno\./);
    expect(shared).toMatch(/Math\.abs\(nowSeconds - ts\) > toleranceSeconds/);
  });
});
