import { beforeEach, describe, expect, it, vi } from "vitest";
import { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "./featureRouter";

const mocks = vi.hoisted(() => ({ register: vi.fn(), read: vi.fn(), scopedRead: vi.fn(), keys: vi.fn(), clubKey: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn(), rehearsal: vi.fn(), refresh: vi.fn(), lifecycleRead: vi.fn() }));
vi.mock('./privateProfileSearchMode', () => ({ privateProfileSearchRehearsalEnabled: mocks.rehearsal }));
vi.mock("./domains", () => ({ connectLivePiiAccessControl: vi.fn(async () => ({ actor: { register_pii: mocks.register, get_encrypted_pii_batch: mocks.read, get_private_profile_names_batch: mocks.scopedRead, refresh_private_club_name_lifecycle: mocks.refresh, read_private_club_name_lifecycle: mocks.lifecycleRead } })) }));
vi.mock("./piiVetKeys", () => ({ encryptPiiText: mocks.encrypt, fetchPiiVetKeys: mocks.keys, fetchClubNameVetKey: mocks.clubKey, clubNamePiiId: (id: string) => `clubnames:${id}`, CLUB_NAME_SCHEME_PREFIX: 'vetkey-club-names-v1:' }));
vi.mock("@icp-sdk/vetkeys", () => ({ IbeCiphertext: { deserialize: () => ({ decrypt: mocks.decrypt }) } }));

import { hydratePrivateProfileNames, readPrivateOwnProfileName, preparePrivateOwnProfileName, privateProfileNameReference, refreshPrivateOwnClubNames } from "./privateProfileNames";
import { retirePrivateProfileSession } from './privateProfileSession';

const subject = "mbrvi-lvde7-gdspi-hamp3-nxj43-p4tt6-at6q5-jlbit-eehve-7xqwc-wqe";
const authority = "rrkah-fqaaa-aaaaa-aaaaq-cai";
const ctx = { identity: { getPrincipal: () => Principal.fromText(subject) }, target: { host: "https://icp-api.io", canisterIds: { pii_access_control: authority } } } as FeatureBackendContext;
const reference = privateProfileNameReference(authority, subject);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.encrypt.mockResolvedValue(new Uint8Array([9, 8]));
  mocks.register.mockResolvedValue({ Ok: {} });
  mocks.read.mockResolvedValue({ Ok: [{ pii_id: subject, field_id: "display_name", ciphertext: [9, 8] }] });
  mocks.keys.mockResolvedValue(new Map([[subject, "authorized-key"]]));
  mocks.decrypt.mockReturnValue(new TextEncoder().encode("Paul Cranwell"));
  mocks.rehearsal.mockReturnValue(false);
  mocks.refresh.mockResolvedValue({ Ok: null });
  mocks.lifecycleRead.mockImplementation(async (_, club) => ({ Ok: [{ pii_id: subject, field_id: 'display_name', master_key_id: `vetkey-club-names-v1:${club}`, ciphertext: [9, 8] }] }));
});

describe('essential own-name copy maintenance', () => {
  const ctx = { identity: { getPrincipal: () => Principal.fromText(subject) }, target: { host: 'http://localhost:4943', canisterIds: { pii_access_control: authority } } } as FeatureBackendContext;
  const discover = () => Promise.resolve(['club-1', 'club-1', 'club-2']);
  const enable = () => {
    mocks.rehearsal.mockReturnValue(true);
    mocks.read.mockResolvedValue({ Ok: [{ pii_id: subject, field_id: 'display_name', ciphertext: [9, 8], master_key_id: 'vetkey-ibe-v1' }] });
  };
  it('keeps production unchanged without even starting club discovery', async () => {
    const clubs = vi.fn(discover);
    await refreshPrivateOwnClubNames(ctx, 'Paul Cranwell', clubs);
    expect(clubs).not.toHaveBeenCalled();expect(mocks.read).not.toHaveBeenCalled();expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('refreshes each club once against exact original bytes and verifies all copies', async () => {
    enable();await refreshPrivateOwnClubNames(ctx, ' Paul Cranwell ', discover);
    expect(mocks.refresh.mock.calls).toEqual([
      [Principal.fromText(subject), 'club-1', new Uint8Array([9, 8]), new Uint8Array([9, 8])],
      [Principal.fromText(subject), 'club-2', new Uint8Array([9, 8]), new Uint8Array([9, 8])],
    ]);
    expect(mocks.lifecycleRead).toHaveBeenCalledTimes(2);
    expect(mocks.lifecycleRead).toHaveBeenCalledWith(Principal.fromText(subject), 'club-1', [new Uint8Array([9, 8])]);
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it('stops before replica writes when original plaintext differs', async () => {
    enable();mocks.decrypt.mockReturnValue(new TextEncoder().encode('Newer name'));
    await expect(refreshPrivateOwnClubNames(ctx, 'Paul Cranwell', discover)).rejects.toThrow('Original private name changed');expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('propagates unavailable club discovery without original or replica writes', async () => {
    enable();await expect(refreshPrivateOwnClubNames(ctx, 'Paul Cranwell', async () => { throw Error('Membership unavailable'); })).rejects.toThrow('Membership unavailable');expect(mocks.read).not.toHaveBeenCalled();expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('rejects target drift during discovery before writes', async () => {
    enable();const changed = { ...ctx, target: { ...ctx.target, canisterIds: { ...ctx.target.canisterIds } } };
    await expect(refreshPrivateOwnClubNames(changed, 'Paul Cranwell', async () => { changed.target.canisterIds.pii_access_control = 'ryjl3-tyaaa-aaaaa-aaaba-cai';return ['club-1']; })).rejects.toThrow('maintenance changed');expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('stops on session retirement during discovery', async () => {
    enable();await expect(refreshPrivateOwnClubNames(ctx, 'Paul Cranwell', async () => { retirePrivateProfileSession();return ['club-1']; })).rejects.toThrow('session retired');expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it.each(['Unknown commit', 'Original name changed', 'Names not released'])('does not replay or continue after %s', async message => {
    enable();mocks.refresh.mockRejectedValueOnce(Error(message));await expect(refreshPrivateOwnClubNames(ctx, 'Paul Cranwell', discover)).rejects.toThrow(message);expect(mocks.refresh).toHaveBeenCalledOnce();expect(mocks.lifecycleRead).not.toHaveBeenCalled();
  });
  it('refuses missing or changed closing readback after writes', async () => {
    enable();mocks.lifecycleRead.mockResolvedValueOnce({ Ok: [] });await expect(refreshPrivateOwnClubNames(ctx, 'Paul Cranwell', discover)).rejects.toThrow('readback mismatch');expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });
  it('bounds destinations before any crypto or replica mutation', async () => {
    enable();await expect(refreshPrivateOwnClubNames(ctx, 'Paul Cranwell', async () => Array(101).fill('club'))).rejects.toThrow('Bounded exact');expect(mocks.encrypt).not.toHaveBeenCalled();expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('refuses remote writes even when the frontend rehearsal switch is enabled', async () => {
    enable();const discover = vi.fn(async () => ['club-1']);
    await expect(refreshPrivateOwnClubNames({ ...ctx, target: { ...ctx.target, host: 'https://icp-api.io' } }, 'Paul Cranwell', discover)).rejects.toThrow('loopback rehearsal target');expect(discover).not.toHaveBeenCalled();expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('retains the save session across preparation and maintenance entry', async () => {
    enable();const { capturePrivateProfileSession } = await import('./privateProfileSession');const saveActive = capturePrivateProfileSession();retirePrivateProfileSession();const discover = vi.fn(async () => ['club-1']);
    await expect(refreshPrivateOwnClubNames(ctx, 'Paul Cranwell', discover, saveActive)).rejects.toThrow('session retired');expect(discover).not.toHaveBeenCalled();expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('stops before verification when session retires during final write', async () => {
    enable();mocks.refresh.mockImplementationOnce(async () => { retirePrivateProfileSession();return { Ok: null }; });await expect(refreshPrivateOwnClubNames(ctx, 'Paul Cranwell', async () => ['club-1'])).rejects.toThrow('session retired');expect(mocks.lifecycleRead).not.toHaveBeenCalled();
  });
});

describe("private profile name preparation", () => {
  it("encrypts only the caller's own name and confirms decrypted readback", async () => {
    expect(await preparePrivateOwnProfileName(ctx, " Paul Cranwell ")).toBe(reference);
    expect(mocks.encrypt).toHaveBeenCalledWith(ctx, subject, "display_name", "Paul Cranwell");
    expect(mocks.register).toHaveBeenCalledWith(subject, "display_name", new Uint8Array([9, 8]), Principal.fromText(subject));
  });
  it("does not acknowledge or replay an unknown private write", async () => {
    mocks.register.mockRejectedValue(new Error("Unknown reply"));
    await expect(preparePrivateOwnProfileName(ctx, "Paul Cranwell")).rejects.toThrow("Unknown reply");
    expect(mocks.register).toHaveBeenCalledOnce();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("refuses preparation without exact readback", async () => {
    mocks.decrypt.mockReturnValue(new TextEncoder().encode("Different name"));
    await expect(preparePrivateOwnProfileName(ctx, "Paul Cranwell")).rejects.toThrow("readback");
  });
  it("rejects anonymous ownership before encryption", async () => {
    await expect(preparePrivateOwnProfileName({ ...ctx, identity: { getPrincipal: () => Principal.anonymous() } } as FeatureBackendContext, "Paul")).rejects.toThrow("identity");
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });
  it("does not register ciphertext if the key authority changes during encryption", async () => {
    const changed = { ...ctx, target: { ...ctx.target, canisterIds: { ...ctx.target.canisterIds } } };
    mocks.encrypt.mockImplementation(async () => { changed.target.canisterIds.pii_access_control = "ryjl3-tyaaa-aaaaa-aaaba-cai"; return new Uint8Array([1]); });
    await expect(preparePrivateOwnProfileName(changed, "Paul")).rejects.toThrow("authority changed");
    expect(mocks.register).not.toHaveBeenCalled();
  });
});

describe("authorized name display", () => {
  it('allows a cold own-name key unlock beyond the six-second enrichment deadline', async () => {
    vi.useFakeTimers();
    try {
      mocks.keys.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(new Map([[subject, 'authorized-key']])), 7000)));
      const pending = readPrivateOwnProfileName(ctx, reference);
      await vi.advanceTimersByTimeAsync(7000);
      expect(await pending).toBe('Paul Cranwell');
      expect(mocks.keys).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it('reports an own-name denial without replacing the saved reference or retrying writes', async () => {
    mocks.read.mockResolvedValue({ Err: 'Access denied' });
    await expect(readPrivateOwnProfileName(ctx, reference)).rejects.toThrow('Access denied');
    expect(mocks.keys).not.toHaveBeenCalled(); expect(mocks.register).not.toHaveBeenCalled();
  });
  it('never guesses a different original authority for an own-name unlock', async () => {
    await expect(readPrivateOwnProfileName(ctx, privateProfileNameReference('ryjl3-tyaaa-aaaaa-aaaba-cai', subject))).rejects.toThrow('authority');
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('retires a stalled own-name read at thirty seconds and prevents late key derivation', async () => {
    vi.useFakeTimers();
    try {
      let release: (value: unknown) => void = () => {};
      mocks.read.mockImplementation(() => new Promise(resolve => { release = resolve; }));
      const pending = readPrivateOwnProfileName(ctx, reference);
      const rejected = expect(pending).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(30000); await rejected;
      release({ Ok: [{ pii_id: subject, field_id: 'display_name', ciphertext: [9] }] });
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.keys).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('uses one shared key for club rows and rechecks the exact ciphertext after decryption', async () => {
    const audience = { kind: 'club' as const, authority: Principal.fromText(authority), resource: 'club-1', profile_revision: 0n };
    mocks.scopedRead.mockResolvedValue({ Ok: [{ pii_id: subject, field_id: 'display_name', ciphertext: [9], master_key_id: 'vetkey-club-names-v1:club-1' }] });
    mocks.clubKey.mockResolvedValue('club-key');
    expect((await hydratePrivateProfileNames(ctx, [{ display_name: reference }], { audience }))[0].display_name).toBe('Paul Cranwell');
    expect(mocks.keys).not.toHaveBeenCalled();
    expect(mocks.clubKey).toHaveBeenCalledWith(ctx, [subject], audience, expect.any(Function));
    expect(mocks.scopedRead).toHaveBeenCalledTimes(2);
  });
  it('withholds a cached-key name when closing club membership is denied', async () => {
    const audience = { kind: 'club' as const, authority: Principal.fromText(authority), resource: 'club-1', profile_revision: 0n };
    mocks.scopedRead.mockResolvedValueOnce({ Ok: [{ pii_id: subject, field_id: 'display_name', ciphertext: [9], master_key_id: 'vetkey-club-names-v1:club-1' }] }).mockResolvedValueOnce({ Err: 'Membership removed' });
    mocks.clubKey.mockResolvedValue('cached-club-key');
    await expect(hydratePrivateProfileNames(ctx, [{ display_name: reference }], { audience })).rejects.toThrow('Membership removed');
  });
  it.each(['family', 'competition', 'guardian_search'] as const)('rejects a shared club ciphertext in a %s audience', async kind => {
    mocks.scopedRead.mockResolvedValue({ Ok: [{ pii_id: subject, field_id: 'display_name', ciphertext: [9], master_key_id: 'vetkey-club-names-v1:club-1' }] });
    await expect(hydratePrivateProfileNames(ctx, [{ display_name: reference }], { audience: { kind, authority: Principal.fromText(authority), resource: 'club-1', profile_revision: 0n } })).rejects.toThrow('key scope');
    expect(mocks.clubKey).not.toHaveBeenCalled();
  });
  it('rejects a held read when the global session retires with its old context unchanged', async () => {
    let release: (value: unknown) => void = () => {};
    mocks.read.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = hydratePrivateProfileNames(ctx, [{ display_name: reference }]);
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalled());
    retirePrivateProfileSession();
    release({ Ok: [{ pii_id: subject, field_id: 'display_name', ciphertext: [9] }] });
    await expect(pending).rejects.toThrow('session retired');
    expect(mocks.keys).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it.each(['club', 'family', 'competition', 'league', 'guardian_search'] as const)('withholds %s names when final authority confirmation changes after decryption', async kind => {
    const audience = { kind, authority: Principal.fromText(authority), resource: 'exact-resource', profile_revision: 7n };
    mocks.scopedRead.mockResolvedValue({ Ok: [{ pii_id: subject, field_id: 'display_name', ciphertext: [9] }] });
    let release: (() => void) | undefined;
    let drifted = false;
    const confirm = vi.fn(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      if (drifted) throw new Error('Original authority inventory changed');
    });
    const pending = hydratePrivateProfileNames(ctx, [{ display_name: reference }], {
      audience, resolveAuthority: async () => ({ context: ctx, confirm }),
    });
    const rejected = expect(pending).rejects.toThrow('Original authority inventory changed');
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(mocks.decrypt).toHaveBeenCalled();
    drifted = true;
    release?.();
    await rejected;
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each(['club', 'family', 'competition', 'league', 'guardian_search'] as const)('carries exact %s audience to ciphertext and fresh-key reads without generic fallback', async kind => {
    const audience = {kind,authority:Principal.fromText(authority),resource:'child-1',profile_revision:7n};
    mocks.scopedRead.mockResolvedValue({Ok:[{pii_id:subject,field_id:'display_name',ciphertext:[9,8]}]});
    expect((await hydratePrivateProfileNames(ctx,[{display_name:reference}],{audience}))[0].display_name).toBe('Paul Cranwell');
    expect(mocks.scopedRead).toHaveBeenCalledWith([subject],audience);
    expect(mocks.keys).toHaveBeenCalledWith(ctx,[subject],'display_name',{fresh:true,assertActive:expect.any(Function),audience});
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.register).not.toHaveBeenCalled();
  });
  it('refuses denied audience reads rather than reporting an empty successful search', async()=>{
    mocks.scopedRead.mockResolvedValue({Err:'Guardian removed'});
    await expect(hydratePrivateProfileNames(ctx,[{display_name:reference}],{audience:{kind:'guardian_search',authority:Principal.fromText(authority),resource:'child-1',profile_revision:7n}})).rejects.toThrow('Guardian removed');
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.keys).not.toHaveBeenCalled();
  });
  it('refuses missing original-authority evidence in scoped search',async()=>{
    const foreign=privateProfileNameReference('ryjl3-tyaaa-aaaaa-aaaba-cai',subject);
    await expect(hydratePrivateProfileNames(ctx,[{display_name:foreign}],{audience:{kind:'club',authority:Principal.fromText(authority),resource:'club-1',profile_revision:0n}})).rejects.toThrow('unverified');
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("does not display a private reference belonging to a different returned principal", async () => {
    expect(await hydratePrivateProfileNames(ctx, [{ principal: Principal.fromText(authority), display_name: reference }])).toEqual([{principal:Principal.fromText(authority),display_name:null}]);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each([
    [{pii_id:authority,field_id:"display_name",ciphertext:[9]}],
    [{pii_id:subject,field_id:"email",ciphertext:[9]}],
    [{pii_id:subject,field_id:"display_name",ciphertext:[9]},{pii_id:subject,field_id:"display_name",ciphertext:[9]}],
  ])("refuses foreign, wrong-field and duplicated encrypted records", async rows => {
    mocks.read.mockResolvedValue({Ok:rows});
    expect(await hydratePrivateProfileNames(ctx,[{display_name:reference}])).toEqual([{display_name:null}]);
    expect(mocks.keys).not.toHaveBeenCalled();
  });
  it("leaves legacy names and avatars intact without network work", async () => {
    const row = { display_name: "Paul Cranwell", avatar_ref: ["avatar"] };
    expect(await hydratePrivateProfileNames(ctx, [row])).toEqual([row]);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("deduplicates private names and preserves each row's metadata", async () => {
    expect(await hydratePrivateProfileNames(ctx, [{ id: "one", display_name: reference }, { id: "two", display_name: reference }])).toEqual([
      { id: "one", display_name: "Paul Cranwell" }, { id: "two", display_name: "Paul Cranwell" },
    ]);
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(mocks.read.mock.calls[0][0]).toEqual([subject]);
    expect(mocks.keys).toHaveBeenCalledWith(ctx, [subject], "display_name", { fresh: true, assertActive: expect.any(Function) });
  });
  it("never substitutes another group's PII authority", async () => {
    const foreign = privateProfileNameReference("ryjl3-tyaaa-aaaaa-aaaba-cai", subject);
    expect(await hydratePrivateProfileNames(ctx, [{ display_name: foreign }])).toEqual([{ display_name: null }]);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("keeps unreadable private names neutral without exposing their reference", async () => {
    mocks.keys.mockResolvedValue(new Map());
    expect(await hydratePrivateProfileNames(ctx, [{ display_name: reference }])).toEqual([{ display_name: null }]);
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it("does not reuse another account's decrypted results", async () => {
    await hydratePrivateProfileNames(ctx, [{ display_name: reference }]);
    mocks.read.mockResolvedValue({ Ok: [] });
    const other = { ...ctx, identity: { getPrincipal: () => Principal.fromText(authority) } } as FeatureBackendContext;
    expect(await hydratePrivateProfileNames(other, [{ display_name: reference }])).toEqual([{ display_name: null }]);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });
  it("bounds stalled reads and discards late decryption without caching", async () => {
    vi.useFakeTimers();
    try {
      mocks.read.mockReturnValue(new Promise(() => {}));
      const pending = hydratePrivateProfileNames(ctx, [{ display_name: reference }]);
      await vi.advanceTimersByTimeAsync(6000);
      expect(await pending).toEqual([{ display_name: null }]);
    } finally { vi.useRealTimers(); }
  });
  it("never renders a malformed or future-version private reference", async () => {
    expect(await hydratePrivateProfileNames(ctx, [{ display_name: "pii-display-name:v2:secret" }])).toEqual([{ display_name: null }]);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});


describe("original-authority display rehearsal", () => {
  const foreignAuthority = "ryjl3-tyaaa-aaaaa-aaaba-cai";
  const foreignReference = privateProfileNameReference(foreignAuthority, subject);
  const lease = (confirm = vi.fn(async () => {})) => ({ context: { ...ctx, target: { ...ctx.target, canisterIds: { ...ctx.target.canisterIds, pii_access_control: foreignAuthority } } }, confirm });

  it('does not attach an authorized name to a row mutated during the read', async () => {
    const rows = [{ principal: Principal.fromText(subject), display_name: reference }];
    mocks.read.mockImplementation(async () => {
      rows[0].principal = Principal.fromText(authority);
      rows[0].display_name = 'Replaced row';
      return { Ok: [{ pii_id: subject, field_id: 'display_name', ciphertext: [9] }] };
    });
    const result = await hydratePrivateProfileNames(ctx, rows);
    expect(result[0].principal.toText()).toBe(subject);
    expect(result[0].display_name).toBe('Paul Cranwell');
    expect(rows[0].principal.toText()).toBe(authority);
  });

  it('withholds decrypted names if the resolver route mutates during closing confirmation', async () => {
    const route = lease();
    route.confirm = async () => { route.context.target.canisterIds.pii_access_control = authority; };
    expect(await hydratePrivateProfileNames(ctx, [{ display_name: foreignReference }], { resolveAuthority: async () => route })).toEqual([{ display_name: null }]);
    expect(mocks.decrypt).toHaveBeenCalled();
  });

  it('shares one pending original-authority lease across concurrent subject batches', async () => {
    const rows = Array.from({ length: 26 }, (_, i) => ({ display_name: privateProfileNameReference(foreignAuthority, Principal.fromUint8Array(new Uint8Array([i + 1, 2])).toText()) }));
    const route = lease();
    const resolveAuthority = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 1)); return route; });
    mocks.scopedRead.mockImplementation(async ids => ({ Ok: ids.map(id => ({ pii_id: id, field_id: 'display_name', ciphertext: [9] })) }));
    mocks.keys.mockImplementation(async (_, ids) => new Map(ids.map(id => [id, 'key'])));
    const result = await hydratePrivateProfileNames(ctx, rows, { resolveAuthority, audience: { kind: 'club', authority: Principal.fromText(authority), resource: 'club-1', profile_revision: 0n } });
    expect(result).toHaveLength(26);
    expect(resolveAuthority).toHaveBeenCalledOnce();
    expect(route.confirm).toHaveBeenCalledOnce();
  });

  it('retires sibling ciphertext work when one scoped batch is refused', async () => {
    const rows = Array.from({ length: 26 }, (_, i) => ({ display_name: privateProfileNameReference(authority, Principal.fromUint8Array(new Uint8Array([i + 1, 2])).toText()) }));
    let release: (value: unknown) => void = () => {};
    mocks.scopedRead.mockResolvedValueOnce({ Err: 'Membership revoked' }).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    await expect(hydratePrivateProfileNames(ctx, rows, { audience: { kind: 'club', authority: Principal.fromText(authority), resource: 'club-1', profile_revision: 0n } })).rejects.toThrow('Membership revoked');
    release({ Ok: [{ pii_id: Principal.fromUint8Array(new Uint8Array([26, 2])).toText(), field_id: 'display_name', ciphertext: [9] }] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocks.keys).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it("decrypts through the verified original authority and confirms it after unlocking", async () => {
    const route = lease(); const resolveAuthority = vi.fn(async () => route);
    expect(await hydratePrivateProfileNames(ctx, [{ display_name: foreignReference }], { resolveAuthority })).toEqual([{ display_name: "Paul Cranwell" }]);
    expect(resolveAuthority).toHaveBeenCalledWith(foreignAuthority);
    expect(mocks.keys).toHaveBeenCalledWith(route.context, [subject], "display_name", { fresh: true, assertActive: expect.any(Function) });
    expect(route.confirm).toHaveBeenCalledOnce();
  });
  it("keeps names isolated by original authority even when subject identifiers match", async () => {
    const resolveAuthority = vi.fn(async id => id === authority ? { context: ctx, confirm: async () => {} } : lease());
    mocks.keys.mockImplementation(async route => new Map([[subject, route.target.canisterIds.pii_access_control]]));
    mocks.decrypt.mockImplementation(key => new TextEncoder().encode(key === authority ? "Original name" : "Other name"));
    expect(await hydratePrivateProfileNames(ctx, [{ display_name: reference }, { display_name: foreignReference }], { resolveAuthority })).toEqual([{ display_name: "Original name" }, { display_name: "Other name" }]);
  });
  it("withholds already decrypted names when the closing inventory check refuses", async () => {
    const route = lease(vi.fn(async () => { throw new Error("drift"); }));
    expect(await hydratePrivateProfileNames(ctx, [{ display_name: foreignReference }], { resolveAuthority: async () => route })).toEqual([{ display_name: null }]);
    expect(mocks.decrypt).toHaveBeenCalled();
  });
  it("does not start private reads when original-authority resolution is refused", async () => {
    expect(await hydratePrivateProfileNames(ctx, [{ display_name: foreignReference }], { resolveAuthority: async () => { throw new Error("unregistered"); } })).toEqual([{ display_name: null }]);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("rejects a resolver that substitutes a different key authority", async () => {
    expect(await hydratePrivateProfileNames(ctx, [{ display_name: foreignReference }], { resolveAuthority: async () => ({ context: ctx, confirm: async () => {} }) })).toEqual([{ display_name: null }]);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("bounds stalled original-authority discovery without starting private reads", async () => {
    vi.useFakeTimers();
    try {
      const pending = hydratePrivateProfileNames(ctx, [{ display_name: foreignReference }], { resolveAuthority: () => new Promise(() => {}) });
      await vi.advanceTimersByTimeAsync(6000);
      expect(await pending).toEqual([{ display_name: null }]);
      expect(mocks.read).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("withholds decrypted names if closing authority confirmation stalls", async () => {
    vi.useFakeTimers();
    try {
      const route = lease(vi.fn(() => new Promise<void>(() => {})));
      const pending = hydratePrivateProfileNames(ctx, [{ display_name: foreignReference }], { resolveAuthority: async () => route });
      await vi.advanceTimersByTimeAsync(6000);
      expect(await pending).toEqual([{ display_name: null }]);
      expect(mocks.decrypt).toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("does not fetch keys after a timed-out ciphertext read eventually returns", async () => {
    vi.useFakeTimers();
    try {
      let release: (value: unknown) => void = () => {};
      mocks.read.mockImplementation(() => new Promise(resolve => { release = resolve; }));
      const pending = hydratePrivateProfileNames(ctx, [{ display_name: reference }]);
      await vi.advanceTimersByTimeAsync(6000);
      expect(await pending).toEqual([{ display_name: null }]);
      release({ Ok: [{ pii_id: subject, field_id: "display_name", ciphertext: [9] }] });
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.keys).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("discards an unlock when the request is cancelled while keys are pending", async () => {
    const controller = new AbortController();
    let release: (value: Map<string, string>) => void = () => {};
    mocks.keys.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = hydratePrivateProfileNames(ctx, [{ display_name: reference }], { signal: controller.signal });
    await vi.waitFor(() => expect(mocks.keys).toHaveBeenCalled());
    controller.abort(); release(new Map([[subject, "key"]]));
    await expect(pending).rejects.toThrow("cancelled");
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it("globally bounds ciphertext batches to 100 subjects and two concurrent requests", async () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({ display_name: privateProfileNameReference(authority, Principal.fromUint8Array(new Uint8Array([i + 1, 2])).toText()) }));
    let inFlight = 0; let peak = 0;
    mocks.read.mockImplementation(async ids => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 1));
      inFlight--;
      return { Ok: ids.map(id => ({ pii_id: id, field_id: "display_name", ciphertext: [9] })) };
    });
    mocks.keys.mockImplementation(async (_, ids) => new Map(ids.map(id => [id, "key"])));
    const result = await hydratePrivateProfileNames(ctx, rows);
    expect(result.every(row => row.display_name === "Paul Cranwell")).toBe(true);
    expect(mocks.read.mock.calls.map(call => call[0].length)).toEqual([100, 100, 1]);
    expect(peak).toBe(2);
  });
});