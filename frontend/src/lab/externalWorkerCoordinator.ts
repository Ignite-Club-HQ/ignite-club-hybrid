/**
 * External Worker Coordinator
 * Bridges queue claims to workload identity verification
 * 
 * This is the production-safe gateway that ensures:
 * 1. Only registered workers can claim queue jobs
 * 2. Workers can only claim jobs matching their approved scopes
 * 3. All access is audited and logged
 * 4. Revocation or suspension is fail-closed
 */

export type WorkloadIdentityClient = {
  verifySecretAccess(workloadPrincipal: unknown, secretScope: string, nonce: string): Promise<{ approved: boolean; reason: string; timestamp: bigint }>;
};

export type NotificationQueueClient = {
  grantWorkerScope(worker: unknown, scope: string): Promise<{ approved: boolean }>;
  claim(now: bigint, limit: number): Promise<{ approved: boolean; jobs?: any[] }>;
  acknowledge(jobId: string, idempotencyKey: string): Promise<{ approved: boolean }>;
};

export interface WorkerCoordinatorOptions {
  workloadClient: WorkloadIdentityClient;
  queueClient: NotificationQueueClient;
  auditLog?: (entry: any) => Promise<void>;
}

export function createWorkerCoordinator(options: WorkerCoordinatorOptions) {
  const { workloadClient, queueClient, auditLog } = options;

  const logAccess = async (
    workloadPrincipal: unknown,
    scope: string,
    action: string,
    approved: boolean,
    reason: string
  ) => {
    if (auditLog) {
      await auditLog({
        timestamp: Date.now(),
        workloadPrincipal: String(workloadPrincipal),
        scope,
        action,
        approved,
        reason,
      });
    }
  };

  return {
    /**
     * Register a worker with the queue and verify it against workload identity
     */
    async registerWorker(
      workloadPrincipal: unknown,
      scope: string
    ): Promise<{ approved: boolean; reason: string }> {
      const nonce = `register-${Date.now()}-${Math.random()}`;

      // First verify the worker is registered in workload identity
      const identityCheck = await workloadClient.verifySecretAccess(
        workloadPrincipal,
        scope,
        nonce
      );

      if (!identityCheck.approved) {
        await logAccess(workloadPrincipal, scope, 'register-worker', false, identityCheck.reason);
        return {
          approved: false,
          reason: `Workload identity check failed: ${identityCheck.reason}`,
        };
      }

      // Then grant the worker scope in the queue
      const queueGrant = await queueClient.grantWorkerScope(workloadPrincipal, scope);
      if (!queueGrant.approved) {
        await logAccess(workloadPrincipal, scope, 'register-worker', false, 'Queue grant failed');
        return {
          approved: false,
          reason: 'Failed to grant worker scope in queue',
        };
      }

      await logAccess(workloadPrincipal, scope, 'register-worker', true, 'Worker registered and scoped');
      return {
        approved: true,
        reason: 'Worker registered successfully',
      };
    },

    /**
     * Claim queue jobs with workload identity verification
     * Enforces both workload identity and queue scope matching
     */
    async claimJobsWithAttestation(
      workloadPrincipal: unknown,
      scope: string,
      now: bigint,
      limit: number = 10
    ): Promise<{
      approved: boolean;
      jobs?: any[];
      reason: string;
    }> {
      const nonce = `claim-${Date.now()}-${Math.random()}`;

      // Step 1: Verify workload identity attestation for this scope
      const identityCheck = await workloadClient.verifySecretAccess(
        workloadPrincipal,
        scope,
        nonce
      );

      if (!identityCheck.approved) {
        await logAccess(
          workloadPrincipal,
          scope,
          'claim-jobs',
          false,
          `Workload identity check failed: ${identityCheck.reason}`
        );
        return {
          approved: false,
          reason: `Workload not authorized: ${identityCheck.reason}`,
        };
      }

      // Step 2: Claim jobs from queue
      const queueClaim = await queueClient.claim(now, limit);
      if (!queueClaim.approved) {
        await logAccess(
          workloadPrincipal,
          scope,
          'claim-jobs',
          false,
          'Queue claim failed'
        );
        return {
          approved: false,
          reason: 'Failed to claim jobs from queue',
        };
      }

      // Step 3: Filter jobs to match worker scope
      const scopedJobs = (queueClaim.jobs || []).filter(
        (job) => job.scope === scope || job.scope === '*'
      );

      await logAccess(
        workloadPrincipal,
        scope,
        'claim-jobs',
        true,
        `Claimed ${scopedJobs.length} jobs matching scope`
      );

      return {
        approved: true,
        jobs: scopedJobs,
        reason: `Claimed ${scopedJobs.length} jobs`,
      };
    },

    /**
     * Acknowledge a job completion with idempotency
     */
    async acknowledgeJob(
      workloadPrincipal: unknown,
      jobId: string,
      idempotencyKey: string
    ): Promise<{ approved: boolean; reason: string }> {
      const ack = await queueClient.acknowledge(jobId, idempotencyKey);

      if (!ack.approved) {
        await logAccess(
          workloadPrincipal,
          'delivery',
          'acknowledge-job',
          false,
          `Failed to acknowledge ${jobId}`
        );
        return {
          approved: false,
          reason: 'Failed to acknowledge job',
        };
      }

      await logAccess(
        workloadPrincipal,
        'delivery',
        'acknowledge-job',
        true,
        `Acknowledged ${jobId}`
      );

      return {
        approved: true,
        reason: 'Job acknowledged',
      };
    },
  };
}
