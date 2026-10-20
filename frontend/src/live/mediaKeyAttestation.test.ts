import { describe, expect, it, vi } from 'vitest';
import { attestOriginalMediaKey } from './mediaKeyAttestation';
function fixture(name = 'key_1') {
  const binding = { deploymentId: 'd', canister: { toText: () => 'original' } };
  const d = { readModuleHash: vi.fn(async () => 'a'.repeat(64)), originalVerificationKey: vi.fn(async () => new Uint8Array(96).fill(1)),
    vetkdPublicKey: vi.fn(async (args: { key_id: { name: string } }) => ({ public_key: new Uint8Array(96).fill(args.key_id.name === name ? 1 : 2) })),
    save: vi.fn(async () => {}) };
  return { binding, d };
}
describe('pre-upgrade original vetKD key attestation', () => {
  it.each(['key_1', 'test_key_1'])('identifies the actual %s key rather than assuming production default', async name => {
    const f = fixture(name); const result = await attestOriginalMediaKey(f.binding, f.d);
    expect(result.keyName).toBe(name); expect(result.publicKeyHex).toBe('01'.repeat(96));
    expect(f.d.vetkdPublicKey.mock.calls[0][0]).toMatchObject({ canister_id: [f.binding.canister], context: new TextEncoder().encode('ignite-pii-v1') });
    expect(f.d.save).toHaveBeenCalledWith(result);
  });
  it('rejects unknown and ambiguous derivation keys without saving', async () => {
    const f = fixture(); f.d.vetkdPublicKey.mockResolvedValue({ public_key: new Uint8Array(96).fill(3) });
    await expect(attestOriginalMediaKey(f.binding, f.d)).rejects.toThrow('unknown'); expect(f.d.save).not.toHaveBeenCalled();
    f.d.vetkdPublicKey.mockResolvedValue({ public_key: new Uint8Array(96).fill(1) });
    await expect(attestOriginalMediaKey(f.binding, f.d)).rejects.toThrow('ambiguous');
  });
  it('rejects an upgrade during the read interval', async () => {
    const f = fixture(); f.d.readModuleHash.mockResolvedValueOnce('a'.repeat(64)).mockResolvedValueOnce('b'.repeat(64));
    await expect(attestOriginalMediaKey(f.binding, f.d)).rejects.toThrow('changed'); expect(f.d.save).not.toHaveBeenCalled();
  });
  it('does not report attestation if durable saving fails', async () => {
    const f = fixture(); f.d.save.mockRejectedValue(new Error('disk'));
    await expect(attestOriginalMediaKey(f.binding, f.d)).rejects.toThrow('disk');
  });
});