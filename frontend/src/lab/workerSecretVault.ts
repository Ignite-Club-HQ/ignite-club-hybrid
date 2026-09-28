export type WorkerSecretVaultDecision = {
  approved: boolean;
  reason: string;
  timestamp: bigint;
  value?: string;
};

export function createWorkerSecretVault(options: {
  allowedScopes?: Record<string, string[]>;
  secrets?: Record<string, Record<string, string>>;
} = {}) {
  const allowedScopes = options.allowedScopes ?? {};
  const secrets = options.secrets ?? {};

  return {
    getAllowedScopes(workloadPrincipal: unknown) {
      return allowedScopes[String(workloadPrincipal)] ?? [];
    },

    accessSecret(
      workloadPrincipal: unknown,
      secretScope: string,
      secretName: string
    ): WorkerSecretVaultDecision {
      const principal = String(workloadPrincipal);
      const scopes = allowedScopes[principal] ?? [];

      if (!scopes.includes(secretScope)) {
        return {
          approved: false,
          reason: `Worker ${principal} is not authorized for scope ${secretScope}`,
          timestamp: BigInt(Date.now()),
        };
      }

      const secret = secrets[principal]?.[secretName];
      if (secret === undefined) {
        return {
          approved: false,
          reason: `Secret ${secretName} is not available for workload ${principal}`,
          timestamp: BigInt(Date.now()),
        };
      }

      return {
        approved: true,
        reason: `Secret ${secretName} released to authorized worker`,
        timestamp: BigInt(Date.now()),
        value: secret,
      };
    },
  };
}
