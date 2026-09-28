/**
 * Local port of the sanitized shared module
 * `reference/backend/supabase/functions/_shared/eventPaymentVerification.ts.md`.
 *
 * Server-side verification of event payments. A client may only tell us
 * *which* provider object to look at — it may never be authoritative for
 * payment status, amount, currency, or for the user / club / event the
 * payment belongs to. Every fact is re-derived from the provider object /
 * stored event row. All functions are pure so they run identically under
 * Vitest without a Deno runtime, network access or real Stripe keys.
 */

export type PaymentReferenceKind =
  | 'stripe_payment_intent'
  | 'stripe_checkout_session'
  | 'member_payment'
  | 'invalid';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Classify a caller-supplied payment reference without trusting it. */
export function classifyPaymentReference(value: unknown): PaymentReferenceKind {
  if (typeof value !== 'string') return 'invalid';
  const id = value.trim();
  if (!id || id.length > 255) return 'invalid';
  if (/^pi_[A-Za-z0-9_]+$/.test(id)) return 'stripe_payment_intent';
  if (/^cs_[A-Za-z0-9_]+$/.test(id)) return 'stripe_checkout_session';
  if (UUID_RE.test(id)) return 'member_payment';
  return 'invalid';
}

export interface ExpectedPaymentFacts {
  eventId: string;
  userId: string;
  clubId: string;
  /** Authoritative amount, derived from the stored event price. */
  amountCents: number;
  /** Established event-payment currency (lowercase ISO code). */
  currency: string;
}

export type VerificationFailureCode =
  | 'payment_not_found'
  | 'payment_not_completed'
  | 'payment_refunded'
  | 'payment_amount_mismatch'
  | 'payment_currency_mismatch'
  | 'payment_event_mismatch'
  | 'payment_user_mismatch'
  | 'payment_club_mismatch';

export type VerificationResult =
  | { ok: true; amountCents: number; currency: string }
  | { ok: false; code: VerificationFailureCode };

function readMetadata(source: unknown): Record<string, unknown> {
  if (!source || typeof source !== 'object') return {};
  const meta = (source as Record<string, unknown>).metadata;
  if (!meta || typeof meta !== 'object') return {};
  return meta as Record<string, unknown>;
}

function metaString(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function checkIdentity(
  meta: Record<string, unknown>,
  expected: ExpectedPaymentFacts,
): VerificationFailureCode | null {
  if (metaString(meta, 'event_id') !== expected.eventId) {
    return 'payment_event_mismatch';
  }
  if (metaString(meta, 'user_id') !== expected.userId) {
    return 'payment_user_mismatch';
  }
  // club_id is optional on some historical sessions; when present it must match.
  const club = metaString(meta, 'club_id');
  if (club !== null && club !== expected.clubId) {
    return 'payment_club_mismatch';
  }
  return null;
}

function checkMoney(
  amountCents: unknown,
  currency: unknown,
  expected: ExpectedPaymentFacts,
): VerificationFailureCode | null {
  if (
    typeof currency !== 'string' ||
    currency.toLowerCase() !== expected.currency.toLowerCase()
  ) {
    return 'payment_currency_mismatch';
  }
  if (
    typeof amountCents !== 'number' ||
    !Number.isFinite(amountCents) ||
    !Number.isInteger(amountCents) ||
    // Neither underpayment nor overpayment is accepted: the recorded amount is
    // always the stored event price, so a mismatch means the object does not
    // belong to this purchase.
    amountCents !== expected.amountCents
  ) {
    return 'payment_amount_mismatch';
  }
  return null;
}

/** Verify a Stripe PaymentIntent that was retrieved server-side. */
export function verifyStripePaymentIntent(
  intent: unknown,
  expected: ExpectedPaymentFacts,
): VerificationResult {
  if (!intent || typeof intent !== 'object') {
    return { ok: false, code: 'payment_not_found' };
  }
  const pi = intent as Record<string, any>;
  if (pi.status !== 'succeeded') {
    return { ok: false, code: 'payment_not_completed' };
  }
  const charges: any[] = Array.isArray(pi.charges?.data) ? pi.charges.data : [];
  const refunded =
    pi.refunded === true ||
    (typeof pi.amount_refunded === 'number' && pi.amount_refunded > 0) ||
    charges.some((c) => c?.refunded === true || (c?.amount_refunded ?? 0) > 0);
  if (refunded) {
    return { ok: false, code: 'payment_refunded' };
  }

  const received =
    typeof pi.amount_received === 'number' ? pi.amount_received : pi.amount;
  const moneyFailure = checkMoney(received, pi.currency, expected);
  if (moneyFailure) return { ok: false, code: moneyFailure };

  const identityFailure = checkIdentity(readMetadata(pi), expected);
  if (identityFailure) return { ok: false, code: identityFailure };

  return { ok: true, amountCents: received, currency: String(pi.currency).toLowerCase() };
}

/** Verify a Stripe Checkout Session that was retrieved server-side. */
export function verifyStripeCheckoutSession(
  session: unknown,
  expected: ExpectedPaymentFacts,
): VerificationResult {
  if (!session || typeof session !== 'object') {
    return { ok: false, code: 'payment_not_found' };
  }
  const cs = session as Record<string, any>;
  if (cs.status === 'expired' || cs.status === 'open') {
    return { ok: false, code: 'payment_not_completed' };
  }
  if (cs.status !== 'complete' || cs.payment_status !== 'paid') {
    return { ok: false, code: 'payment_not_completed' };
  }

  const moneyFailure = checkMoney(cs.amount_total, cs.currency, expected);
  if (moneyFailure) return { ok: false, code: moneyFailure };

  const identityFailure = checkIdentity(readMetadata(cs), expected);
  if (identityFailure) return { ok: false, code: identityFailure };

  return {
    ok: true,
    amountCents: cs.amount_total,
    currency: String(cs.currency).toLowerCase(),
  };
}

/**
 * Verify a `member_payments` row fetched from the Ignite payments project.
 *
 * That project owns the Stripe session for member/event checkouts; the row is
 * only flipped to `paid` by its own Stripe webhook, so it is an authoritative
 * provider record for our purposes.
 */
export function verifyMemberPaymentRecord(
  record: unknown,
  expected: ExpectedPaymentFacts,
): VerificationResult {
  if (!record || typeof record !== 'object') {
    return { ok: false, code: 'payment_not_found' };
  }
  const row = record as Record<string, any>;

  if (row.refunded === true || row.status === 'refunded') {
    return { ok: false, code: 'payment_refunded' };
  }
  if (row.status !== 'paid') {
    return { ok: false, code: 'payment_not_completed' };
  }

  const amountCents =
    typeof row.amount_cents === 'number' ? row.amount_cents : row.amount;
  const moneyFailure = checkMoney(amountCents, row.currency, expected);
  if (moneyFailure) return { ok: false, code: moneyFailure };

  const identityFailure = checkIdentity(row, expected);
  if (identityFailure) return { ok: false, code: identityFailure };

  return { ok: true, amountCents, currency: String(row.currency).toLowerCase() };
}

/** Amount in cents that the event price authorises, or null when unpayable. */
export function authoritativeEventAmountCents(price: unknown): number | null {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  return Math.round(price * 100);
}
