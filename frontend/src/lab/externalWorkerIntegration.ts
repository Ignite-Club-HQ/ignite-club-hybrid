/**
 * Phase 2b: Real Canister Integration
 * 
 * Adapts ExternalWorkerCoordinator to work with real ICP actors:
 * - secretWorkloadClient: wraps Secret_workload_identity actor
 * - notificationQueueClient: wraps NotificationQueue actor
 * 
 * This enables end-to-end delivery: workers claim queued jobs via canister
 * authorization and scope verification.
 */

import { Principal } from '@icp-sdk/core/principal';
import type { _SERVICE as SecretWorkloadService } from './bindings/secret_workload_identity/declarations/secret_workload_identity.did';
import type { _SERVICE as NotificationQueueService } from './bindings/notification_queue/declarations/notification_queue.did';
import { createWorkerCoordinator } from './externalWorkerCoordinator';

export interface RealWorkloadClient {
  actor: SecretWorkloadService;
  verifySecretAccess: (
    principal: unknown,
    scope: string,
    nonce: string
  ) => Promise<{
    approved: boolean;
    reason: string;
    timestamp: bigint;
  }>;
}

export interface RealQueueClient {
  actor: NotificationQueueService;
  claim: (now: bigint, limit: number) => Promise<{
    approved: boolean;
    jobs?: Array<{
      id: string;
      scope: string;
      recipient: unknown;
    }>;
    reason?: string;
  }>;
  acknowledge: (jobId: string, idempotencyKey: string) => Promise<{
    approved: boolean;
    reason?: string;
  }>;
}

/**
 * Wraps Secret_workload_identity canister calls in the client interface
 */
export function createRealWorkloadClient(
  actor: SecretWorkloadService
): RealWorkloadClient {
  return {
    actor,
    verifySecretAccess: async (principal, scope, nonce) => {
      try {
        // Call canister: verify_secret_access(principal, scope, nonce)
        // Principal is already a Principal type, pass it directly
        const result = await actor.verify_secret_access(
          principal as any, // Cast to match canister's expected type
          scope,
          nonce
        );

        // Handle Result type: { Ok: VerifyResult } or { Err: string }
        if ('Ok' in result) {
          const verified = result.Ok;
          return {
            approved: verified.approved,
            reason: verified.reason || 'Access approved',
            timestamp: verified.timestamp || BigInt(Date.now()),
          };
        } else if ('Err' in result) {
          return {
            approved: false,
            reason: result.Err,
            timestamp: BigInt(Date.now()),
          };
        }
        return {
          approved: false,
          reason: 'Unexpected verification response',
          timestamp: BigInt(Date.now()),
        };
      } catch (error) {
        return {
          approved: false,
          reason: `Verification failed: ${String(error)}`,
          timestamp: BigInt(Date.now()),
        };
      }
    },
  };
}

/**
 * Wraps NotificationQueue canister calls in the client interface
 */
export function createRealQueueClient(
  actor: NotificationQueueService
): RealQueueClient {
  return {
    actor,
    claim: async (now, limit) => {
      try {
        // Call canister: claim_notifications(now, limit)
        const result = await actor.claim_notifications(now, BigInt(limit));

        // Handle Result: { Ok: [Job] } or { Err: string }
        if ('Ok' in result) {
          const jobs = result.Ok.map((job: any) => ({
            id: job.id,
            scope: job.scope || '*',
            recipient: job.recipient,
          }));
          return {
            approved: true,
            jobs,
          };
        } else if ('Err' in result) {
          return {
            approved: false,
            reason: result.Err,
          };
        }
        return {
          approved: false,
          reason: 'Unexpected claim response',
        };
      } catch (error) {
        return {
          approved: false,
          reason: `Claim failed: ${String(error)}`,
        };
      }
    },
    acknowledge: async (jobId, idempotencyKey) => {
      try {
        // Call canister: acknowledge_notification(job_id, idempotency_key)
        const result = await actor.acknowledge_notification(jobId, idempotencyKey);

        // Handle Result
        if ('Ok' in result) {
          return { approved: true };
        } else if ('Err' in result) {
          return { approved: false, reason: result.Err };
        }
        return { approved: false, reason: 'Unexpected ack response' };
      } catch (error) {
        return {
          approved: false,
          reason: `Acknowledge failed: ${String(error)}`,
        };
      }
    },
  };
}

/**
 * Creates a production-ready coordinator with real canister clients
 */
export function createRealExternalWorkerCoordinator(
  workloadActor: SecretWorkloadService,
  queueActor: NotificationQueueService
) {
  const workloadClient = createRealWorkloadClient(workloadActor);
  const queueClient = createRealQueueClient(queueActor);

  const auditLog: Array<{
    timestamp: bigint;
    principal: string;
    scope: string;
    action: string;
    approved: boolean;
    reason: string;
  }> = [];

  return createWorkerCoordinator({
    workloadClient,
    queueClient,
    auditLog: async (entry) => {
      auditLog.push(entry);
      // In production, send to persistent audit log service
      console.log('[WorkerAudit]', entry);
    },
  });
}

/**
 * Gets audit log entries filtered by principal, scope, or action
 */
export function getAuditLogFiltered(
  fullLog: Array<any>,
  filter?: {
    principal?: string;
    scope?: string;
    action?: string;
    approvedOnly?: boolean;
  }
) {
  return fullLog.filter((entry) => {
    if (filter?.principal && entry.principal !== filter.principal) return false;
    if (filter?.scope && entry.scope !== filter.scope) return false;
    if (filter?.action && entry.action !== filter.action) return false;
    if (filter?.approvedOnly && !entry.approved) return false;
    return true;
  });
}
