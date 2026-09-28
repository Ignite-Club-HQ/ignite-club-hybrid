/**
 * Source-level validation of the Stripe webhook handler.
 *
 * These assertions guard the security ordering that cannot be observed from
 * the outside: verification must run before any privileged client is created,
 * and no secret, signature or full payment payload may be logged.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const src = readFileSync(
  path.join(root, "supabase/functions/stripe-webhook/index.ts"),
  "utf8",
);
const shared = readFileSync(
  path.join(root, "supabase/functions/_shared/stripeSignature.ts"),
  "utf8",
);

describe("stripe-webhook source validation", () => {
  it("verifies the signature before creating a service-role Supabase client", () => {
    const verifyIdx = src.indexOf("await verifyStripeSignature(");
    const clientIdx = src.indexOf("createClient(");
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(clientIdx).toBeGreaterThan(-1);
    // The only createClient call in the request path must come after verification.
    const requestPathClient = src.indexOf(
      "Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')",
    );
    expect(requestPathClient).toBeGreaterThan(verifyIdx);
  });

  it("parses the JSON body only after verification succeeds", () => {
    const verifyIdx = src.indexOf("await verifyStripeSignature(");
    expect(src.indexOf("JSON.parse(body)")).toBeGreaterThan(verifyIdx);
  });

  it("fails closed with 503 when the webhook secret is not configured", () => {
    expect(src).toMatch(/STRIPE_WEBHOOK_SECRET[\s\S]{0,400}status: 503/);
  });

  it("claims the event in the ledger before applying business mutations", () => {
    const claimIdx = src.indexOf("claim_stripe_webhook_event");
    const switchIdx = src.indexOf("switch (eventType)");
    expect(claimIdx).toBeGreaterThan(-1);
    expect(switchIdx).toBeGreaterThan(claimIdx);
  });

  it("marks the event completed only after handlers succeed and failed on error", () => {
    expect(src).toMatch(/complete_stripe_webhook_event/);
    expect(src).toMatch(/fail_stripe_webhook_event/);
    const completeIdx = src.indexOf("complete_stripe_webhook_event");
    const catchIdx = src.indexOf("} catch (error) {", completeIdx);
    expect(catchIdx).toBeGreaterThan(completeIdx);
  });

  it("acknowledges already-completed duplicates with 2xx", () => {
    expect(src).toMatch(/duplicate_completed[\s\S]{0,300}received: true/);
  });

  it("never logs the webhook secret, the signature header or the raw body", () => {
    const logs = [...src.matchAll(/console\.(log|error|warn)\(([^\n]*)\)/g)].map(
      (m) => m[2],
    );
    for (const args of logs) {
      expect(args).not.toMatch(/webhookSecret|STRIPE_WEBHOOK_SECRET"?\s*\)/);
      // String literals may mention these words; interpolating the values must not happen.
      const interpolated = args.replace(/"[^"]*"|'[^']*'/g, "");
      expect(interpolated).not.toMatch(/\bsignature\b/);
      expect(interpolated).not.toMatch(/\bwebhookSecret\b/);
      expect(interpolated).not.toMatch(/\bbody\b/);
      expect(args).not.toMatch(/JSON\.stringify\(event\)/);
    }
  });

  it("never returns internal error details to Stripe", () => {
    expect(src).toMatch(/error: 'Webhook processing failed'/);
    expect(src).not.toMatch(/JSON\.stringify\(\{\s*error: (error|err)[^a-zA-Z]/);
  });

  it("the signature module uses only Web Crypto and constant-time comparison", () => {
    expect(shared).toMatch(/crypto\.subtle\.importKey/);
    expect(shared).toMatch(/function timingSafeEqual/);
    expect(shared).not.toMatch(/Deno\./);
    expect(shared).toMatch(/Math\.abs\(nowSeconds - ts\) > toleranceSeconds/);
  });
});
