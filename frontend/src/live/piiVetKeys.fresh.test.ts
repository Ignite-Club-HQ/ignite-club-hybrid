import { beforeEach, describe, expect, it, vi } from "vitest";
import { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "./featureRouter";
const mocks = vi.hoisted(() => ({ keys: vi.fn(), scopedKeys:vi.fn(), load: vi.fn(), store: vi.fn(), decrypt: vi.fn(), publicKey: vi.fn(), clearPhotos: vi.fn(), wipeKeys: vi.fn() }));
vi.mock("./domains", () => ({ connectLivePiiAccessControl: async () => ({ canisterId: Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai"), actor: { get_encrypted_pii_vetkeys_batch: mocks.keys, get_private_profile_name_vetkeys_batch:mocks.scopedKeys, pii_vetkey_verification_key: mocks.publicKey } }) }));
vi.mock("./deviceMediaCache", () => ({ loadStoredClubKey: mocks.load, storeClubKey: mocks.store, forgetStoredClubKey: vi.fn(), clearDeviceMediaCaches: vi.fn(), clearDeviceCachedPhotos: mocks.clearPhotos, clearStoredDeviceKeys: mocks.wipeKeys }));
vi.mock("./mediaDecrypt", () => ({ clearIcpPhotoResolutionCache: vi.fn() }));
vi.mock("@icp-sdk/vetkeys", () => ({ DerivedPublicKey: { deserialize: () => "public" }, EncryptedVetKey: { deserialize: () => ({ decryptAndVerify: mocks.decrypt }) }, TransportSecretKey: { random: () => ({ publicKeyBytes: () => new Uint8Array([1]) }) }, VetKey: { deserialize: () => "stored" }, IbeCiphertext: {}, IbeIdentity: {}, IbeSeed: {} }));
import { fetchPiiVetKeys, clearPiiVetKeyCache } from "./piiVetKeys";
const ctx = { identity: { getPrincipal: () => Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai") }, target: { host: "https://icp-api.io", canisterIds: { pii_access_control: "rrkah-fqaaa-aaaaa-aaaaq-cai" } } } as FeatureBackendContext;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockReturnValue(new Uint8Array([1]));
  mocks.publicKey.mockResolvedValue([1]);
  mocks.keys.mockImplementation(async ids => ({ Ok: ids.map(() => [[1]]) }));
  mocks.decrypt.mockReturnValue("fresh-key");
});
describe("fresh private profile keys", () => {
  it('forces fresh scoped name keys without loading/storing media keys',async()=>{
    const audience={kind:'guardian_search' as const,authority:Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai'),resource:'child-1',profile_revision:7n};
    mocks.scopedKeys.mockResolvedValue({Ok:[[[1]]]});
    expect(await fetchPiiVetKeys(ctx,['private-subject'],'display_name',{audience})).toEqual(new Map([['private-subject','fresh-key']]));
    expect(mocks.scopedKeys).toHaveBeenCalledWith(['private-subject'],audience,new Uint8Array([1]));
    expect(mocks.keys).not.toHaveBeenCalled();expect(mocks.load).not.toHaveBeenCalled();expect(mocks.store).not.toHaveBeenCalled();
  });
  it('does not permit a guardian name audience to unlock contact email',async()=>{
    await expect(fetchPiiVetKeys(ctx,['private-subject'],'contact_email',{audience:{kind:'guardian_search',authority:Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai'),resource:'child-1',profile_revision:7n}})).rejects.toThrow('another field');
    expect(mocks.scopedKeys).not.toHaveBeenCalled(); expect(mocks.keys).not.toHaveBeenCalled();
  });
  it("ignores retained device keys and never stores newly delivered keys", async () => {
    expect(await fetchPiiVetKeys(ctx, ["fresh-one"], "display_name", { fresh: true })).toEqual(new Map([["fresh-one", "fresh-key"]]));
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.store).not.toHaveBeenCalled();
    mocks.keys.mockResolvedValue({ Ok: [[]] });
    expect(await fetchPiiVetKeys(ctx, ["fresh-one"], "display_name", { fresh: true })).toEqual(new Map());
    expect(mocks.keys).toHaveBeenCalledTimes(2);
  });
  it("deduplicates and enforces the 25-key relay ceiling", async () => {
    const ids = Array.from({ length: 26 }, (_, i) => `subject-${i}`);
    await fetchPiiVetKeys(ctx, [...ids, ids[0]], "display_name", { fresh: true });
    expect(mocks.keys.mock.calls.map(call => call[0].length)).toEqual([25, 1]);
  });
  it("refuses a truncated key reply instead of returning a partial authorized result", async () => {
    mocks.keys.mockResolvedValue({ Ok: [] });
    await expect(fetchPiiVetKeys(ctx, ["truncated"], "display_name", { fresh: true })).rejects.toThrow("length");
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it("checks cancellation after key delivery before decrypting or caching", async () => {
    let active = true;
    mocks.keys.mockImplementation(async () => { active = false; return { Ok: [[[1]]] }; });
    await expect(fetchPiiVetKeys(ctx, ["cancelled"], "display_name", { fresh: true, assertActive: () => { if (!active) throw new Error("retired"); } })).rejects.toThrow("retired");
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
});