import { describe, test, expect, beforeEach } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createWorkerCoordinator } from '../src/lab/externalWorkerCoordinator';

// Helper to create a synthetic principal from bytes
function createPrincipal(byte: number): Principal {
  const bytes = new Uint8Array(29);
  bytes[0] = byte;
  return Principal.fromUint8Array(bytes);
}

describe('External Worker Coordinator: Queue + Workload Identity', () => {
  // Create synthetic principals from bytes to avoid checksum issues
  const emailWorker = createPrincipal(1);
  const pushWorker = createPrincipal(2);
  const revokedWorker = createPrincipal(3);

  let coordinator: any;
  let workloadClients: Map<string, boolean>;
  let queueGranted: Map<string, string>;

  beforeEach(() => {
    // Simulate workload identity state
    workloadClients = new Map([
      [emailWorker.toString(), true], // active
      [pushWorker.toString(), true], // active
      [revokedWorker.toString(), false], // revoked
    ]);

    // Simulate queue grants
    queueGranted = new Map();

    const mockWorkloadClient = {
      verifySecretAccess: async (
        principal: unknown,
        scope: string,
        nonce: string
      ) => {
        const isActive = workloadClients.get(String(principal));
        if (isActive === undefined) {
          return {
            approved: false,
            reason: 'Workload not registered',
            timestamp: BigInt(Date.now()),
          };
        }
        if (!isActive) {
          return {
            approved: false,
            reason: 'Workload is revoked or suspended',
            timestamp: BigInt(Date.now()),
          };
        }
        // Verify scope matches worker capability
        if (String(principal) === emailWorker.toString() && scope !== 'send-email-notification') {
          return {
            approved: false,
            reason: 'Scope not granted to this workload',
            timestamp: BigInt(Date.now()),
          };
        }
        if (String(principal) === pushWorker.toString() && scope !== 'send-push-notification') {
          return {
            approved: false,
            reason: 'Scope not granted to this workload',
            timestamp: BigInt(Date.now()),
          };
        }
        return {
          approved: true,
          reason: 'Workload authorized for scope',
          timestamp: BigInt(Date.now()),
        };
      },
    };

    const mockQueueClient = {
      grantWorkerScope: async (worker: unknown, scope: string) => {
        queueGranted.set(String(worker), scope);
        return { approved: true };
      },
      claim: async (now: bigint, limit: number) => {
        return {
          approved: true,
          jobs: [
            {
              id: 'job-1',
              scope: 'send-email-notification',
              recipient: emailWorker,
            },
            {
              id: 'job-2',
              scope: 'send-push-notification',
              recipient: pushWorker,
            },
          ],
        };
      },
      acknowledge: async (jobId: string, key: string) => {
        return { approved: true };
      },
    };

    const auditLog: any[] = [];
    coordinator = createWorkerCoordinator({
      workloadClient: mockWorkloadClient,
      queueClient: mockQueueClient,
      auditLog: async (entry) => auditLog.push(entry),
    });
  });

  test('email worker registers with workload identity and email scope', async () => {
    const result = await coordinator.registerWorker(emailWorker, 'send-email-notification');
    expect(result.approved).toBe(true);
    expect(queueGranted.has(emailWorker.toString())).toBe(true);
  });

  test('push worker registers with workload identity and push scope', async () => {
    const result = await coordinator.registerWorker(pushWorker, 'send-push-notification');
    expect(result.approved).toBe(true);
    expect(queueGranted.has(pushWorker.toString())).toBe(true);
  });

  test('revoked worker cannot register', async () => {
    const result = await coordinator.registerWorker(revokedWorker, 'send-email-notification');
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/revoked|suspended/i);
  });

  test('email worker can only claim email scope jobs', async () => {
    await coordinator.registerWorker(emailWorker, 'send-email-notification');

    const result = await coordinator.claimJobsWithAttestation(
      emailWorker,
      'send-email-notification',
      BigInt(Date.now()),
      10
    );

    expect(result.approved).toBe(true);
    expect(result.jobs).toBeDefined();
    expect(result.jobs?.length).toBe(1);
    expect(result.jobs?.[0].scope).toBe('send-email-notification');
  });

  test('push worker cannot claim email scope jobs', async () => {
    const result = await coordinator.claimJobsWithAttestation(
      pushWorker,
      'send-email-notification',
      BigInt(Date.now()),
      10
    );

    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/not authorized|not granted/i);
  });

  test('revoked worker cannot claim any jobs', async () => {
    const result = await coordinator.claimJobsWithAttestation(
      revokedWorker,
      'send-email-notification',
      BigInt(Date.now()),
      10
    );

    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/revoked|suspended/i);
  });

  test('unregistered worker cannot claim jobs', async () => {
    // Create a principal not in the workload clients map
    const unknownWorker = createPrincipal(99);
    const result = await coordinator.claimJobsWithAttestation(
      unknownWorker,
      'send-email-notification',
      BigInt(Date.now()),
      10
    );

    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/not registered/i);
  });

  test('job acknowledgement succeeds for claimed job', async () => {
    await coordinator.registerWorker(emailWorker, 'send-email-notification');

    const result = await coordinator.acknowledgeJob(emailWorker, 'job-1', 'idempotency-key-1');
    expect(result.approved).toBe(true);
  });
});
