import { describe, expect, test } from 'vitest';
import { createWorkerSecretVault } from '../src/lab/workerSecretVault';

describe('Worker secret vault', () => {
  test('allows access only for pre-registered scoped workers', () => {
    const vault = createWorkerSecretVault({
      allowedScopes: {
        'email-worker': ['send-email-notification'],
        'push-worker': ['send-push-notification'],
      },
      secrets: {
        'email-worker': { RESEND_API_KEY: 're_test_email_key' },
        'push-worker': { FCM_SERVICE_ACCOUNT: '{\"project_id\":\"synthetic\"}' },
      },
    });

    const emailAccess = vault.accessSecret('email-worker', 'send-email-notification', 'RESEND_API_KEY');
    expect(emailAccess.approved).toBe(true);
    expect(emailAccess.value).toBe('re_test_email_key');

    const badScope = vault.accessSecret('email-worker', 'send-push-notification', 'FCM_SERVICE_ACCOUNT');
    expect(badScope.approved).toBe(false);

    const wrongSecret = vault.accessSecret('push-worker', 'send-push-notification', 'RESEND_API_KEY');
    expect(wrongSecret.approved).toBe(false);
  });

  test('blocks unregistered or revoked workers from retrieving secrets', () => {
    const vault = createWorkerSecretVault({
      allowedScopes: {
        'revoked-worker': ['send-email-notification'],
      },
      secrets: {
        'revoked-worker': { RESEND_API_KEY: 're_revoked' },
      },
    });

    const revoked = vault.accessSecret('revoked-worker', 'send-push-notification', 'RESEND_API_KEY');
    expect(revoked.approved).toBe(false);

    const unknown = vault.accessSecret('unknown-worker', 'send-email-notification', 'RESEND_API_KEY');
    expect(unknown.approved).toBe(false);
  });
});
