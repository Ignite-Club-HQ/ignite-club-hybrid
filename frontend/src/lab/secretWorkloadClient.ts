import type { _SERVICE, WorkloadIdentity, SecretAccessResult, SecretAccessAudit, WorkloadIdentityFilter, AuditSummary } from './bindings/secret_workload_identity/declarations/secret_workload_identity.did.js';
import type { Principal } from '@icp-sdk/core/principal';

export type SecretWorkloadClient = ReturnType<typeof createSecretWorkloadClient>;

export function createSecretWorkloadClient(actor: _SERVICE) {
  let disposed = false;
  const live = () => { if (disposed) throw new Error('Identity changed; operation discarded'); };

  const unwrap = async <T>(operation: () => Promise<{ Ok: T } | { Err: string }>): Promise<T> => {
    live();
    const result = await operation();
    live();
    if ('Err' in result) throw new Error(result.Err);
    return result.Ok;
  };

  return {
    initialize: (): Promise<null> => unwrap(() => actor.initialize()),
    registerWorkload: (workloadPrincipal: Principal, workloadName: string, allowedScopes: string[]): Promise<WorkloadIdentity> =>
      unwrap(() => actor.register_workload(workloadPrincipal, workloadName, allowedScopes)),
    verifySecretAccess: async (workloadPrincipal: Principal, secretScope: string, nonce: string): Promise<SecretAccessResult> => {
      live();
      const res = await actor.verify_secret_access(workloadPrincipal, secretScope, nonce);
      live();
      return res;
    },
    getWorkload: (workloadPrincipal: Principal): Promise<WorkloadIdentity> =>
      unwrap(() => actor.get_workload(workloadPrincipal)),
    listWorkloads: async (): Promise<WorkloadIdentity[]> => {
      live();
      const list = await actor.list_workloads();
      live();
      return list;
    },
    updateWorkloadScopes: (workloadPrincipal: Principal, allowedScopes: string[]): Promise<WorkloadIdentity> =>
      unwrap(() => actor.update_workload_scopes(workloadPrincipal, allowedScopes)),
    auditSecretAccess: async (filter: WorkloadIdentityFilter): Promise<SecretAccessAudit[]> => {
      live();
      const logs = await actor.audit_secret_access(filter);
      live();
      return logs;
    },
    revokeWorkload: (workloadPrincipal: Principal): Promise<null> =>
      unwrap(() => actor.revoke_workload(workloadPrincipal)),
    getAuditSummary: async (): Promise<AuditSummary> => {
      live();
      const summary = await actor.get_audit_summary();
      live();
      return summary;
    },
    dispose() { disposed = true; },
  };
}
