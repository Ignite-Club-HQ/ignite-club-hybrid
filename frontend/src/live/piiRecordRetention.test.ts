import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import type { FeatureBackendContext } from './featureRouter';

const mocks = vi.hoisted(() => ({ rows: vi.fn(), keys: vi.fn(), deserialize: vi.fn() }));
vi.mock('./domains', () => ({
  connectLivePiiAccessControl: async () => ({
    canisterId: Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai'),
    actor: {
      get_encrypted_pii_batch: mocks.rows,
      get_encrypted_pii_vetkeys_batch: mocks.keys,
      pii_vetkey_verification_key: async () => [1],
    },
  }),
}));
vi.mock('./mediaDecrypt', () => ({ clearIcpPhotoResolutionCache: vi.fn() }));
vi.mock('@icp-sdk/vetkeys', () => ({
  DerivedPublicKey: { deserialize: () => 'verification' },
  EncryptedVetKey: { deserialize: () => ({ decryptAndVerify: () => ({ serialize: () => new Uint8Array([7]) }) }) },
  TransportSecretKey: { random: () => ({ publicKeyBytes: () => new Uint8Array([1]) }) },
  VetKey: { deserialize: () => ({ serialize: () => new Uint8Array([7]) }) },
  IbeCiphertext: { deserialize: mocks.deserialize },
  IbeIdentity: {}, IbeSeed: {},
}));
import { resolveLivePiiTextBatch } from './features/vault';
import { clearPiiVetKeyCache } from './piiVetKeys';
import { CLUB_KEY_TTL_MS } from './deviceMediaCache';

const ctx = {
  identity: { getPrincipal: () => Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai') },
  target: { host: 'https://icp-api.io', canisterIds: { pii_access_control: 'rrkah-fqaaa-aaaaa-aaaaq-cai' } },
} as FeatureBackendContext;
const encode = (name: string) => [...new TextEncoder().encode(name)];
const read = (id: string, field: string) => resolveLivePiiTextBatch(ctx, [id], field, 'read_name', 'Display authorized name');

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  clearPiiVetKeyCache();
  vi.clearAllMocks();
  mocks.keys.mockImplementation(async (ids: string[]) => ({ Ok: ids.map(() => [[7]]) }));
  mocks.deserialize.mockImplementation((bytes: Uint8Array) => ({ decrypt: () => bytes }));
});
afterEach(() => { clearPiiVetKeyCache(); localStorage.clear(); vi.useRealTimers(); });

describe('authorized record-name reads with retained device keys', () => {
  it.each([
    ['child-1', 'name'],
    ['guest:event-1:person-1', 'guest_name'],
    ['mvp:event-1', 'name'],
  ])('reuses %s keys after sign-out, but reads changed ciphertext and refuses revoked access', async (id, field) => {
    mocks.rows.mockResolvedValue({ Ok: [{ pii_id: id, ciphertext: encode('Original name') }] });
    expect(await read(id, field)).toEqual(new Map([[id, 'Original name']]));
    expect(mocks.keys).toHaveBeenCalledTimes(1);
    const stored = Object.entries(localStorage).filter(([k]) => !k.startsWith('ignite_pii_verification_key:')).map(([, value]) => value).map(value => JSON.parse(value) as { exp: number });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.exp).toBe(Date.now() + 30 * 24 * 60 * 60 * 1000);

    clearPiiVetKeyCache();
    mocks.rows.mockResolvedValue({ Ok: [{ pii_id: id, ciphertext: encode('Updated name') }] });
    expect(await read(id, field)).toEqual(new Map([[id, 'Updated name']]));
    expect(mocks.rows).toHaveBeenCalledTimes(2);
    expect(mocks.keys).toHaveBeenCalledTimes(1);

    mocks.rows.mockResolvedValue({ Ok: [] });
    expect(await read(id, field)).toEqual(new Map());
    expect(mocks.rows).toHaveBeenCalledTimes(3);
    expect(mocks.deserialize).toHaveBeenCalledTimes(2);

    clearPiiVetKeyCache();
    vi.advanceTimersByTime(CLUB_KEY_TTL_MS + 1);
    mocks.rows.mockResolvedValue({ Ok: [{ pii_id: id, ciphertext: encode('Updated name') }] });
    expect(await read(id, field)).toEqual(new Map([[id, 'Updated name']]));
    expect(mocks.keys).toHaveBeenCalledTimes(2);
  });
});