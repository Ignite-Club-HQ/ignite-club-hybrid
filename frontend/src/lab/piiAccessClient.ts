import type { _SERVICE, EncryptedPii, DecryptedPii, AuditRecord, AuditFilter, KeyMetadata, KeyRotationResult, PiiDeleteResult } from './bindings/pii_access_control/declarations/pii_access_control.did.js';
import type { Principal } from '@icp-sdk/core/principal';

export type PiiAccessClient = ReturnType<typeof createPiiAccessClient>;

export function createPiiAccessClient(actor: _SERVICE) {
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
    initializeMasterKey: (initialKeyId: string): Promise<string> => unwrap(() => actor.initialize_master_key(initialKeyId)),
    registerPii: (piiId: string, fieldId: string, plaintext: Uint8Array | number[], domainOwner: Principal): Promise<EncryptedPii> =>
      unwrap(() => actor.register_pii(piiId, fieldId, Array.from(plaintext), domainOwner)),
    getEncryptedPii: (piiId: string, fieldId: string): Promise<EncryptedPii> =>
      unwrap(() => actor.get_encrypted_pii(piiId, fieldId)),
    getDecryptedPii: (piiId: string, fieldId: string, operation: string, purpose: string): Promise<DecryptedPii> =>
      unwrap(() => actor.get_decrypted_pii(piiId, fieldId, operation, purpose)),
    deriveMediaKey: (childId: string, authorizer: Principal, purpose: string, expirySeconds: bigint): Promise<Uint8Array | number[]> =>
      unwrap(() => actor.derive_media_key(childId, authorizer, purpose, expirySeconds)),
    deletePii: (piiId: string, fieldId: string): Promise<PiiDeleteResult> =>
      unwrap(() => actor.delete_pii(piiId, fieldId)),
    auditAccess: async (filter: AuditFilter): Promise<AuditRecord[]> => {
      live();
      const logs = await actor.audit_access(filter);
      live();
      return logs;
    },
    rotateKey: (newKeyId: string): Promise<KeyRotationResult> =>
      unwrap(() => actor.rotate_key(newKeyId)),
    getKeyMetadata: async (): Promise<KeyMetadata[]> => {
      live();
      const meta = await actor.get_key_metadata();
      live();
      return meta;
    },
    emergencyShutdown: (): Promise<null> =>
      unwrap(() => actor.emergency_shutdown()),
    dispose() { disposed = true; },
  };
}
