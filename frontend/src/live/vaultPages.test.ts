import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureBackendContext } from "./featureRouter";
const m = vi.hoisted(() => ({ page: vi.fn(), legacy: vi.fn() }));
vi.mock("./domains", () => ({ connectLiveVaultDomain: async () => ({ actor: { read_vault_file_page: m.page, list_club_files_with_folder: m.legacy } }), connectLivePiiAccessControl: vi.fn() }));
vi.mock("./piiVetKeys", () => ({ encryptPiiValue: vi.fn(), fetchPiiVetKeys: vi.fn() }));
import { listLiveVaultClubFilesWithFolder, listLiveVaultTrashWithFolder } from "./features/vault";
describe("Vault revision-bound pages", () => {
  const ctx = {} as FeatureBackendContext;
  beforeEach(() => { m.page.mockReset(); m.legacy.mockReset(); });
  it("loads beyond 200 records while pinning the acknowledged revision", async () => {
    const first = Array.from({ length: 200 }, (_, i) => ({ file: { id: `file-${i}` } }));
    m.page.mockResolvedValueOnce({ Ok: { items: first, next: [200n], revision: 8n } }).mockResolvedValueOnce({ Ok: { items: [{ file: { id: "file-200" } }], next: [], revision: 8n } });
    expect(await listLiveVaultClubFilesWithFolder(ctx, "club-a", "team-a")).toHaveLength(201);
    expect(m.page.mock.calls[1]).toEqual(["club-a", ["team-a"], [], [], [], false, 200n, [8n]]);
  });
  it("discards incomplete inventory when the next page fails", async () => {
    m.page.mockResolvedValueOnce({ Ok: { items: [{ file: { id: "file-a" } }], next: [200n], revision: 8n } }).mockResolvedValueOnce({ Err: "Vault inventory changed" });
    await expect(listLiveVaultTrashWithFolder(ctx, "club-a")).rejects.toThrow("inventory changed");
    expect(m.page.mock.calls[0][5]).toBe(true);
  });
  it("continues through an empty filtered page", async () => {
    m.page.mockResolvedValueOnce({ Ok: { items: [], next: [200n], revision: 1n } }).mockResolvedValueOnce({ Ok: { items: [{ file: { id: "visible" } }], next: [], revision: 1n } });
    expect(await listLiveVaultClubFilesWithFolder(ctx, "club-a", null)).toEqual([{ file: { id: "visible" } }]);
  });
  it("keeps an older deployed canister readable only for a missing paging method", async () => {
    m.page.mockRejectedValue(new Error("Canister has no update method read_vault_file_page"));
    m.legacy.mockResolvedValue({ Ok: [{ file: { id: "legacy" } }] });
    expect(await listLiveVaultClubFilesWithFolder(ctx, "club-a", "team-a")).toEqual([{ file: { id: "legacy" } }]);
    expect(m.legacy).toHaveBeenCalledWith("club-a", ["team-a"], []);
  });
  it("does not bypass a permission denial through legacy reads", async () => {
    m.page.mockResolvedValue({ Err: "Forbidden" });
    await expect(listLiveVaultClubFilesWithFolder(ctx, "club-a", null)).rejects.toThrow("Forbidden");
    expect(m.legacy).not.toHaveBeenCalled();
  });
});