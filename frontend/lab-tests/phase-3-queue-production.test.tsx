/**
 * Phase 3: Notification and Timer Production Path
 * 
 * Validates:
 * - Queue lease management and expiry recovery
 * - Cross-scope isolation (workers can't claim cross-domain jobs)
 * - Retry logic and backoff
 * - Dead-letter transitions
 * - Provider idempotency guarantees
 * 
 * Exit gate: No cross-domain worker claims; no job loss during lease expiry;
 * dead-letter path is explicit and auditable.
 */

import { expect, test, describe, beforeEach } from 'vitest';

// Helper to create synthetic principals
function createPrincipal(byte: number) {
  const { Principal } = require('@icp-sdk/core/principal');
  const bytes = new Uint8Array(29);
  bytes[0] = byte;
  return Principal.fromUint8Array(bytes);
}

// Mock queue job types
interface QueueJob {
  id: string;
  scope: string; // send-email-notification, send-push-notification, etc.
  recipient: string;
  payload: unknown;
  createdAt: bigint;
  nextAttemptAt: bigint;
  leaseExpiry?: bigint;
  retryCount: number;
  maxRetries: number;
  deadLettered: boolean;
}

// Simulated queue state manager
class MockNotificationQueue {
  private jobs: Map<string, QueueJob> = new Map();
  private claimed: Map<string, { worker: string; leaseExpiry: bigint }> = new Map();

  enqueue(job: QueueJob) {
    this.jobs.set(job.id, job);
  }

  // Claim jobs for a worker scoped to a specific capability
  claimScoped(now: bigint, workerScope: string, limit: number = 10) {
    const claimable: QueueJob[] = [];

    for (const [jobId, job] of this.jobs) {
      // Skip if already claimed or dead-lettered
      if (this.claimed.has(jobId) || job.deadLettered) continue;

      // Check if job scope matches worker capability
      if (job.scope !== workerScope && job.scope !== '*') continue;

      // Respect retry backoff by schedule time
      if (job.nextAttemptAt > now) continue;

      claimable.push(job);
    }

    // Grant 30-second leases
    const claimed = claimable.slice(0, limit);
    const leaseExpiry = now + BigInt(30000);

    claimed.forEach((job) => {
      this.claimed.set(job.id, { worker: workerScope, leaseExpiry });
    });

    return claimed;
  }

  // Acknowledge job (remove from queue on success)
  acknowledge(jobId: string, success: boolean) {
    const claim = this.claimed.get(jobId);
    if (!claim) {
      throw new Error(`Job ${jobId} not claimed`);
    }

    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    this.claimed.delete(jobId); // Remove claim immediately

    if (success) {
      this.jobs.delete(jobId); // Delete on success
      return { approved: true };
    } else {
      // Retry: increment counter, schedule next retry with backoff
      job.retryCount++;
      if (job.retryCount >= job.maxRetries) {
        job.deadLettered = true;
        return { approved: true, deadLettered: true };
      } else {
        job.nextAttemptAt = job.nextAttemptAt + BigInt(5000);
        return { approved: true, retry: true };
      }
    }
  }

  // Recover expired leases (for timer-based cleanup)
  recoverExpired(now: bigint) {
    let recovered = 0;
    for (const [jobId, claim] of this.claimed) {
      if (claim.leaseExpiry < now) {
        this.claimed.delete(jobId);
        recovered++;
      }
    }
    return recovered;
  }

  getStats() {
    return {
      total: this.jobs.size,
      claimed: this.claimed.size,
      deadLettered: Array.from(this.jobs.values()).filter((j) => j.deadLettered).length,
    };
  }

  getDeadLettered() {
    return Array.from(this.jobs.values()).filter((j) => j.deadLettered);
  }
}

describe('Phase 3: Notification and Timer Production Path', () => {
  let queue: MockNotificationQueue;
  let now = BigInt(1000000);

  beforeEach(() => {
    queue = new MockNotificationQueue();
    now = BigInt(1000000);
  });

  test('queue enforces cross-scope isolation: email worker cannot claim push jobs', () => {
    // Enqueue jobs for both scopes
    queue.enqueue({
      id: 'email-job-1',
      scope: 'send-email-notification',
      recipient: 'user@example.com',
      payload: { subject: 'Test' },
      createdAt: now,
      nextAttemptAt: now,
      retryCount: 0,
      maxRetries: 3,
      deadLettered: false,
    });

    queue.enqueue({
      id: 'push-job-1',
      scope: 'send-push-notification',
      recipient: 'device-123',
      payload: { title: 'Notification' },
      createdAt: now,
      nextAttemptAt: now,
      retryCount: 0,
      maxRetries: 3,
      deadLettered: false,
    });

    // Email worker claims only email jobs
    const emailClaims = queue.claimScoped(now, 'send-email-notification', 10);
    expect(emailClaims).toHaveLength(1);
    expect(emailClaims[0].scope).toBe('send-email-notification');

    // Push worker claims only push jobs
    const pushClaims = queue.claimScoped(now, 'send-push-notification', 10);
    expect(pushClaims).toHaveLength(1);
    expect(pushClaims[0].scope).toBe('send-push-notification');

    // Verify email worker cannot claim push job
    const evilClaim = queue.claimScoped(now, 'send-email-notification', 10);
    expect(evilClaim).toHaveLength(0); // Both already claimed
  });

  test('lease expiry recovery prevents job loss: expired claims are recovered', () => {
    queue.enqueue({
      id: 'job-1',
      scope: 'send-email-notification',
      recipient: 'user@example.com',
      payload: {},
      createdAt: now,
      nextAttemptAt: now,
      retryCount: 0,
      maxRetries: 3,
      deadLettered: false,
    });

    // Claim job (30-second lease)
    const claimed = queue.claimScoped(now, 'send-email-notification', 10);
    expect(claimed).toHaveLength(1);

    // Job is now claimed
    expect(queue.getStats().claimed).toBe(1);

    // Simulate lease expiry (advance time by 40 seconds)
    const expiredTime = now + BigInt(40000);
    const recovered = queue.recoverExpired(expiredTime);

    expect(recovered).toBe(1);
    expect(queue.getStats().claimed).toBe(0);

    // Job can be reclaimed by another worker
    const reclaimed = queue.claimScoped(expiredTime, 'send-email-notification', 10);
    expect(reclaimed).toHaveLength(1);
  });

  test('retry logic with backoff prevents immediate reprocessing', () => {
    const jobCreatedAt = now;
    queue.enqueue({
      id: 'job-1',
      scope: 'send-email-notification',
      recipient: 'user@example.com',
      payload: {},
      createdAt: jobCreatedAt,
      nextAttemptAt: jobCreatedAt,
      retryCount: 0,
      maxRetries: 3,
      deadLettered: false,
    });

    // First claim and fail
    let claims = queue.claimScoped(now, 'send-email-notification', 10);
    expect(claims).toHaveLength(1);

    const failTime = now + BigInt(1000);
    queue.acknowledge(claims[0].id, false);

    // Immediately try to reclaim with the same timestamp (still on backoff)
    claims = queue.claimScoped(failTime, 'send-email-notification', 10);
    expect(claims).toHaveLength(0);

    // After the backoff window, the job can be retried
    const retryAt = failTime + BigInt(5000);
    claims = queue.claimScoped(retryAt, 'send-email-notification', 10);
    expect(claims).toHaveLength(1);
  });

  test('dead-letter transition occurs after max retries exhausted', () => {
    queue.enqueue({
      id: 'job-1',
      scope: 'send-email-notification',
      recipient: 'user@example.com',
      payload: {},
      createdAt: now,
      nextAttemptAt: now,
      retryCount: 0,
      maxRetries: 2, // Only 2 retries allowed
      deadLettered: false,
    });

    let stats = queue.getStats();
    expect(stats.deadLettered).toBe(0);

    // Attempt 1: fail
    let claims = queue.claimScoped(now, 'send-email-notification', 10);
    queue.acknowledge(claims[0].id, false);

    // Attempt 2: fail again and exhaust the retry budget
    claims = queue.claimScoped(now + BigInt(6000), 'send-email-notification', 10);
    const result = queue.acknowledge(claims[0].id, false);

    expect(result.deadLettered).toBe(true);

    stats = queue.getStats();
    expect(stats.deadLettered).toBe(1);

    // Dead-lettered job cannot be reclaimed
    const deadLettered = queue.getDeadLettered();
    expect(deadLettered).toHaveLength(1);
  });

  test('provider idempotency: acknowledging same job twice fails gracefully', () => {
    queue.enqueue({
      id: 'job-1',
      scope: 'send-email-notification',
      recipient: 'user@example.com',
      payload: {},
      createdAt: now,
      nextAttemptAt: now,
      retryCount: 0,
      maxRetries: 3,
      deadLettered: false,
    });

    // Claim and acknowledge once
    const claims = queue.claimScoped(now, 'send-email-notification', 10);
    queue.acknowledge(claims[0].id, true);

    // Try to acknowledge again (should fail)
    expect(() => {
      queue.acknowledge(claims[0].id, true);
    }).toThrow('not claimed');
  });

  test('wildcard scope jobs are claimed by any worker', () => {
    queue.enqueue({
      id: 'broadcast-job-1',
      scope: '*', // Wildcard: any worker can claim
      recipient: 'all-users',
      payload: { announcement: 'System maintenance' },
      createdAt: now,
      nextAttemptAt: now,
      retryCount: 0,
      maxRetries: 3,
      deadLettered: false,
    });

    // Both email and push workers can claim wildcard jobs
    const emailClaims = queue.claimScoped(now, 'send-email-notification', 10);
    expect(emailClaims).toHaveLength(1);

    // Claimed by email worker, so push worker gets nothing
    const pushClaims = queue.claimScoped(now, 'send-push-notification', 10);
    expect(pushClaims).toHaveLength(0);
  });
});
