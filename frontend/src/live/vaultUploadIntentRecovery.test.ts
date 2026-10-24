import { describe, expect, it, vi } from "vitest";
import type { FeatureBackendContext } from "./featureRouter";
import type { VaultFile } from "../lab/bindings/vault_domain/declarations/vault_domain.did.js";
import { reconcileVaultUploadIntent } from "./vaultUploadIntentRecovery";

const ctx = { identity: { getPrincipal: () => ({ toText: () => "owner" }) } } as FeatureBackendContext;
const file = { id: "file", uploaded_by: { toText: () => "owner" }, blob_ref: [{ path: "clubs/a/vault/file", content_hash: "hash", canister: "store" }] } as VaultFile;
function ops(ready = false) {
  return { read: vi.fn().mockResolvedValue({ file, ready }), marker: vi.fn().mockResolvedValue("hash"), grant: vi.fn().mockResolvedValue(undefined), acknowledge: vi.fn().mockResolvedValue(undefined), recover: vi.fn().mockResolvedValue(undefined) };
}
describe("private upload readback reconciliation", () => {
  it("confirms exact encrypted marker and grants before store-checked acknowledgement and recovery", async () => {
    const o = ops(); await reconcileVaultUploadIntent(ctx, "file", o);
    expect(o.marker).toHaveBeenCalledExactlyOnceWith("clubs/a/vault/file");
    expect(o.grant.mock.invocationCallOrder[0]).toBeLessThan(o.acknowledge.mock.invocationCallOrder[0]);
    expect(o.acknowledge.mock.invocationCallOrder[0]).toBeLessThan(o.recover.mock.invocationCallOrder[0]);
  });
  it("retains unresolved or mismatched access records without any mutation", async () => {
    for (const marker of [null, "wrong-hash"]) {
      const o = ops(); o.marker.mockResolvedValue(marker);
      await reconcileVaultUploadIntent(ctx, "file", o);
      expect(o.grant).not.toHaveBeenCalled(); expect(o.acknowledge).not.toHaveBeenCalled(); expect(o.recover).not.toHaveBeenCalled();
    }
  });
  it("does not acknowledge a refused private access grant", async () => {
    const o = ops(); o.grant.mockRejectedValue(new Error("access revoked"));
    await expect(reconcileVaultUploadIntent(ctx, "file", o)).rejects.toThrow("revoked");
    expect(o.acknowledge).not.toHaveBeenCalled(); expect(o.recover).not.toHaveBeenCalled();
  });
  it("does not replay an unknown acknowledgement", async () => {
    const o = ops(); o.acknowledge.mockRejectedValue(new Error("unknown"));
    await expect(reconcileVaultUploadIntent(ctx, "file", o)).rejects.toThrow("unknown");
    expect(o.acknowledge).toHaveBeenCalledTimes(1); expect(o.recover).not.toHaveBeenCalled();
  });
  it("recovers acknowledged intents without rewriting private records", async () => {
    const o = ops(true); await reconcileVaultUploadIntent(ctx, "file", o);
    expect(o.marker).not.toHaveBeenCalled(); expect(o.grant).not.toHaveBeenCalled(); expect(o.acknowledge).not.toHaveBeenCalled(); expect(o.recover).toHaveBeenCalledOnce();
  });
  it("rejects another account's intent before reading private data", async () => {
    const o = ops(); o.read.mockResolvedValue({ file: { ...file, uploaded_by: { toText: () => "other" } }, ready: false });
    await expect(reconcileVaultUploadIntent(ctx, "file", o)).rejects.toThrow("owner");
    expect(o.marker).not.toHaveBeenCalled(); expect(o.recover).not.toHaveBeenCalled();
  });
});