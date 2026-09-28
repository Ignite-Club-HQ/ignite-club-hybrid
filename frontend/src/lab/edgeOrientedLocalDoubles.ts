export type LocalEdgeCandidate =
  | 'checkPendingSubs.recipients'
  | 'edgeFunctionEstateValidation'
  | 'eventViewReminderEmail'
  | 'paymentEdgeFunctions.security'
  | 'recoverAccount'
  | 'sendEngagementReminders.accuracy'
  | 'verifyIapReceipt.security';

export type LocalEdgeManifestEntry = {
  candidate: LocalEdgeCandidate;
  route: string;
  handler: string;
  deployable: boolean;
};

export const LOCAL_EDGE_CANDIDATES: readonly LocalEdgeCandidate[] = [
  'checkPendingSubs.recipients',
  'edgeFunctionEstateValidation',
  'eventViewReminderEmail',
  'paymentEdgeFunctions.security',
  'recoverAccount',
  'sendEngagementReminders.accuracy',
  'verifyIapReceipt.security',
];

export const LOCAL_EDGE_MANIFEST: readonly LocalEdgeManifestEntry[] = [
  {
    candidate: 'checkPendingSubs.recipients',
    route: '/local/check-pending-subs',
    handler: 'pending-subscription-recipients',
    deployable: true,
  },
  {
    candidate: 'edgeFunctionEstateValidation',
    route: '/local/estate-validation',
    handler: 'estate-validation',
    deployable: true,
  },
  {
    candidate: 'eventViewReminderEmail',
    route: '/local/event-view-reminder-email',
    handler: 'event-view-reminder-email',
    deployable: true,
  },
  {
    candidate: 'paymentEdgeFunctions.security',
    route: '/local/payment-verification',
    handler: 'payment-verification',
    deployable: true,
  },
  {
    candidate: 'recoverAccount',
    route: '/local/account-recovery',
    handler: 'account-recovery',
    deployable: true,
  },
  {
    candidate: 'sendEngagementReminders.accuracy',
    route: '/local/engagement-reminders',
    handler: 'engagement-reminders',
    deployable: true,
  },
  {
    candidate: 'verifyIapReceipt.security',
    route: '/local/iap-receipt-verification',
    handler: 'iap-receipt-verification',
    deployable: true,
  },
];

export function validateLocalEdgeManifest(
  manifest: readonly LocalEdgeManifestEntry[] = LOCAL_EDGE_MANIFEST,
) {
  const errors: string[] = [];
  const routes = new Set<string>();
  const candidates = new Set<string>();

  for (const entry of manifest) {
    if (!entry.route.startsWith('/local/')) errors.push(`${entry.candidate}: route is not local`);
    if (!entry.handler) errors.push(`${entry.candidate}: handler is missing`);
    if (!entry.deployable) errors.push(`${entry.candidate}: route is not deployable`);
    if (routes.has(entry.route)) errors.push(`${entry.candidate}: duplicate route`);
    if (candidates.has(entry.candidate)) errors.push(`${entry.candidate}: duplicate candidate`);
    routes.add(entry.route);
    candidates.add(entry.candidate);
  }
  for (const candidate of LOCAL_EDGE_CANDIDATES) {
    if (!candidates.has(candidate)) errors.push(`${candidate}: route is missing`);
  }

  return { deployable: errors.length === 0, errors, routes: [...routes] };
}

export type PendingSubscription = {
  subscriptionId: string;
  ownerId: string;
  clubId: string;
  email: string;
  status: 'pending' | 'active' | 'cancelled';
};

export function createPendingSubscriptionRecipientDouble(
  subscriptions: readonly PendingSubscription[],
) {
  return {
    recipients(scope: { ownerId: string; clubId: string }) {
      const emails = new Set<string>();
      for (const subscription of subscriptions) {
        if (
          subscription.ownerId === scope.ownerId
          && subscription.clubId === scope.clubId
          && subscription.status === 'pending'
          && subscription.email
        ) {
          emails.add(subscription.email.toLowerCase());
        }
      }
      return [...emails];
    },
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}

export type EventViewReminder = {
  recipientName: string;
  eventName: string;
  eventUrl: string;
};

export function renderEventViewReminderEmail(input: EventViewReminder) {
  const url = new URL(input.eventUrl, 'https://local.invalid');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Event URL must use an HTTP(S) protocol');
  }

  return [
    `<p>Hello ${escapeHtml(input.recipientName)},</p>`,
    `<p>View <strong>${escapeHtml(input.eventName)}</strong>.</p>`,
    `<a href="${escapeHtml(input.eventUrl)}">Open event</a>`,
  ].join('');
}

export type PaymentVerificationInput = {
  receipt: string;
  accountId: string;
  productId: string;
  amountCents: number;
};

export type VerificationResult = {
  status: 'accepted' | 'rejected' | 'replay';
  receipt: string;
};

export function createPaymentVerificationDouble(
  verify: (input: PaymentVerificationInput) => boolean,
) {
  const consumedReceipts = new Set<string>();

  return {
    verifyAndRecord(input: PaymentVerificationInput): VerificationResult {
      if (consumedReceipts.has(input.receipt)) return { status: 'replay', receipt: input.receipt };
      if (!input.receipt || !verify(input)) return { status: 'rejected', receipt: input.receipt };
      consumedReceipts.add(input.receipt);
      return { status: 'accepted', receipt: input.receipt };
    },
    consumed(receipt: string) {
      return consumedReceipts.has(receipt);
    },
  };
}

export type RecoveryRequest = {
  actorId: string;
  accountId: string;
  proof: string;
};

export type RecoveryResult = {
  status: 'recovered' | 'unauthorized' | 'rate-limited';
  remainingAttempts: number;
};

export function createAccountRecoveryDouble(options: {
  authorize: (request: RecoveryRequest) => boolean;
  maxAttempts: number;
  windowMs: number;
  now: () => number;
}) {
  if (options.maxAttempts <= 0 || options.windowMs <= 0) {
    throw new Error('Recovery rate-limit configuration must be positive');
  }

  const attempts = new Map<string, { startedAt: number; count: number }>();

  return {
    recover(request: RecoveryRequest): RecoveryResult {
      const now = options.now();
      const bucket = attempts.get(request.actorId);
      const current = !bucket || now - bucket.startedAt >= options.windowMs
        ? { startedAt: now, count: 0 }
        : bucket;
      if (current.count >= options.maxAttempts) {
        attempts.set(request.actorId, current);
        return { status: 'rate-limited', remainingAttempts: 0 };
      }

      current.count += 1;
      attempts.set(request.actorId, current);
      if (!options.authorize(request)) {
        return { status: 'unauthorized', remainingAttempts: options.maxAttempts - current.count };
      }
      return { status: 'recovered', remainingAttempts: options.maxAttempts - current.count };
    },
  };
}

export type EngagementReminderCandidate = {
  eventId: string;
  recipientId: string;
  email: string;
  eligible: boolean;
};

export type EngagementReminderJob = EngagementReminderCandidate & {
  idempotencyKey: string;
};

export function createEngagementReminderQueueDouble() {
  const jobs = new Map<string, EngagementReminderJob>();

  return {
    enqueue(candidates: readonly EngagementReminderCandidate[]) {
      let queuedCount = 0;
      for (const candidate of candidates) {
        if (!candidate.eligible || !candidate.email) continue;
        const idempotencyKey = `${candidate.eventId}:${candidate.recipientId}`;
        if (jobs.has(idempotencyKey)) continue;
        jobs.set(idempotencyKey, { ...candidate, idempotencyKey });
        queuedCount += 1;
      }
      return { queuedCount, totalCount: jobs.size };
    },
    jobs() {
      return [...jobs.values()];
    },
  };
}

export type IapReceiptInput = {
  receipt: string;
  accountId: string;
  productId: string;
  platform: 'ios' | 'android';
};

export function createIapReceiptVerificationDouble(
  verify: (input: IapReceiptInput) => boolean,
) {
  const consumedReceipts = new Set<string>();

  return {
    verifyAndRecord(input: IapReceiptInput): VerificationResult {
      if (consumedReceipts.has(input.receipt)) return { status: 'replay', receipt: input.receipt };
      if (!input.receipt || !verify(input)) return { status: 'rejected', receipt: input.receipt };
      consumedReceipts.add(input.receipt);
      return { status: 'accepted', receipt: input.receipt };
    },
  };
}
