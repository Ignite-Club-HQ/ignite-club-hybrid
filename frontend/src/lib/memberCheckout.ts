import { createClient } from '@supabase/supabase-js';

// Second Supabase client pointing to the Ignite website project
// Used for Realtime listening on member_payments table
const WEBSITE_SUPABASE_URL = 'https://frkzyniekamxudaumeaf.supabase.co';
const WEBSITE_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZya3p5bmlla2FteHVkYXVtZWFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4OTc3MzQsImV4cCI6MjA4MzQ3MzczNH0.vNm-imUjO7kfcPNDf0JPSg9zzN5_AV-dkMXBgriWVyo';

export const websiteSupabase = createClient(WEBSITE_SUPABASE_URL, WEBSITE_SUPABASE_ANON_KEY);

export const IGNITE_PLATFORM_FEE_PERCENT = 0.05; // 5%
export const MEMBER_CHECKOUT_MIN_CENTS = 50; // Stripe / edge-fn documented minimum

const VALID_INTERVALS = ['week', 'month', 'year'] as const;
type SubscriptionInterval = typeof VALID_INTERVALS[number];

export interface MemberCheckoutParams {
  club_id: string;
  title: string;
  amount_cents: number; // e.g. 2500 = $25.00, minimum 50
  type: 'event' | 'subscription';
  currency?: string; // defaults to 'aud'
  payer_email?: string;
  payer_name?: string;
  description?: string;
  interval?: SubscriptionInterval; // required when type='subscription'
  success_url?: string;
  cancel_url?: string;
  metadata?: Record<string, string>;
  platform_fee_cents?: number; // Ignite platform fee (5%) — always recalculated server & client
}

export interface MemberCheckoutResponse {
  url: string;
  payment_id: string;
  error?: string;
}

/**
 * Compute the Ignite platform fee for a given (validated) amount.
 * Rounded deterministically with Math.round for cross-run stability.
 */
export function calculateIgnitePlatformFeeCents(amountCents: number): number {
  return Math.round(amountCents * IGNITE_PLATFORM_FEE_PERCENT);
}

/**
 * Validate a caller-supplied `amount_cents` before it is ever sent to the
 * checkout endpoint. Rejects the full class of unsafe values:
 *   - non-finite (NaN, ±Infinity) — JSON serialises these as `null`
 *   - non-integer cents (fractional/pseudo-integer)
 *   - values below Stripe's minimum charge (50 cents)
 *   - zero and negative values
 */
function validateAmountCents(amountCents: unknown): asserts amountCents is number {
  if (typeof amountCents !== 'number' || !Number.isFinite(amountCents)) {
    throw new Error(
      `Invalid checkout amount: expected a finite number of cents, received ${String(amountCents)}`,
    );
  }
  if (!Number.isInteger(amountCents)) {
    throw new Error(
      `Invalid checkout amount: ${amountCents} cents is not an integer`,
    );
  }
  if (amountCents < MEMBER_CHECKOUT_MIN_CENTS) {
    throw new Error(
      `Invalid checkout amount: ${amountCents} cents is below the ${MEMBER_CHECKOUT_MIN_CENTS} cent minimum`,
    );
  }
}

/**
 * Call the website project's edge function to create a Stripe Checkout session.
 * No auth token needed — the edge function is public and validates via club config.
 *
 * Client-side validation is defense-in-depth only; the edge function must
 * independently re-validate every field (see spec section "DEFENCE IN DEPTH").
 */
export async function createMemberCheckout(
  params: MemberCheckoutParams
): Promise<MemberCheckoutResponse> {
  // 1) Amount validation — must run BEFORE fetch so no bad value ever leaves the client.
  validateAmountCents(params.amount_cents);

  // 2) Type-specific validation.
  if (params.type === 'subscription') {
    if (!params.interval || !VALID_INTERVALS.includes(params.interval)) {
      throw new Error(
        `Invalid subscription interval: expected one of ${VALID_INTERVALS.join(', ')}, received ${String(params.interval)}`,
      );
    }
  }

  // 3) Recompute platform fee from the validated amount. We deliberately
  // ignore any caller-supplied `platform_fee_cents` so a compromised UI
  // can't lower our take.
  const platformFeeCents = calculateIgnitePlatformFeeCents(params.amount_cents);

  // 4) Build the outgoing body. For events, strip `interval` so the request
  // is unambiguous ("event" checkouts must never accidentally recur).
  const outgoing: MemberCheckoutParams = {
    ...params,
    currency: params.currency ?? 'aud',
    success_url: params.success_url ?? 'igniteclubhq://payment-success',
    cancel_url: params.cancel_url ?? 'igniteclubhq://payment-cancel',
    platform_fee_cents: platformFeeCents,
    metadata: {
      ...params.metadata,
      platform_fee_cents: platformFeeCents.toString(),
    },
  };
  if (outgoing.type === 'event') {
    delete outgoing.interval;
  }

  const res = await fetch(
    `${WEBSITE_SUPABASE_URL}/functions/v1/create-member-checkout`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(outgoing),
    }
  );

  return res.json();
}

/**
 * Subscribe to Realtime changes on a member_payments row.
 * Resolves when payment status becomes 'paid' or 'failed'.
 *
 * Guarantees (see spec CONFIRMED DEFECT 3):
 *   - Cleanup is idempotent: removeChannel and clearTimeout run at most once,
 *     regardless of how many times the returned function is invoked (manual
 *     cleanup on unmount + realtime terminal callback + timeout can all race).
 *   - The status callback fires at most once. Repeated 'paid' / 'failed'
 *     updates after the first terminal result are dropped.
 *   - Realtime callbacks arriving after cleanup are ignored.
 *   - Timeout fires cleanup but does NOT invoke onStatusChange with a false
 *     'failed'/'paid' status.
 */
export function listenForPaymentStatus(
  paymentId: string,
  onStatusChange: (status: 'paid' | 'failed', payload: any) => void,
  timeoutMs = 10 * 60 * 1000 // 10 minutes default
): () => void {
  let cleanedUp = false;
  let callbackFired = false;

  const channel = websiteSupabase
    .channel(`payment-${paymentId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'member_payments',
        filter: `id=eq.${paymentId}`,
      },
      (payload) => {
        // Drop callbacks that arrive after cleanup (channel already removed,
        // or a redundant terminal update raced with our own cleanup call).
        if (cleanedUp || callbackFired) return;
        const status = (payload.new as any)?.status;
        if (status === 'paid' || status === 'failed') {
          callbackFired = true;
          try {
            onStatusChange(status, payload.new);
          } finally {
            cleanup();
          }
        }
      }
    )
    .subscribe();

  const timer = setTimeout(() => {
    // Timeout: tear down the listener silently. Do NOT fabricate a terminal
    // status — callers observe timeout via absence of the callback.
    cleanup();
  }, timeoutMs);

  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(timer);
    try {
      websiteSupabase.removeChannel(channel);
    } catch {
      // Swallow: removeChannel on an already-removed channel must not throw
      // out of a user-triggered cleanup.
    }
  }

  return cleanup;
}
