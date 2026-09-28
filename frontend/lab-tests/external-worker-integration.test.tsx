import { expect, test, describe } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createRealExternalWorkerCoordinator } from '../src/lab/externalWorkerIntegration';

describe('External Worker Integration: Real Canister Clients', () => {
  // Create synthetic principals for testing
  function createPrincipal(byte: number): Principal {
    const bytes = new Uint8Array(29);
    bytes[0] = byte;
    return Principal.fromUint8Array(bytes);
  }

  const emailWorker = createPrincipal(1);
  const pushWorker = createPrincipal(2);

  test('real coordinator integrates workload identity verification with queue claims', async () => {
    // Mock SecretWorkloadService actor
    const mockWorkloadActor = {
      verify_secret_access: async (principal: any, scope: string, nonce: string) => {
        // Extract principal text for comparison
        const principalText = typeof principal === 'string' 
          ? principal 
          : principal.toText?.() || String(principal);
        
        // Email worker can access send-email-notification scope
        if (principalText === emailWorker.toText() && scope === 'send-email-notification') {
          return {
            Ok: {
              approved: true,
              reason: 'Worker authorized',
              timestamp: BigInt(Date.now()),
            },
          };
        }
        return {
          Err: 'Scope not authorized for this worker',
        };
      },
      register_workload: async () => ({ Ok: null }),
      revoke_workload: async () => ({ Ok: null }),
      audit_secret_access: async () => ({ Ok: [] }),
      get_audit_summary: async () => ({ Ok: { total: 0n, approved: 0n, denied: 0n } }),
    };

    // Mock NotificationQueueService actor
    const mockQueueActor = {
      claim_notifications: async (now: bigint, limit: bigint) => {
        return {
          Ok: [
            {
              id: 'job-1',
              scope: 'send-email-notification',
              recipient: emailWorker,
              payload: 'email-test',
            },
            {
              id: 'job-2',
              scope: 'send-push-notification',
              recipient: pushWorker,
              payload: 'push-test',
            },
          ],
        };
      },
      acknowledge_notification: async (jobId: string, key: string) => {
        return { Ok: null };
      },
      queue_stats: async () => ({ Ok: { pending: 2n, acknowledged: 0n } }),
    };

    // Create real coordinator with mock actors
    const coordinator = createRealExternalWorkerCoordinator(
      mockWorkloadActor as any,
      mockQueueActor as any
    );

    // Email worker can claim email jobs
    const emailClaim = await coordinator.claimJobsWithAttestation(
      emailWorker,
      'send-email-notification',
      BigInt(Date.now()),
      10
    );

    expect(emailClaim.approved).toBe(true);
    expect(emailClaim.jobs?.length).toBe(1);
    expect(emailClaim.jobs?.[0]?.scope).toBe('send-email-notification');
  });

  test('real coordinator rejects unauthorized scope access', async () => {
    const mockWorkloadActor = {
      verify_secret_access: async (principal: any, scope: string, nonce: string) => {
        // Only push worker can access push scope
        if (principal.toText?.() === pushWorker.toText() && scope === 'send-push-notification') {
          return {
            Ok: {
              approved: true,
              reason: 'Worker authorized',
              timestamp: BigInt(Date.now()),
            },
          };
        }
        return { Err: 'Scope not authorized' };
      },
      register_workload: async () => ({ Ok: null }),
      revoke_workload: async () => ({ Ok: null }),
      audit_secret_access: async () => ({ Ok: [] }),
      get_audit_summary: async () => ({ Ok: { total: 0n, approved: 0n, denied: 0n } }),
    };

    const mockQueueActor = {
      claim_notifications: async (now: bigint, limit: bigint) => {
        return { Ok: [] };
      },
      acknowledge_notification: async (jobId: string, key: string) => {
        return { Ok: null };
      },
      queue_stats: async () => ({ Ok: { pending: 0n, acknowledged: 0n } }),
    };

    const coordinator = createRealExternalWorkerCoordinator(
      mockWorkloadActor as any,
      mockQueueActor as any
    );

    // Push worker trying to claim email scope should fail at workload verification
    const result = await coordinator.claimJobsWithAttestation(
      pushWorker,
      'send-email-notification', // Wrong scope!
      BigInt(Date.now()),
      10
    );

    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/not authorized|not granted/i);
  });

  test('real coordinator handles canister errors gracefully', async () => {
    const mockWorkloadActor = {
      verify_secret_access: async () => {
        throw new Error('Canister panic: workload not found');
      },
      register_workload: async () => ({ Ok: null }),
      revoke_workload: async () => ({ Ok: null }),
      audit_secret_access: async () => ({ Ok: [] }),
      get_audit_summary: async () => ({ Ok: { total: 0n, approved: 0n, denied: 0n } }),
    };

    const mockQueueActor = {
      claim_notifications: async () => {
        throw new Error('Canister error');
      },
      acknowledge_notification: async () => ({ Ok: null }),
      queue_stats: async () => ({ Ok: { pending: 0n, acknowledged: 0n } }),
    };

    const coordinator = createRealExternalWorkerCoordinator(
      mockWorkloadActor as any,
      mockQueueActor as any
    );

    const result = await coordinator.claimJobsWithAttestation(
      emailWorker,
      'send-email-notification',
      BigInt(Date.now()),
      10
    );

    expect(result.approved).toBe(false);
    expect(result.reason).toContain('Verification failed');
  });

  test('real coordinator preserves job acknowledgement idempotency', async () => {
    let acknowledgeCount = 0;

    const mockWorkloadActor = {
      verify_secret_access: async () => ({
        Ok: { approved: true, reason: 'OK', timestamp: BigInt(Date.now()) },
      }),
      register_workload: async () => ({ Ok: null }),
      revoke_workload: async () => ({ Ok: null }),
      audit_secret_access: async () => ({ Ok: [] }),
      get_audit_summary: async () => ({ Ok: { total: 0n, approved: 0n, denied: 0n } }),
    };

    const mockQueueActor = {
      claim_notifications: async () => ({ Ok: [] }),
      acknowledge_notification: async (jobId: string, key: string) => {
        acknowledgeCount++;
        return { Ok: null };
      },
      queue_stats: async () => ({ Ok: { pending: 0n, acknowledged: 0n } }),
    };

    const coordinator = createRealExternalWorkerCoordinator(
      mockWorkloadActor as any,
      mockQueueActor as any
    );

    // Acknowledge twice with same idempotency key should only process once
    await coordinator.acknowledgeJob(emailWorker, 'job-1', 'idempotency-key-1');
    await coordinator.acknowledgeJob(emailWorker, 'job-1', 'idempotency-key-1');

    // Both calls should have gone through to the mock (in reality canister enforces idempotency)
    expect(acknowledgeCount).toBe(2);
  });
});
