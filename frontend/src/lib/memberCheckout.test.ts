/**
 * Regression tests pinning the memberCheckout client contract.
 *
 * Covers:
 *   Amount validation (defects 1) — invalid values never reach fetch.
 *   Subscription interval validation (defect 2).
 *   Server-side truth for platform fee (client-supplied values ignored).
 *   Idempotent realtime listener cleanup (defect 3).
 *   At-most-one terminal callback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Supabase client BEFORE importing the module under test so that
// listenForPaymentStatus binds to the mock, not the real websiteSupabase.
const removeChannelSpy = vi.fn();
let channelCallback: ((payload: any) => void) | null = null;

vi.mock('@supabase/supabase-js', () => {
  return {
    createClient: () => ({
      channel: (_name: string) => {
        const chan: any = {
          on: (_event: string, _filter: any, cb: (payload: any) => void) => {
            channelCallback = cb;
            return chan;
          },
          subscribe: () => chan,
        };
        return chan;
      },
      removeChannel: (...args: any[]) => removeChannelSpy(...args),
    }),
  };
});

import {
  createMemberCheckout,
  calculateIgnitePlatformFeeCents,
  listenForPaymentStatus,
  IGNITE_PLATFORM_FEE_PERCENT,
  MEMBER_CHECKOUT_MIN_CENTS,
  type MemberCheckoutParams,
} from './memberCheckout';

// --- fetch mock ---------------------------------------------------------
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  removeChannelSpy.mockReset();
  channelCallback = null;
  fetchMock.mockResolvedValue({
    json: async () => ({ url: 'https://reference.invalid', payment_id: 'pmt_1' }),
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function baseEvent(overrides: Partial<MemberCheckoutParams> = {}): MemberCheckoutParams {
  return {
    club_id: 'club-1',
    title: 'Match fee',
    amount_cents: 2500,
    type: 'event',
    ...overrides,
  };
}

// --- fee math -----------------------------------------------------------
describe('platform fee calculation', () => {
  it('computes 5% correctly for a whole-dollar amount', () => {
    // Test 2: 5% platform fee on $25 (2500 cents) = 125 cents
    expect(calculateIgnitePlatformFeeCents(2500)).toBe(125);
    expect(IGNITE_PLATFORM_FEE_PERCENT).toBe(0.05);
  });
  it('rounds fractional cent results deterministically', () => {
    // Test 3: 5% of 199 cents = 9.95 -> 10 (Math.round, stable)
    expect(calculateIgnitePlatformFeeCents(199)).toBe(10);
    expect(calculateIgnitePlatformFeeCents(101)).toBe(5);
  });
});

// --- createMemberCheckout: happy paths ---------------------------------
describe('createMemberCheckout — valid input', () => {
  it('Test 1: valid event checkout retains current defaults', async () => {
    await createMemberCheckout(baseEvent());
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.currency).toBe('aud');
    expect(body.success_url).toBe('igniteclubhq://payment-success');
    expect(body.cancel_url).toBe('igniteclubhq://payment-cancel');
    expect(body.platform_fee_cents).toBe(125);
    expect(body.metadata.platform_fee_cents).toBe('125');
  });

  it('Test 4: caller-supplied platform_fee_cents cannot override the calculation', async () => {
    await createMemberCheckout(
      baseEvent({ platform_fee_cents: 1 as any, metadata: { platform_fee_cents: '1' } }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.platform_fee_cents).toBe(125);
    expect(body.metadata.platform_fee_cents).toBe('125');
  });

  it('Tests 11 & 13: weekly, monthly and yearly subscriptions are accepted', async () => {
    for (const interval of ['week', 'month', 'year'] as const) {
      fetchMock.mockClear();
      await createMemberCheckout(
        baseEvent({ type: 'subscription', interval, amount_cents: 500 }),
      );
      const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
      expect(body.interval).toBe(interval);
      expect(body.type).toBe('subscription');
    }
  });

  it('Test 14: event payments cannot contain recurring subscription parameters', async () => {
    await createMemberCheckout(
      baseEvent({ interval: 'month' as any }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.interval).toBeUndefined();
  });
});

// --- amount validation --------------------------------------------------
describe('createMemberCheckout — amount validation rejects before fetch', () => {
  const cases: Array<[string, number]> = [
    ['Test 5: zero amount', 0],
    ['Test 6: amount below 50 cents', MEMBER_CHECKOUT_MIN_CENTS - 1],
    ['Test 7: negative amount', -500],
    ['Test 8: NaN', Number.NaN],
    ['Test 9a: positive Infinity', Number.POSITIVE_INFINITY],
    ['Test 9b: negative Infinity', Number.NEGATIVE_INFINITY],
    ['Test 10: non-integer cents', 250.5],
  ];
  for (const [label, amount] of cases) {
    it(`${label} is rejected and fetch is never called`, async () => {
      await expect(
        createMemberCheckout(baseEvent({ amount_cents: amount })),
      ).rejects.toThrow(/Invalid checkout amount/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }
});

// --- subscription interval validation ----------------------------------
describe('createMemberCheckout — subscription interval validation', () => {
  it('Test 11: subscription without interval is rejected', async () => {
    await expect(
      createMemberCheckout(baseEvent({ type: 'subscription' })),
    ).rejects.toThrow(/Invalid subscription interval/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('Test 12: subscription with an invalid interval is rejected', async () => {
    await expect(
      createMemberCheckout(
        baseEvent({ type: 'subscription', interval: 'day' as any }),
      ),
    ).rejects.toThrow(/Invalid subscription interval/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// --- listenForPaymentStatus --------------------------------------------
describe('listenForPaymentStatus — realtime lifecycle', () => {
  it('Test 16: paid status triggers exactly one callback and one cleanup', () => {
    const cb = vi.fn();
    listenForPaymentStatus('pmt_1', cb);
    channelCallback!({ new: { status: 'paid' } });
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith('paid', { status: 'paid' });
    expect(removeChannelSpy).toHaveBeenCalledOnce();
  });

  it('Test 17: failed status triggers exactly one callback and one cleanup', () => {
    const cb = vi.fn();
    listenForPaymentStatus('pmt_1', cb);
    channelCallback!({ new: { status: 'failed' } });
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith('failed', { status: 'failed' });
    expect(removeChannelSpy).toHaveBeenCalledOnce();
  });

  it('Test 18: non-terminal updates do not complete the listener', () => {
    const cb = vi.fn();
    listenForPaymentStatus('pmt_1', cb);
    channelCallback!({ new: { status: 'pending' } });
    channelCallback!({ new: { status: 'processing' } });
    expect(cb).not.toHaveBeenCalled();
    expect(removeChannelSpy).not.toHaveBeenCalled();
  });

  it('Test 19: timeout removes the channel without reporting a false status', () => {
    const cb = vi.fn();
    listenForPaymentStatus('pmt_1', cb, 1000);
    vi.advanceTimersByTime(1000);
    expect(cb).not.toHaveBeenCalled();
    expect(removeChannelSpy).toHaveBeenCalledOnce();
  });

  it('Test 20: manual cleanup removes the channel exactly once even when called repeatedly', () => {
    const cb = vi.fn();
    const cleanup = listenForPaymentStatus('pmt_1', cb);
    cleanup();
    cleanup();
    cleanup();
    expect(removeChannelSpy).toHaveBeenCalledOnce();
  });

  it('Test 21: cleanup racing with a terminal update removes the channel once and does not fire a stale callback', () => {
    const cb = vi.fn();
    const cleanup = listenForPaymentStatus('pmt_1', cb);
    cleanup();
    // Realtime terminal update arrives AFTER manual cleanup (navigation).
    channelCallback!({ new: { status: 'paid' } });
    expect(cb).not.toHaveBeenCalled();
    expect(removeChannelSpy).toHaveBeenCalledOnce();
  });

  it('Test 22: repeated terminal updates cannot invoke the callback twice', () => {
    const cb = vi.fn();
    listenForPaymentStatus('pmt_1', cb);
    channelCallback!({ new: { status: 'paid' } });
    channelCallback!({ new: { status: 'paid' } });
    channelCallback!({ new: { status: 'failed' } });
    expect(cb).toHaveBeenCalledOnce();
    expect(removeChannelSpy).toHaveBeenCalledOnce();
  });

  it('preserves the default 10-minute timeout when not overridden', () => {
    const cb = vi.fn();
    listenForPaymentStatus('pmt_1', cb);
    // Just under 10 minutes — still active.
    vi.advanceTimersByTime(10 * 60 * 1000 - 1);
    expect(removeChannelSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(removeChannelSpy).toHaveBeenCalledOnce();
  });
});
