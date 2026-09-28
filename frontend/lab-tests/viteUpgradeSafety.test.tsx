import { describe, expect, it } from 'vitest';

type ViteConfig = { host: string; port: number; allowedHosts: string[] };

function evaluateViteUpgradeSafety(config: ViteConfig) {
  if (config.host === '0.0.0.0' || config.host === '*') {
    return { ok: false, reason: 'public-host-exposed' } as const;
  }
  if (!config.allowedHosts.includes('127.0.0.1')) {
    return { ok: false, reason: 'missing-local-host' } as const;
  }
  return { ok: true } as const;
}

describe('vite upgrade safety', () => {
  it('requires local-only host binding and an allowlist that includes the local development host', () => {
    expect(evaluateViteUpgradeSafety({ host: '0.0.0.0', port: 5180, allowedHosts: ['127.0.0.1'] })).toEqual({ ok: false, reason: 'public-host-exposed' });
    expect(evaluateViteUpgradeSafety({ host: '127.0.0.1', port: 5180, allowedHosts: ['127.0.0.1'] })).toEqual({ ok: true });
  });
});
