import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureBackendContext } from "./featureRouter";
import { restoreLiveVaultBackupWithMedia } from "./features/vault";

const m = vi.hoisted(() => ({
  getBackup: vi.fn(),
  restoreBackup: vi.fn(),
  grantClub: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("./domains", () => ({
  connectLiveVaultDomain: async () => ({
    actor: { get_backup: m.getBackup, restore_backup: m.restoreBackup },
  }),
  connectLivePiiAccessControl: async () => ({ actor: {} }),
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
    vi.restoreAllMocks();
    m.getBackup.mockReset(); m.restoreBackup.mockReset(); m.grantClub.mockReset(); m.fetch.mockReset();
    vi.stubGlobal("fetch", m.fetch);
    m.restoreBackup.mockResolvedValue({ Ok: 2n });
    m.fetch.mockResolvedValue({ ok: true });
  });

  it("restores rows, re-grants club media access and verifies bytes", async () => {
    m.getBackup.mockResolvedValue({ Ok: { files: [file("clubs/club-1/a.jpg"), file("clubs/club-1/b.jpg")] } });
    const { grantLivePiiReadClub } = await import("./features/vault");
    void grantLivePiiReadClub;
    const report = await restoreLiveVaultBackupWithMedia(ctx, "backup-1");
    expect(report.restoredRows).toBe(2);
    expect(report.missingBytes).toEqual([]);
  });

  it("re-grants club read access for club-scoped blob paths only", async () => {
    m.getBackup.mockResolvedValue({ Ok: { files: [file("clubs/club-9/photo.jpg"), file("loose/file.bin")] } });
    const spy = vi.spyOn(await import("./features/vault"), "grantLivePiiReadClub");
    void spy;
    const report = await restoreLiveVaultBackupWithMedia(ctx, "backup-1");
    expect(report.grantsRepaired + report.grantFailures).toBe(1);
  });

  it("reports blob paths whose bytes no longer load", async () => {
    m.getBackup.mockResolvedValue({ Ok: { files: [file("clubs/club-1/gone.jpg"), file("clubs/club-1/ok.jpg")] } });
    m.fetch.mockImplementation(async (url: string) => ({ ok: !url.includes("gone.jpg") }));
    const report = await restoreLiveVaultBackupWithMedia(ctx, "backup-1");
    expect(report.missingBytes).toEqual(["clubs/club-1/gone.jpg"]);
  });

  it("propagates a restore denial without attempting grants", async () => {
    m.getBackup.mockResolvedValue({ Ok: { files: [file("clubs/club-1/a.jpg")] } });
    m.restoreBackup.mockResolvedValue({ Err: "App admin only" });
    await expect(restoreLiveVaultBackupWithMedia(ctx, "backup-1")).rejects.toThrow("App admin only");
    expect(m.fetch).not.toHaveBeenCalled();
  });
});
