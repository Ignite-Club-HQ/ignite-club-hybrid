import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureBackendContext } from "./featureRouter";
import { restoreLiveVaultBackup, restoreLiveVaultBackupWithMedia } from "./features/vault";

const m = vi.hoisted(() => ({
  getBackup: vi.fn(),
  restoreBackup: vi.fn(),
  restorePage: vi.fn(),
  grantClub: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("./domains", () => ({
  connectLiveVaultDomain: async () => ({
    actor: { read_account_get_backup: m.getBackup, restore_backup: m.restoreBackup, restore_backup_page: m.restorePage },
  }),
  connectLivePiiAccessControl: async () => ({
    actor: { grant_pii_read_club: m.grantClub },
  }),
}));
vi.mock("./piiVetKeys", () => ({
  clubIdFromMediaPath: (path: string) => (path.startsWith("clubs/") ? path.split("/")[1] : null),
}));

const ctx = {} as FeatureBackendContext;
const file = (path: string | null) => ({
  id: `f-${path}`,
  blob_ref: path ? [{ canister: "aaaaa-aa", path }] : [],
});

describe("vault backup restore with media recovery", () => {
  beforeEach(() => {
    m.getBackup.mockReset(); m.restoreBackup.mockReset(); m.restorePage.mockReset(); m.grantClub.mockReset(); m.fetch.mockReset();
    vi.stubGlobal("fetch", m.fetch);
    m.restoreBackup.mockResolvedValue({ Ok: 2n });
    m.restorePage.mockResolvedValue({ Ok: { next: 2n, restored: 2n, skipped: 0n, complete: true } });
    m.grantClub.mockResolvedValue({ Ok: null });
    m.fetch.mockResolvedValue({ ok: true });
    // Legacy contract fixtures must carry the complete snapshot shape.
    m.getBackup.mockImplementation(async () => ({ Ok: { id: "backup-1", backup_label: "Backup", created_at_ms: 1n, created_by: "owner", folders: [], files: [] } }));
  });

  it("restores rows, re-grants club media access and verifies bytes", async () => {
    m.getBackup.mockResolvedValue({ Ok: { id: "backup-1", backup_label: "Backup", created_at_ms: 1n, created_by: "owner", folders: [], files: [file("clubs/club-1/a.jpg"), file("clubs/club-1/b.jpg")] } });
    const report = await restoreLiveVaultBackupWithMedia(ctx, "backup-1");
    expect(report.restoredRows).toBe(2);
    expect(m.grantClub).not.toHaveBeenCalled();
    expect(m.fetch).toHaveBeenCalledTimes(2);
    expect(report.missingBytes).toEqual([]);
  });

  it("re-grants club read access for club-scoped blob paths only", async () => {
    m.getBackup.mockResolvedValue({ Ok: { id: "backup-1", backup_label: "Backup", created_at_ms: 1n, created_by: "owner", folders: [], files: [file("clubs/club-9/photo.jpg"), file("loose/file.bin"), file(null)] } });
    const report = await restoreLiveVaultBackupWithMedia(ctx, "backup-1");
    expect(m.grantClub).not.toHaveBeenCalled();
    expect(report.grantsRepaired).toBe(0);
    expect(report.grantFailures).toBe(0);
  });

  it("counts grant denials without failing the restore", async () => {
    m.getBackup.mockResolvedValue({ Ok: { id: "backup-1", backup_label: "Backup", created_at_ms: 1n, created_by: "owner", folders: [], files: [file("clubs/club-1/a.jpg")] } });
    m.grantClub.mockResolvedValue({ Err: "Record not found" });
    const report = await restoreLiveVaultBackupWithMedia(ctx, "backup-1");
    expect(report.grantFailures).toBe(0);
    expect(report.grantsRepaired).toBe(0);
  });

  it("reports blob paths whose bytes no longer load", async () => {
    m.getBackup.mockResolvedValue({ Ok: { id: "backup-1", backup_label: "Backup", created_at_ms: 1n, created_by: "owner", folders: [], files: [file("clubs/club-1/gone.jpg"), file("clubs/club-1/ok.jpg")] } });
    m.fetch.mockImplementation(async (url: string) => ({ ok: !url.includes("gone.jpg") }));
    const report = await restoreLiveVaultBackupWithMedia(ctx, "backup-1");
    expect(report.missingBytes).toEqual(["clubs/club-1/gone.jpg"]);
  });

  it("propagates a restore denial without attempting grants", async () => {
    m.getBackup.mockResolvedValue({ Ok: { id: "backup-1", backup_label: "Backup", created_at_ms: 1n, created_by: "owner", folders: [], files: [file("clubs/club-1/a.jpg")] } });
    m.restorePage.mockResolvedValue({ Err: "App admin only" });
    await expect(restoreLiveVaultBackupWithMedia(ctx, "backup-1")).rejects.toThrow("App admin only");
    expect(m.grantClub).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
  });
  it("restores more than 200 rows using acknowledged continuation receipts", async () => {
    m.restorePage.mockResolvedValueOnce({ Ok: { next: 40n, restored: 40n, skipped: 0n, complete: false } })
      .mockResolvedValueOnce({ Ok: { next: 205n, restored: 205n, skipped: 0n, complete: true } });
    await expect(restoreLiveVaultBackup(ctx, "large")).resolves.toBe(205n);
    expect(m.restorePage.mock.calls).toEqual([["large", 0n], ["large", 40n]]);
    expect(m.restoreBackup).not.toHaveBeenCalled();
  });
  it("does not retry or fall back after an uncertain second-page outcome", async () => {
    m.restorePage.mockResolvedValueOnce({ Ok: { next: 40n, restored: 1n, skipped: 39n, complete: false } })
      .mockRejectedValueOnce(new Error("Connection interrupted"));
    await expect(restoreLiveVaultBackup(ctx, "large")).rejects.toThrow("Connection interrupted");
    expect(m.restoreBackup).not.toHaveBeenCalled();
    expect(m.restorePage).toHaveBeenCalledTimes(2);
  });
});
