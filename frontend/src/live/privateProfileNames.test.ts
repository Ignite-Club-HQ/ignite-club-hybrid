import { beforeEach, describe, expect, it, vi } from "vitest";
import { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "./featureRouter";

const mocks = vi.hoisted(() => ({ register: vi.fn(), read: vi.fn(), keys: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn() }));
vi.mock("./domains", () => ({ connectLivePiiAccessControl: vi.fn(async () => ({ actor: { register_pii: mocks.register, get_encrypted_pii_batch: mocks.read } })) }));
vi.mock("./piiVetKeys", () => ({ encryptPiiText: mocks.encrypt, fetchPiiVetKeys: mocks.keys }));
vi.mock("@icp-sdk/vetkeys", () => ({ IbeCiphertext: { deserialize: () => ({ decrypt: mocks.decrypt }) } }));

import { hydratePrivateProfileNames, preparePrivateOwnProfileName, preparePrivateOwnProfileEmail, privateProfileNameReference } from "./privateProfileNames";

const subject = "mbrvi-lvde7-gdspi-hamp3-nxj43-p4tt6-at6q5-jlbit-eehve-7xqwc-wqe";
const authority = "rrkah-fqaaa-aaaaa-aaaaq-cai";
const ctx = { identity: { getPrincipal: () => Principal.fromText(subject) }, target: { host: "https://icp-api.io", canisterIds: { pii_access_control: authority } } } as FeatureBackendContext;
const reference = privateProfileNameReference(authority, subject);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.encrypt.mockResolvedValue(new Uint8Array([9, 8]));
  mocks.register.mockResolvedValue({ Ok: {} });
  mocks.read.mockResolvedValue({ Ok: [{ pii_id: subject, field_id: "display_name", ciphertext: [9, 8] }] });
  mocks.keys.mockResolvedValue(new Map([[subject, "authorized-key"]]));
  mocks.decrypt.mockReturnValue(new TextEncoder().encode("Paul Cranwell"));
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

describe("private own email preparation", () => {
  it("registers a validated email only for its authenticated owner and verifies private readback", async () => {
    mocks.read.mockResolvedValue({Ok:[{pii_id:subject,field_id:"contact_email",ciphertext:[9,8]}]});
    mocks.decrypt.mockReturnValue(new TextEncoder().encode("paul@example.test"));
    expect(await preparePrivateOwnProfileEmail(ctx," paul@example.test ")).toBe(`pii-email:v1:${authority}:${subject}`);
    expect(mocks.encrypt).toHaveBeenCalledWith(ctx,subject,"contact_email","paul@example.test");
    expect(mocks.keys).toHaveBeenCalledWith(ctx,[subject],"contact_email",{fresh:true,assertActive:expect.any(Function)});
  });
  it("refuses invalid email before any encryption or write",async()=>{
    await expect(preparePrivateOwnProfileEmail(ctx,"not-an-email")).rejects.toThrow();
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it("does not report success or replay an unknown email write",async()=>{
    mocks.register.mockRejectedValue(new Error("Unknown reply"));
    await expect(preparePrivateOwnProfileEmail(ctx,"paul@example.test")).rejects.toThrow("Unknown reply");
    expect(mocks.register).toHaveBeenCalledOnce();
  });
  it("clears an existing optional email using verified empty ciphertext in the original field",async()=>{
    mocks.read.mockResolvedValue({Ok:[{pii_id:subject,field_id:"contact_email",ciphertext:[9,8]}]});
    mocks.decrypt.mockReturnValue(new Uint8Array());
    await preparePrivateOwnProfileEmail(ctx," ");
    expect(mocks.encrypt).toHaveBeenCalledWith(ctx,subject,"contact_email","");
    expect(mocks.register).toHaveBeenCalledWith(subject,"contact_email",expect.any(Uint8Array),Principal.fromText(subject));
  });
});

describe("original-authority display rehearsal", () => {
  const foreignAuthority = "ryjl3-tyaaa-aaaaa-aaaba-cai";
  const foreignReference = privateProfileNameReference(foreignAuthority, subject);
  const lease = (confirm = vi.fn(async () => {})) => ({ context: { ...ctx, target: { ...ctx.target, canisterIds: { ...ctx.target.canisterIds, pii_access_control: foreignAuthority } } }, confirm });

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