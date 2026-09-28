import { describe, expect, it } from 'vitest';

type SecretRecord = {
  userId: string;
  scope: string;
  value: string;
  expiresAt: number;
};

function readVaultSecret(cache: Map<string, SecretRecord>, userId: string, scope: string) {
  const entry = cache.get(`${userId}:${scope}`);
  if (!entry) {
    return { ok: false, reason: 'missing' } as const;
  }
  if (Date.now() > entry.expiresAt) {
    return { ok: false, reason: 'expired' } as const;
  }
  return { ok: true, value: entry.value } as const;
}

describe('vault cache contract guard', () => {
  it('keeps secrets scoped to the owner and expiry window, with stale or foreign scope keys rejected', () => {
    const cache = new Map<string, SecretRecord>();
    cache.set('user-1:club-1', {
      userId: 'user-1',
      scope: 'club-1',
      value: 'secret-token',
      expiresAt: Date.now() + 60000,
    });

    expect(readVaultSecret(cache, 'user-1', 'club-1')).toEqual({ ok: true, value: 'secret-token' });
    expect(readVaultSecret(cache, 'user-2', 'club-1')).toEqual({ ok: false, reason: 'missing' });
    cache.set('user-1:club-1', {
      userId: 'user-1',
      scope: 'club-1',
      value: 'stale-token',
      expiresAt: Date.now() - 1,
    });
    expect(readVaultSecret(cache, 'user-1', 'club-1')).toEqual({ ok: false, reason: 'expired' });
  });
});
