import { expect, test } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createSecretWorkloadClient } from '../src/lab/secretWorkloadClient';
import type { _SERVICE } from '../src/lab/bindings/secret_workload_identity/declarations/secret_workload_identity.did';

const worker = Principal.fromText('2vxsx-fae');
const mockWorkload = {
  workload_principal: worker,
  workload_name: 'test-worker',
  allowed_scopes: ['send-push-notification'],
  registered_at: 1000n,
  last_used: 0n,
  status: { Active: null },
};

const actor = {
  initialize: async () => ({ Ok: null }),
  register_workload: async () => ({ Ok: mockWorkload }),
  verify_secret_access: async (_p: Principal, scope: string) => {
    if (scope === 'forbidden-scope') return { approved: false, reason: 'unauthorized', timestamp: 1000n };
    return { approved: true, reason: 'authorized', timestamp: 1000n };
  },
  get_workload: async () => ({ Ok: mockWorkload }),
  list_workloads: async () => ([mockWorkload]),
  update_workload_scopes: async () => ({ Ok: mockWorkload }),
  audit_secret_access: async () => ([]),
  revoke_workload: async () => ({ Ok: null }),
  get_audit_summary: async () => ({ total_accesses: 5n, approved: 4n, denied: 1n }),
} as unknown as _SERVICE;

test('secret workload client manages workloads and verifies access decisions', async () => {
  const client = createSecretWorkloadClient(actor);
  await expect(client.initialize()).resolves.toBeNull();
  await expect(client.registerWorkload(worker, 'test-worker', ['send-push-notification'])).resolves.toEqual(mockWorkload);
  await expect(client.verifySecretAccess(worker, 'send-push-notification', 'nonce-1')).resolves.toMatchObject({ approved: true });
  await expect(client.verifySecretAccess(worker, 'forbidden-scope', 'nonce-2')).resolves.toMatchObject({ approved: false });
  await expect(client.getAuditSummary()).resolves.toEqual({ total_accesses: 5n, approved: 4n, denied: 1n });
});

test('disposed secret workload client rejects further calls', async () => {
  const client = createSecretWorkloadClient(actor);
  client.dispose();
  await expect(client.getWorkload(worker)).rejects.toThrow('Identity changed');
});
