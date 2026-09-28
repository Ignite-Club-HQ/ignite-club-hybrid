import { describe, expect, it } from 'vitest';

type AcceptanceRecord = {
  userId: string;
  version: number;
  acceptedAt: number;
};

function requiresReacceptance(record: AcceptanceRecord | null, currentVersion: number, now: number) {
  if (!record) {
    return { ok: true, reason: 'missing-record' } as const;
  }
  if (record.version !== currentVersion) {
    return { ok: true, reason: 'outdated-terms' } as const;
  }
  if (now - record.acceptedAt < 0) {
    return { ok: false, reason: 'clock-skew' } as const;
  }
  return { ok: false, reason: 'accepted' } as const;
}

describe('legal reacceptance security guard', () => {
  it('forces acceptance of current policy form and flags stale acceptance records', () => {
    expect(requiresReacceptance(null, 2, Date.now())).toEqual({ ok: true, reason: 'missing-record' });
    expect(requiresReacceptance({ userId: 'u-1', version: 1, acceptedAt: Date.now() }, 2, Date.now())).toEqual({ ok: true, reason: 'outdated-terms' });
    expect(requiresReacceptance({ userId: 'u-1', version: 2, acceptedAt: Date.now() }, 2, Date.now())).toEqual({ ok: false, reason: 'accepted' });
  });
});
