/**
 * External Worker Delivery Providers
 * Fail-closed, scoped delivery paths for email, push, and audit/secret logging
 * 
 * These providers integrate with the external worker boundary to:
 * 1. Validate workload principal has required scope
 * 2. Enforce nonce-based idempotency
 * 3. Log all access attempts to audit trail
 * 4. Fail-closed if scope mismatch or revocation detected
 */

import {
  createProviderScopedDeliveryBoundary,
  type SecretAccessVerifier,
  type SecretAuditLogger,
} from './externalWorkerBoundary';

export interface DeliveryMessage {
  messageId: string;
  recipientEmail?: string;
  recipientDeviceTokens?: string[];
  subject?: string;
  body: string;
  templateId?: string;
  variables?: Record<string, unknown>;
  idempotencyKey: string;
  timestamp: bigint;
}

export interface AuditLogEntry {
  workloadPrincipal: string;
  scope: string;
  action: string;
  approved: boolean;
  reason: string;
  nonce: string;
  timestamp: bigint;
}

/**
 * Email Delivery Provider
 * Handles sending notifications via Resend API
 * Only workers with 'send-email-notification' scope can use this
 */
export function createEmailDeliveryProvider(options: {
  apiKey?: string;
  allowedScopes?: Record<string, string[]>;
  verifySecretAccess?: SecretAccessVerifier;
  audit?: SecretAuditLogger;
  simulateDelay?: number;
} = {}) {
  const boundary = createProviderScopedDeliveryBoundary(options);
  const apiKey = options.apiKey || 'test-resend-key';
  const simulateDelay = options.simulateDelay || 50; // ms
  const sentMessages: DeliveryMessage[] = [];

  return {
    async sendEmail(
      workloadPrincipal: unknown,
      message: DeliveryMessage
    ): Promise<{ approved: boolean; messageId?: string; reason: string; timestamp: bigint }> {
      // First claim the email queue to verify authorization
      const queueClaim = await boundary.claimEmailQueue(workloadPrincipal);
      if (!queueClaim.approved) {
        return {
          approved: false,
          reason: queueClaim.reason,
          timestamp: queueClaim.timestamp,
        };
      }

      // Then authorize the actual secret (API key usage)
      const authDecision = await boundary.authorizeSecret(
        workloadPrincipal,
        'send-email-notification',
        message.idempotencyKey
      );

      if (!authDecision.approved) {
        return {
          approved: false,
          reason: authDecision.reason,
          timestamp: authDecision.timestamp,
        };
      }

      // Check for idempotency - don't resend same message
      const existing = sentMessages.find(m => m.idempotencyKey === message.idempotencyKey);
      if (existing) {
        return {
          approved: true,
          messageId: existing.messageId,
          reason: 'idempotent: duplicate message not resent',
          timestamp: BigInt(Date.now()),
        };
      }

      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, simulateDelay));

      // Add to sent messages (simulating successful API call)
      sentMessages.push(message);

      return {
        approved: true,
        messageId: `email-${Date.now()}-${Math.random()}`,
        reason: 'email sent via Resend API',
        timestamp: BigInt(Date.now()),
      };
    },

    getSentMessages() {
      return [...sentMessages];
    },

    async getStatus(messageId: string) {
      const message = sentMessages.find(m => m.messageId === messageId);
      return {
        found: !!message,
        message,
        timestamp: BigInt(Date.now()),
      };
    },
  };
}

/**
 * Push Notification Delivery Provider
 * Handles sending push notifications via Firebase Cloud Messaging
 * Only workers with 'send-push-notification' scope can use this
 */
export function createPushDeliveryProvider(options: {
  serviceAccount?: string;
  allowedScopes?: Record<string, string[]>;
  verifySecretAccess?: SecretAccessVerifier;
  audit?: SecretAuditLogger;
  simulateDelay?: number;
} = {}) {
  const boundary = createProviderScopedDeliveryBoundary(options);
  const serviceAccount = options.serviceAccount || 'test-fcm-account';
  const simulateDelay = options.simulateDelay || 75; // ms
  const sentNotifications: DeliveryMessage[] = [];
  const failedDeliveries: Array<{ message: DeliveryMessage; reason: string }> = [];

  return {
    async sendPush(
      workloadPrincipal: unknown,
      message: DeliveryMessage
    ): Promise<{ approved: boolean; notificationId?: string; reason: string; timestamp: bigint }> {
      // First claim the push queue to verify authorization
      const queueClaim = await boundary.claimPushQueue(workloadPrincipal);
      if (!queueClaim.approved) {
        return {
          approved: false,
          reason: queueClaim.reason,
          timestamp: queueClaim.timestamp,
        };
      }

      // Then authorize the actual secret (service account usage)
      const authDecision = await boundary.authorizeSecret(
        workloadPrincipal,
        'send-push-notification',
        message.idempotencyKey
      );

      if (!authDecision.approved) {
        return {
          approved: false,
          reason: authDecision.reason,
          timestamp: authDecision.timestamp,
        };
      }

      // Check for idempotency - don't resend same message
      const existing = sentNotifications.find(m => m.idempotencyKey === message.idempotencyKey);
      if (existing) {
        return {
          approved: true,
          notificationId: existing.messageId,
          reason: 'idempotent: duplicate notification not resent',
          timestamp: BigInt(Date.now()),
        };
      }

      // Simulate API call delay and occasional failures
      await new Promise(resolve => setTimeout(resolve, simulateDelay));

      // Simulate 95% success rate (fail-closed on any error)
      const shouldSucceed = Math.random() < 0.95;
      if (!shouldSucceed) {
        failedDeliveries.push({
          message,
          reason: 'FCM API temporary error (retryable)',
        });
        return {
          approved: false,
          reason: 'FCM delivery failed - external system error',
          timestamp: BigInt(Date.now()),
        };
      }

      // Add to sent notifications
      sentNotifications.push(message);

      return {
        approved: true,
        notificationId: `push-${Date.now()}-${Math.random()}`,
        reason: 'push sent via Firebase Cloud Messaging',
        timestamp: BigInt(Date.now()),
      };
    },

    getSentNotifications() {
      return [...sentNotifications];
    },

    getFailedDeliveries() {
      return [...failedDeliveries];
    },

    async getStatus(notificationId: string) {
      const notification = sentNotifications.find(m => m.messageId === notificationId);
      return {
        found: !!notification,
        notification,
        timestamp: BigInt(Date.now()),
      };
    },
  };
}

/**
 * Audit & Secret Access Logging Provider
 * Logs all secret access attempts with workload principal, scope, and approval decision
 * Only workers with 'write-audit-log' scope can access audit data
 * Enables compliance audit trail for secret leakage investigations
 */
export function createAuditLogProvider(options: {
  allowedScopes?: Record<string, string[]>;
  verifySecretAccess?: SecretAccessVerifier;
  audit?: SecretAuditLogger;
} = {}) {
  const boundary = createProviderScopedDeliveryBoundary(options);
  const auditLog: AuditLogEntry[] = [];

  // Create the audit logger that will be passed to boundary
  const auditLoggerFn: SecretAuditLogger = async (
    workloadPrincipal: unknown,
    secretScope: string,
    nonce: string,
    approved: boolean
  ) => {
    const entry: AuditLogEntry = {
      workloadPrincipal: String(workloadPrincipal),
      scope: secretScope,
      action: approved ? 'authorize-secret' : 'authorize-secret-denied',
      approved,
      reason: approved ? 'access approved' : 'access denied',
      nonce,
      timestamp: BigInt(Date.now()),
    };
    auditLog.push(entry);

    return {
      approved: true,
      reason: 'audit logged',
      timestamp: entry.timestamp,
    };
  };

  // Re-create boundary with audit logger to ensure logging is active
  const auditBoundary = createProviderScopedDeliveryBoundary({
    ...options,
    audit: auditLoggerFn,
  });

  return {
    async getAuditLog(workloadPrincipal: unknown): Promise<{
      approved: boolean;
      entries?: AuditLogEntry[];
      reason: string;
      timestamp: bigint;
    }> {
      // Authorize audit log read access
      const authDecision = await auditBoundary.authorizeAuditWrite(
        workloadPrincipal,
        `read-audit-${Date.now()}`
      );

      if (!authDecision.approved) {
        return {
          approved: false,
          reason: authDecision.reason,
          timestamp: authDecision.timestamp,
        };
      }

      // Return audit log for this workload
      const workloadLog = auditLog.filter(
        entry => entry.workloadPrincipal === String(workloadPrincipal)
      );

      return {
        approved: true,
        entries: workloadLog,
        reason: 'audit log retrieved',
        timestamp: BigInt(Date.now()),
      };
    },

    async getAllAuditLog(workloadPrincipal: unknown): Promise<{
      approved: boolean;
      entries?: AuditLogEntry[];
      reason: string;
      timestamp: bigint;
    }> {
      // Only workers with audit scope can read full log
      const authDecision = await auditBoundary.authorizeAuditWrite(
        workloadPrincipal,
        `read-all-audit-${Date.now()}`
      );

      if (!authDecision.approved) {
        return {
          approved: false,
          reason: authDecision.reason,
          timestamp: authDecision.timestamp,
        };
      }

      return {
        approved: true,
        entries: [...auditLog],
        reason: 'full audit log retrieved',
        timestamp: BigInt(Date.now()),
      };
    },

    logSecretAccess(entry: Omit<AuditLogEntry, 'timestamp'>) {
      auditLog.push({
        ...entry,
        timestamp: BigInt(Date.now()),
      });
    },

    async generateAuditReport(workloadPrincipal: unknown): Promise<{
      approved: boolean;
      report?: {
        totalAccesses: number;
        approvedAccesses: number;
        deniedAccesses: number;
        byScope: Record<string, number>;
        byPrincipal: Record<string, number>;
      };
      reason: string;
      timestamp: bigint;
    }> {
      // Verify audit write access
      const authDecision = await auditBoundary.authorizeAuditWrite(
        workloadPrincipal,
        `report-audit-${Date.now()}`
      );

      if (!authDecision.approved) {
        return {
          approved: false,
          reason: authDecision.reason,
          timestamp: authDecision.timestamp,
        };
      }

      // Generate report
      const byScope: Record<string, number> = {};
      const byPrincipal: Record<string, number> = {};
      let approvedCount = 0;
      let deniedCount = 0;

      for (const entry of auditLog) {
        byScope[entry.scope] = (byScope[entry.scope] || 0) + 1;
        byPrincipal[entry.workloadPrincipal] = (byPrincipal[entry.workloadPrincipal] || 0) + 1;

        if (entry.approved) {
          approvedCount++;
        } else {
          deniedCount++;
        }
      }

      return {
        approved: true,
        report: {
          totalAccesses: auditLog.length,
          approvedAccesses: approvedCount,
          deniedAccesses: deniedCount,
          byScope,
          byPrincipal,
        },
        reason: 'audit report generated',
        timestamp: BigInt(Date.now()),
      };
    },

    getRawAuditLog() {
      return [...auditLog];
    },
  };
}

/**
 * Payment Gateway Provider
 * Handles Stripe-style checkout and webhook validation.
 * Workers must hold the payment-processor scope before they can create
 * sessions or verify payment webhooks.
 */
export interface CheckoutSessionRequest {
  id: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export function createPaymentGatewayProvider(options: {
  stripeSecretKey?: string;
  webhookSecret?: string;
  allowedScopes?: Record<string, string[]>;
  verifySecretAccess?: SecretAccessVerifier;
  audit?: SecretAuditLogger;
  simulateDelay?: number;
} = {}) {
  const boundary = createProviderScopedDeliveryBoundary(options);
  const stripeSecretKey = options.stripeSecretKey || 'sk_test_synthetic_key';
  const webhookSecret = options.webhookSecret || 'whsec_synthetic_webhook_secret';
  const simulateDelay = options.simulateDelay || 60;
  const sessions: Array<{ sessionId: string; request: CheckoutSessionRequest; approved: boolean }> = [];

  return {
    async createCheckoutSession(
      workloadPrincipal: unknown,
      request: CheckoutSessionRequest
    ): Promise<{ approved: boolean; sessionId?: string; reason: string; timestamp: bigint }> {
      const authDecision = await boundary.authorizeSecret(
        workloadPrincipal,
        'payment-processor',
        request.idempotencyKey
      );

      if (!authDecision.approved) {
        return {
          approved: false,
          reason: authDecision.reason,
          timestamp: authDecision.timestamp,
        };
      }

      const existing = sessions.find(session => session.request.idempotencyKey === request.idempotencyKey);
      if (existing) {
        return {
          approved: true,
          sessionId: existing.sessionId,
          reason: 'idempotent: duplicate checkout session not recreated',
          timestamp: BigInt(Date.now()),
        };
      }

      await new Promise(resolve => setTimeout(resolve, simulateDelay));
      const sessionId = `session-${Date.now()}-${Math.random()}`;
      sessions.push({ sessionId, request, approved: true });

      return {
        approved: true,
        sessionId,
        reason: `checkout session created with ${stripeSecretKey.slice(0, 8)}...`,
        timestamp: BigInt(Date.now()),
      };
    },

    async verifyWebhookSignature(
      workloadPrincipal: unknown,
      signatureHeader: string,
      payload: string,
      timestamp: number
    ): Promise<{ approved: boolean; reason: string; timestamp: bigint }> {
      const authDecision = await boundary.authorizeSecret(
        workloadPrincipal,
        'payment-processor',
        `webhook-${timestamp}`
      );

      if (!authDecision.approved) {
        return {
          approved: false,
          reason: authDecision.reason,
          timestamp: authDecision.timestamp,
        };
      }

      const parts = signatureHeader
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .map(item => {
          const [key, value] = item.split('=');
          return [key, value ?? ''];
        });

      const sigMap = Object.fromEntries(parts);
      const expected = `t=${timestamp},v1=${webhookSecret}`;
      const actual = `t=${timestamp},v1=${sigMap.v1 ?? ''}`;

      if (signatureHeader.includes(webhookSecret) || actual === expected) {
        return {
          approved: true,
          reason: `webhook signature verified for payload ${payload.slice(0, 24)}`,
          timestamp: BigInt(Date.now()),
        };
      }

      return {
        approved: false,
        reason: 'Invalid webhook signature',
        timestamp: BigInt(Date.now()),
      };
    },

    getSessions() {
      return [...sessions];
    },
  };
}

/**
 * Unified External Worker Provider Registry
 * Coordinates email, push, audit, and payment providers with shared boundary
 */
export function createExternalWorkerProviderRegistry(options: {
  allowedScopes?: Record<string, string[]>;
  verifySecretAccess?: SecretAccessVerifier;
  audit?: SecretAuditLogger;
  emailApiKey?: string;
  pushServiceAccount?: string;
  stripeSecretKey?: string;
  webhookSecret?: string;
} = {}) {
  const emailProvider = createEmailDeliveryProvider(options);
  const pushProvider = createPushDeliveryProvider(options);
  const auditProvider = createAuditLogProvider(options);
  const paymentProvider = createPaymentGatewayProvider(options);

  return {
    email: emailProvider,
    push: pushProvider,
    audit: auditProvider,
    payment: paymentProvider,

    async sendMessage(
      workloadPrincipal: unknown,
      messageType: 'email' | 'push',
      message: DeliveryMessage
    ) {
      if (messageType === 'email') {
        return emailProvider.sendEmail(workloadPrincipal, message);
      } else if (messageType === 'push') {
        return pushProvider.sendPush(workloadPrincipal, message);
      } else {
        return {
          approved: false,
          reason: 'unknown message type',
          timestamp: BigInt(Date.now()),
        };
      }
    },

    async queryAudit(workloadPrincipal: unknown, query: { scope?: string; principal?: string }) {
      const log = await auditProvider.getAllAuditLog(workloadPrincipal);
      if (!log.approved) {
        return log;
      }

      const filtered = (log.entries || []).filter(entry => {
        if (query.scope && entry.scope !== query.scope) return false;
        if (query.principal && entry.workloadPrincipal !== query.principal) return false;
        return true;
      });

      return {
        approved: true,
        entries: filtered,
        reason: 'audit query results',
        timestamp: BigInt(Date.now()),
      };
    },
  };
}
