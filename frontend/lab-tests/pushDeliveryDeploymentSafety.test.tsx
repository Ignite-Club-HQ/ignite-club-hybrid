import { describe, expect, it } from 'vitest';

type PushDeliveryConfig = {
  provider: 'local-loopback-double' | string;
  deviceToken: string | null;
  nativeSigningConfigured: boolean;
  productionCredential: string | null;
};

function evaluatePushDeliverySafety(config: PushDeliveryConfig) {
  if (config.provider !== 'local-loopback-double') {
    return { ok: false, reason: 'non-local-provider' } as const;
  }
  if (config.nativeSigningConfigured) {
    return { ok: false, reason: 'native-signing-not-permitted' } as const;
  }
  if (config.productionCredential) {
    return { ok: false, reason: 'production-credential-not-permitted' } as const;
  }
  if (config.deviceToken && !config.deviceToken.startsWith('synthetic-')) {
    return { ok: false, reason: 'non-synthetic-device-token' } as const;
  }
  return { ok: true } as const;
}

describe('push delivery deployment safety', () => {
  it('rejects native signing configuration, production credentials, and non-local providers', () => {
    expect(evaluatePushDeliverySafety({
      provider: 'apns-production',
      deviceToken: null,
      nativeSigningConfigured: false,
      productionCredential: null,
    })).toEqual({ ok: false, reason: 'non-local-provider' });

    expect(evaluatePushDeliverySafety({
      provider: 'local-loopback-double',
      deviceToken: null,
      nativeSigningConfigured: true,
      productionCredential: null,
    })).toEqual({ ok: false, reason: 'native-signing-not-permitted' });

    expect(evaluatePushDeliverySafety({
      provider: 'local-loopback-double',
      deviceToken: null,
      nativeSigningConfigured: false,
      productionCredential: 'fcm-live-key',
    })).toEqual({ ok: false, reason: 'production-credential-not-permitted' });
  });

  it('rejects a non-synthetic device token and accepts a fully synthetic local configuration', () => {
    expect(evaluatePushDeliverySafety({
      provider: 'local-loopback-double',
      deviceToken: 'real-device-abc123',
      nativeSigningConfigured: false,
      productionCredential: null,
    })).toEqual({ ok: false, reason: 'non-synthetic-device-token' });

    expect(evaluatePushDeliverySafety({
      provider: 'local-loopback-double',
      deviceToken: 'synthetic-device-1',
      nativeSigningConfigured: false,
      productionCredential: null,
    })).toEqual({ ok: true });
  });
});
