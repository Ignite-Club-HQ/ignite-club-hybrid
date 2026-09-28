import { describe, expect, test } from 'vitest';
import { createExternalWorkerBoundary, canClaimScope, createProviderScopedDeliveryBoundary } from '../src/lab/externalWorkerBoundary';

describe('External Worker Secret Boundary', () => {
  test('allows an email worker to claim email scope when it is authorized', () => {
    const result = canClaimScope(
      ['send-email-notification', 'write-audit-log'],
      'send-email-notification'
    );

    expect(result.approved).toBe(true);
    expect(result.reason).toMatch(/authorized/i);
  });

  test('denies a push worker when it requests the wrong delivery scope', () => {
    const result = canClaimScope(
      ['send-push-notification'],
      'send-email-notification'
    );

    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/not authorized/i);
  });

  test('fails closed when the workload is revoked or unattested', async () => {
    const boundary = createExternalWorkerBoundary({
      allowedScopes: { 'worker-1': ['send-email-notification'] },
      verifySecretAccess: async () => ({ approved: false, reason: 'workload revoked or not attested', timestamp: 1000n }),
      audit: async () => ({ approved: false, reason: 'workload revoked or not attested', timestamp: 1000n }),
    });

    await expect(
      boundary.authorizeSecret('worker-1', 'send-email-notification', 'nonce-1')
    ).resolves.toMatchObject({ approved: false });
  });

  test('requires both scope and attestation before a queue claim succeeds', async () => {
    const boundary = createExternalWorkerBoundary({
      allowedScopes: {
        'worker-email': ['send-email-notification'],
      },
      verifySecretAccess: async (_principal, scope) => ({
        approved: scope === 'send-email-notification',
        reason: scope === 'send-email-notification' ? 'authorized' : 'not authorized for this scope',
        timestamp: 1000n,
      }),
      audit: async () => ({ approved: true, reason: 'authorized', timestamp: 1000n }),
    });

    await expect(
      boundary.claimQueue('worker-email', 'send-email-notification', 'email')
    ).resolves.toMatchObject({ approved: true });

    await expect(
      boundary.claimQueue('worker-email', 'send-push-notification', 'email')
    ).resolves.toMatchObject({ approved: false });
  });

  test('provider-scoped boundary only accepts the matching delivery scope', async () => {
    const boundary = createProviderScopedDeliveryBoundary({
      allowedScopes: {
        'worker-email': ['send-email-notification'],
        'worker-push': ['send-push-notification'],
        'worker-audit': ['write-audit-log'],
      },
      verifySecretAccess: async (_principal, scope) => ({
        approved: scope === 'send-email-notification' || scope === 'send-push-notification' || scope === 'write-audit-log',
        reason: 'authorized',
        timestamp: 1000n,
      }),
      audit: async () => ({ approved: true, reason: 'authorized', timestamp: 1000n }),
    });

    await expect(
      boundary.claimEmailQueue('worker-email', 'email')
    ).resolves.toMatchObject({ approved: true, queueDomain: 'email' });

    await expect(
      boundary.claimPushQueue('worker-email', 'email')
    ).resolves.toMatchObject({ approved: false, queueDomain: 'email' });

    await expect(
      boundary.claimPushQueue('worker-push', 'push')
    ).resolves.toMatchObject({ approved: true, queueDomain: 'push' });

    await expect(
      boundary.authorizeAuditWrite('worker-audit', 'audit-nonce-1')
    ).resolves.toMatchObject({ approved: true });

    await expect(
      boundary.authorizeAuditWrite('worker-push', 'audit-nonce-2')
    ).resolves.toMatchObject({ approved: false });
  });
});
