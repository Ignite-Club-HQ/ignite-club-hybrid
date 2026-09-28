/**
 * Local port of `supabase/functions/send-renewal-reminders/classify.ts`
 * (see reference/backend/supabase/functions/send-renewal-reminders/classify.ts.md).
 *
 * Renewal-reminder subscription classification. Promo/trial-granted
 * subscriptions have no payment instrument attached, so the standard "your
 * subscription will renew / manage billing" reminder is misleading for them.
 * They are partitioned out and either skipped (default) or sent a dedicated
 * promo-expiry variant when PROMO_REMINDER_ENABLED=true.
 */

export type RenewalClass = 'paying' | 'promo_granted';

export interface ClubSubLike {
  stripe_subscription_id: string | null;
  promo_code_id: string | null;
}

export interface TeamSubLike {
  stripe_subscription_id: string | null;
}

/** Club subs: promo-granted = promo code set AND no Stripe subscription. */
export function classifyClubSubscription(sub: ClubSubLike): RenewalClass {
  if (sub.promo_code_id != null && sub.stripe_subscription_id == null) {
    return 'promo_granted';
  }
  return 'paying';
}

/**
 * Team subs: paying = Stripe-backed or IAP-linked. Anything with no Stripe
 * subscription and no live IAP transaction is treated as promo/trial-granted.
 */
export function classifyTeamSubscription(
  sub: TeamSubLike,
  hasLiveIapTransaction: boolean,
): RenewalClass {
  if (sub.stripe_subscription_id == null && !hasLiveIapTransaction) {
    return 'promo_granted';
  }
  return 'paying';
}

/** Feature flag: promo expiry variant emails are opt-in, default OFF. */
export function isPromoReminderEnabled(getEnv: (key: string) => string | undefined): boolean {
  return getEnv('PROMO_REMINDER_ENABLED') === 'true';
}
