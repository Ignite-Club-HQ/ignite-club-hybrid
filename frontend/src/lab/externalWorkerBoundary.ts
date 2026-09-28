export type SecretAccessDecision = {
  approved: boolean;
  reason: string;
  timestamp: bigint;
};

export type SecretAccessVerifier = (
  workloadPrincipal: unknown,
  secretScope: string,
  nonce: string
) => Promise<SecretAccessDecision> | SecretAccessDecision;

export type SecretAuditLogger = (
  workloadPrincipal: unknown,
  secretScope: string,
  nonce: string,
  approved: boolean
) => Promise<SecretAccessDecision> | SecretAccessDecision;

export function canClaimScope(
  allowedScopes: string[],
  requestedScope: string
): { approved: boolean; reason: string; timestamp: bigint } {
  if (allowedScopes.includes(requestedScope)) {
    return {
      approved: true,
      reason: 'authorized',
      timestamp: BigInt(Date.now()),
    };
  }

  return {
    approved: false,
    reason: `Worker not authorized for scope ${requestedScope}; allowed scopes: ${allowedScopes.join(', ') || 'none'}`,
    timestamp: BigInt(Date.now()),
  };
}

export function createExternalWorkerBoundary(options: {
  allowedScopes?: Record<string, string[]>;
  verifySecretAccess?: SecretAccessVerifier;
  audit?: SecretAuditLogger;
} = {}) {
  const verifySecretAccess = options.verifySecretAccess ?? (async () => ({
    approved: true,
    reason: 'authorized',
    timestamp: BigInt(Date.now()),
  }));

  const audit = options.audit ?? (async () => ({
    approved: true,
    reason: 'authorized',
    timestamp: BigInt(Date.now()),
  }));

  const getAllowedScopes = async (workloadPrincipal: unknown): Promise<string[]> => {
    const key = String(workloadPrincipal);
    return options.allowedScopes?.[key] ?? [];
  };

  return {
    async authorizeSecret(
      workloadPrincipal: unknown,
      secretScope: string,
      nonce: string
    ): Promise<SecretAccessDecision> {
      // First check if the workload has the requested scope in its allowed scopes
      const scopeDecision = canClaimScope(
        await getAllowedScopes(workloadPrincipal),
        secretScope
      );
      if (!scopeDecision.approved) {
        await audit(workloadPrincipal, secretScope, nonce, false);
        return {
          approved: false,
          reason: scopeDecision.reason,
          timestamp: scopeDecision.timestamp,
        };
      }

      // Then verify with the secret access verifier
      const decision = await verifySecretAccess(workloadPrincipal, secretScope, nonce);
      if (!decision.approved) {
        await audit(workloadPrincipal, secretScope, nonce, false);
        return {
          approved: false,
          reason: decision.reason || 'unauthorized',
          timestamp: decision.timestamp ?? BigInt(Date.now()),
        };
      }

      const logged = await audit(workloadPrincipal, secretScope, nonce, true);
      return {
        approved: true,
        reason: logged.reason || 'authorized',
        timestamp: logged.timestamp ?? BigInt(Date.now()),
      };
    },

    async claimQueue(
      workloadPrincipal: unknown,
      requestedScope: string,
      queueDomain: string
    ): Promise<{ approved: boolean; reason: string; timestamp: bigint; queueDomain: string }> {
      const scopeDecision = canClaimScope(
        await getAllowedScopes(workloadPrincipal),
        requestedScope
      );

      if (!scopeDecision.approved) {
        return {
          approved: false,
          reason: scopeDecision.reason,
          timestamp: scopeDecision.timestamp,
          queueDomain,
        };
      }

      const secretDecision = await this.authorizeSecret(workloadPrincipal, requestedScope, `queue:${queueDomain}`);
      return {
        approved: secretDecision.approved,
        reason: secretDecision.approved ? 'queue claim authorized' : secretDecision.reason,
        timestamp: secretDecision.timestamp,
        queueDomain,
      };
    },

    async getAllowedScopes(workloadPrincipal: unknown): Promise<string[]> {
      return getAllowedScopes(workloadPrincipal);
    },
  };
}

export function createProviderScopedDeliveryBoundary(options: {
  allowedScopes?: Record<string, string[]>;
  verifySecretAccess?: SecretAccessVerifier;
  audit?: SecretAuditLogger;
} = {}) {
  const base = createExternalWorkerBoundary(options);

  return {
    async claimEmailQueue(workloadPrincipal: unknown, queueDomain: string = 'email') {
      return base.claimQueue(workloadPrincipal, 'send-email-notification', queueDomain);
    },
    async claimPushQueue(workloadPrincipal: unknown, queueDomain: string = 'push') {
      return base.claimQueue(workloadPrincipal, 'send-push-notification', queueDomain);
    },
    async authorizeAuditWrite(workloadPrincipal: unknown, nonce: string = 'audit-write') {
      return base.authorizeSecret(workloadPrincipal, 'write-audit-log', nonce);
    },
    async authorizeSecret(workloadPrincipal: unknown, secretScope: string, nonce: string) {
      return base.authorizeSecret(workloadPrincipal, secretScope, nonce);
    },
    async getAllowedScopes(workloadPrincipal: unknown) {
      return base.getAllowedScopes(workloadPrincipal);
    },
  };
}
