// The second production Supabase client is also disabled.
export { supabase as websiteSupabase } from '@/integrations/supabase/client';

export interface MemberCheckoutParams {
  club_id: string;
  title: string;
  amount_cents: number;
  type: 'event' | 'subscription';
  interval?: 'week' | 'month' | 'year';
  payer_email?: string;
  description?: string;
  success_url?: string;
  cancel_url?: string;
  metadata?: Record<string, string>;
  platform_fee_cents?: number;
}

export const IGNITE_PLATFORM_FEE_PERCENT = 0.05;
export const MEMBER_CHECKOUT_MIN_CENTS = 50;

export function calculateIgnitePlatformFeeCents(amountCents: number): number {
  return Math.round(amountCents * IGNITE_PLATFORM_FEE_PERCENT);
}

export interface MemberCheckoutResult {
  url?: string;
  payment_id: string;
  error?: string;
}

export const createMemberCheckout = async (
  _params: MemberCheckoutParams,
): Promise<MemberCheckoutResult> => {
  throw new Error('Checkout is not enabled in the lab');
};
export const listenForPaymentStatus = (
  _paymentId: string,
  _onStatus: (status: string) => void,
  _timeoutMs?: number,
): (() => void) => { throw new Error('Payment status updates are not enabled in the lab'); };
