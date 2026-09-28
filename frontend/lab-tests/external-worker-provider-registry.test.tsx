import { describe, expect, test } from 'vitest';
import { createExternalWorkerProviderRegistry, createPaymentGatewayProvider } from '../src/lab/externalWorkerProviders';

describe('External worker provider registry', () => {
  test('email and push providers enforce matching scopes', async () => {
    const registry = createExternalWorkerProviderRegistry({
      allowedScopes: {
        'worker-email': ['send-email-notification'],
        'worker-push': ['send-push-notification'],
      },
      verifySecretAccess: async (_principal, scope) => ({
        approved: scope === 'send-email-notification' || scope === 'send-push-notification',
        reason: 'authorized',
        timestamp: 1000n,
      }),
      audit: async () => ({ approved: true, reason: 'authorized', timestamp: 1000n }),
    });

    const emailResult = await registry.email.sendEmail('worker-email', {
      messageId: 'm1',
      body: 'hello',
      subject: 'Subject',
      idempotencyKey: 'k1',
    });
    expect(emailResult.approved).toBe(true);

    const pushResult = await registry.push.sendPush('worker-push', {
      messageId: 'm2',
      body: 'hello',
      idempotencyKey: 'k2',
    });
    expect(pushResult.approved).toBe(true);

    const wrongScope = await registry.email.sendEmail('worker-push', {
      messageId: 'm3',
      body: 'hello',
      subject: 'Subject',
      idempotencyKey: 'k3',
    });
    expect(wrongScope.approved).toBe(false);
  });

  test('payment provider requires the payment-processor scope and validates signed webhook secret', async () => {
    const payment = createPaymentGatewayProvider({
      allowedScopes: {
        'worker-payment': ['payment-processor'],
      },
      verifySecretAccess: async (_principal, scope) => ({
        approved: scope === 'payment-processor',
        reason: scope === 'payment-processor' ? 'authorized' : 'bad scope',
        timestamp: 1000n,
      }),
      audit: async () => ({ approved: true, reason: 'authorized', timestamp: 1000n }),
      stripeSecretKey: 'sk_test_123',
      webhookSecret: 'whsec_test_123',
    });

    const session = await payment.createCheckoutSession('worker-payment', {
      id: 'session-1',
      amountCents: 5000,
      currency: 'USD',
      idempotencyKey: 'pay-k1',
    });
    expect(session.approved).toBe(true);
    expect(session.sessionId).toMatch(/session-/);

    const signed = payment.verifyWebhookSignature('worker-payment', 't=123,v1=whsec_test_123', '{"id":"evt_1"}', 123);
    await expect(signed).resolves.toMatchObject({ approved: true });

    const badSig = payment.verifyWebhookSignature('worker-payment', 't=123,v1=bad-secret', '{"id":"evt_1"}', 123);
    await expect(badSig).resolves.toMatchObject({ approved: false });
  });
});
