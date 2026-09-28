import { describe, expect, test } from 'vitest';
import {
  LOCAL_EDGE_MANIFEST,
  createAccountRecoveryDouble,
  createEngagementReminderQueueDouble,
  createIapReceiptVerificationDouble,
  createPaymentVerificationDouble,
  createPendingSubscriptionRecipientDouble,
  renderEventViewReminderEmail,
  validateLocalEdgeManifest,
} from '../src/lab/edgeOrientedLocalDoubles';

describe('local Edge-oriented candidate doubles', () => {
  test('checkPendingSubs.recipients scopes pending recipients to the owner and club', () => {
    const recipients = createPendingSubscriptionRecipientDouble([
      { subscriptionId: 's-1', ownerId: 'owner-a', clubId: 'club-a', email: 'A@example.test', status: 'pending' },
      { subscriptionId: 's-2', ownerId: 'owner-a', clubId: 'club-a', email: 'a@example.test', status: 'pending' },
      { subscriptionId: 's-3', ownerId: 'owner-b', clubId: 'club-a', email: 'other@example.test', status: 'pending' },
      { subscriptionId: 's-4', ownerId: 'owner-a', clubId: 'club-b', email: 'other-club@example.test', status: 'pending' },
      { subscriptionId: 's-5', ownerId: 'owner-a', clubId: 'club-a', email: 'active@example.test', status: 'active' },
    ]);

    expect(recipients.recipients({ ownerId: 'owner-a', clubId: 'club-a' }))
      .toEqual(['a@example.test']);
    expect(recipients.recipients({ ownerId: 'owner-b', clubId: 'club-a' }))
      .toEqual(['other@example.test']);
  });

  test('edgeFunctionEstateValidation inventories only deployable local routes', () => {
    const result = validateLocalEdgeManifest();

    expect(result.deployable).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.routes).toHaveLength(7);
    expect(LOCAL_EDGE_MANIFEST.map((entry) => entry.candidate)).toEqual(expect.arrayContaining([
      'checkPendingSubs.recipients',
      'edgeFunctionEstateValidation',
      'eventViewReminderEmail',
      'paymentEdgeFunctions.security',
      'recoverAccount',
      'sendEngagementReminders.accuracy',
      'verifyIapReceipt.security',
    ]));
  });

  test('estate validation fails closed for a duplicate or non-local route', () => {
    const result = validateLocalEdgeManifest([
      ...LOCAL_EDGE_MANIFEST,
      { ...LOCAL_EDGE_MANIFEST[0], route: '/remote/not-local', deployable: false },
    ]);

    expect(result.deployable).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'checkPendingSubs.recipients: route is not local',
      'checkPendingSubs.recipients: route is not deployable',
      'checkPendingSubs.recipients: duplicate candidate',
    ]));
  });

  test('eventViewReminderEmail escapes all interpolated email markup', () => {
    const html = renderEventViewReminderEmail({
      recipientName: '<img src=x onerror=alert(1)>',
      eventName: 'Dinner & <Friends>',
      eventUrl: 'https://local.test/events/1?name="quoted"',
    });

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Dinner &amp; &lt;Friends&gt;');
    expect(html).toContain('name=&quot;quoted&quot;');
    expect(html).not.toContain('<img');
    expect(() => renderEventViewReminderEmail({
      recipientName: 'Synthetic',
      eventName: 'Event',
      eventUrl: 'javascript:alert(1)',
    })).toThrow(/HTTP\(S\)/);
  });

  test('paymentEdgeFunctions.security verifies before atomically consuming a receipt', () => {
    const payment = createPaymentVerificationDouble((input) =>
      input.accountId === 'account-a' && input.productId === 'pro' && input.amountCents === 500);
    const valid = { receipt: 'payment-1', accountId: 'account-a', productId: 'pro', amountCents: 500 };

    expect(payment.verifyAndRecord(valid).status).toBe('accepted');
    expect(payment.verifyAndRecord({ ...valid, accountId: 'account-b' }).status).toBe('replay');
    expect(payment.verifyAndRecord({ ...valid, receipt: 'payment-invalid', amountCents: 1 }).status).toBe('rejected');
    expect(payment.consumed('payment-invalid')).toBe(false);
  });

  test('recoverAccount requires authorization and enforces a synthetic rate limit', () => {
    let now = 1_000;
    const recovery = createAccountRecoveryDouble({
      authorize: (request) => request.actorId === request.accountId && request.proof === 'proof-a',
      maxAttempts: 2,
      windowMs: 1_000,
      now: () => now,
    });

    expect(recovery.recover({ actorId: 'attacker', accountId: 'account-a', proof: 'proof-a' }).status)
      .toBe('unauthorized');
    expect(recovery.recover({ actorId: 'attacker', accountId: 'account-a', proof: 'proof-a' }).status)
      .toBe('unauthorized');
    expect(recovery.recover({ actorId: 'attacker', accountId: 'account-a', proof: 'proof-a' }).status)
      .toBe('rate-limited');
    expect(recovery.recover({ actorId: 'account-a', accountId: 'account-a', proof: 'proof-a' }).status)
      .toBe('recovered');

    now += 1_000;
    expect(recovery.recover({ actorId: 'account-a', accountId: 'account-a', proof: 'wrong' }).status)
      .toBe('unauthorized');
  });

  test('sendEngagementReminders.accuracy counts eligible jobs once per event and recipient', () => {
    const queue = createEngagementReminderQueueDouble();
    const candidates = [
      { eventId: 'event-a', recipientId: 'user-a', email: 'a@example.test', eligible: true },
      { eventId: 'event-a', recipientId: 'user-a', email: 'a@example.test', eligible: true },
      { eventId: 'event-a', recipientId: 'user-b', email: 'b@example.test', eligible: true },
      { eventId: 'event-a', recipientId: 'user-c', email: 'c@example.test', eligible: false },
    ];

    expect(queue.enqueue(candidates)).toEqual({ queuedCount: 2, totalCount: 2 });
    expect(queue.enqueue(candidates)).toEqual({ queuedCount: 0, totalCount: 2 });
    expect(queue.jobs().map((job) => job.idempotencyKey)).toEqual([
      'event-a:user-a',
      'event-a:user-b',
    ]);
  });

  test('verifyIapReceipt.security verifies product/platform and rejects receipt replay', () => {
    const iap = createIapReceiptVerificationDouble((input) =>
      input.accountId === 'account-a'
      && input.productId === 'pro'
      && input.platform === 'ios');
    const valid = { receipt: 'iap-1', accountId: 'account-a', productId: 'pro', platform: 'ios' as const };

    expect(iap.verifyAndRecord(valid).status).toBe('accepted');
    expect(iap.verifyAndRecord({ ...valid, accountId: 'account-b' }).status).toBe('replay');
    expect(iap.verifyAndRecord({ ...valid, receipt: 'iap-invalid', platform: 'android' }).status)
      .toBe('rejected');
  });
});
