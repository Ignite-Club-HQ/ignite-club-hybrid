import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveVaultBackup, exportLiveVaultBackupBlob, exportLiveVaultBackupToSink, getLiveVaultBackup } from "./features/vault";
import type { FeatureBackendContext } from "./featureRouter";

const m = vi.hoisted(() => ({ page: vi.fn(), legacy: vi.fn(), create: vi.fn(), legacyCreate: vi.fn() }));
vi.mock("./domains", () => ({ connectLiveVaultDomain: async () => ({ actor: { read_backup_page: m.page, read_account_get_backup: m.legacy, create_backup_summary: m.create, create_backup: m.legacyCreate } }), connectLivePiiAccessControl: vi.fn() }));
vi.mock("./piiVetKeys", () => ({}));
const ctx = {} as FeatureBackendContext;
const summary = { id: "large", backup_label: "Large", created_at_ms: 1n, created_by: "owner", file_count: 205n, folder_count: 0n };
function pages() {
  m.page.mockImplementation(async (_id: string, offset: bigint) => {
    const start = Number(offset); const end = Math.min(205, start + 40);
    return { Ok: { summary, revision: 9n, offset, folders: [], files: Array.from({ length: end - start }, (_, i) => ({ id: String(start + i), blob_ref: [] })), next: end < 205 ? [BigInt(end)] : [] } };
  });
}
describe("bounded Vault snapshot export", () => {
  beforeEach(() => { vi.clearAllMocks(); m.page.mockReset(); pages(); });
  it("reads all 205 rows through six revision-bound pages", async () => {
    const backup = await getLiveVaultBackup(ctx, "large");
    expect(backup.files).toHaveLength(205);
    expect(backup.files[204].id).toBe("204");
    expect(m.page.mock.calls.map(c => c[1])).toEqual([0n, 40n, 80n, 120n, 160n, 200n]);
    expect(m.page.mock.calls[1][2]).toEqual([9n]);
    expect(m.legacy).not.toHaveBeenCalled();
  });
  it("creates snapshots without requesting the full manifest", async () => {
    m.create.mockResolvedValue({ Ok: summary });
    await expect(createLiveVaultBackup(ctx, "Large")).resolves.toEqual(summary);
    expect(m.legacyCreate).not.toHaveBeenCalled();
  });
  it("refuses a nonadvancing export cursor", async () => {
    m.page.mockResolvedValue({ Ok: { summary, revision: 9n, offset: 0n, folders: [], files: [], next: [0n] } });
    await expect(exportLiveVaultBackupBlob(ctx, "large")).rejects.toThrow("Invalid backup export");
  });
  it("does not emit a partial download or fall back on second-page loss", async () => {
    m.page.mockImplementationOnce(async () => ({ Ok: { summary, revision: 9n, offset: 0n, folders: [], files: Array.from({ length: 40 }, (_, i) => ({ id: String(i) })), next: [40n] } }))
      .mockRejectedValueOnce(new Error("Disconnected"));
    await expect(exportLiveVaultBackupBlob(ctx, "large")).rejects.toThrow("Disconnected");
    expect(m.legacy).not.toHaveBeenCalled();
  });
  it("refuses a changed snapshot revision", async () => {
    m.page.mockImplementation(async (_id: string, offset: bigint) => ({ Ok: { summary, revision: offset === 0n ? 9n : 10n, offset, folders: [], files: Array.from({ length: 40 }, (_, i) => ({ id: String(Number(offset) + i) })), next: [offset + 40n] } }));
    await expect(getLiveVaultBackup(ctx, "large")).rejects.toThrow("changed");
  });
  it("does not treat a denied first page as an older canister", async () => {
    m.page.mockResolvedValue({ Err: "App admin required" });
    await expect(getLiveVaultBackup(ctx, "large")).rejects.toThrow("App admin required");
    expect(m.legacy).not.toHaveBeenCalled();
  });
  it("writes all 205 rows incrementally and commits only the final validated page", async () => {
    const write = vi.fn().mockResolvedValue(undefined), close = vi.fn().mockResolvedValue(undefined), abort = vi.fn();
    await exportLiveVaultBackupToSink(ctx, "large", { write, close, abort });
    expect(write).toHaveBeenCalledTimes(206);
    expect(JSON.parse(write.mock.calls[205][0])).toEqual({ kind: "file", row: { id: "204", blob_ref: [] } });
    expect(m.page).toHaveBeenCalledTimes(6); expect(close).toHaveBeenCalledOnce(); expect(abort).not.toHaveBeenCalled();
  });
  it("discards temporary output after a later authorized page fails", async () => {
    m.page.mockImplementationOnce(async () => ({ Ok: { summary, revision: 9n, offset: 0n, folders: [], files: Array.from({ length: 40 }, (_, i) => ({ id: String(i) })), next: [40n] } })).mockRejectedValueOnce(new Error("Access revoked"));
    const sink = { write: vi.fn().mockResolvedValue(undefined), close: vi.fn(), abort: vi.fn().mockResolvedValue(undefined) };
    await expect(exportLiveVaultBackupToSink(ctx, "large", sink)).rejects.toThrow("Access revoked");
    expect(sink.close).not.toHaveBeenCalled(); expect(sink.abort).toHaveBeenCalledOnce(); expect(m.legacy).not.toHaveBeenCalled();
  });
});