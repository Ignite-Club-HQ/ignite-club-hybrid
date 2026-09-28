import { expect, test } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createPiiAccessClient } from '../src/lab/piiAccessClient';
import type { _SERVICE } from '../src/lab/bindings/pii_access_control/declarations/pii_access_control.did';

const owner = Principal.fromText('2vxsx-fae');
const mockEncrypted = {
  pii_id: 'user-001',
  field_id: 'email',
  ciphertext: [1, 2, 3],
  nonce: [4, 5, 6, 7],
  master_key_id: 'master-key-2026-09-13',
};
const mockDecrypted = {
  pii_id: 'user-001',
  field_id: 'email',
  plaintext: [116, 101, 115, 116], // "test"
};

const actor = {
  initialize_master_key: async (key: string) => ({ Ok: key }),
  register_pii: async () => ({ Ok: mockEncrypted }),
  get_encrypted_pii: async () => ({ Ok: mockEncrypted }),
  get_decrypted_pii: async (_pii: string, _field: string, op: string) => {
    if (op === 'forbidden') return { Err: 'Access denied to PII field' };
    return { Ok: mockDecrypted };
  },
  derive_media_key: async () => ({ Ok: [10, 20, 30, 40, 50, 60] }),
  delete_pii: async () => ({ Ok: { shredded_at: 1000n, key_destroyed: true } }),
  audit_access: async () => ([]),
  rotate_key: async (newKey: string) => ({ Ok: { rotated_at: 2000n, old_key_id: 'old', new_key_id: newKey } }),
  get_key_metadata: async () => ([]),
  emergency_shutdown: async () => ({ Ok: null }),
} as unknown as _SERVICE;

test('pii access client handles registration, decryption, and cryptographic erasure', async () => {
  const client = createPiiAccessClient(actor);
  await expect(client.initializeMasterKey('test-key')).resolves.toBe('test-key');
  await expect(client.registerPii('user-001', 'email', new Uint8Array([1, 2]), owner)).resolves.toEqual(mockEncrypted);
  await expect(client.getEncryptedPii('user-001', 'email')).resolves.toEqual(mockEncrypted);
  await expect(client.getDecryptedPii('user-001', 'email', 'read', 'test')).resolves.toEqual(mockDecrypted);
  await expect(client.getDecryptedPii('user-001', 'email', 'forbidden', 'test')).rejects.toThrow('Access denied');
  await expect(client.deletePii('user-001', 'email')).resolves.toEqual({ shredded_at: 1000n, key_destroyed: true });
});

test('disposed pii access client rejects further operations', async () => {
  const client = createPiiAccessClient(actor);
  client.dispose();
  await expect(client.getEncryptedPii('user-001', 'email')).rejects.toThrow('Identity changed');
});
