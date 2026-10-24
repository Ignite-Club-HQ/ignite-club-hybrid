import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureBackendContext } from "./featureRouter";
const m = vi.hoisted(() => ({ get: vi.fn(), begin: vi.fn(), resume: vi.fn(), legacy: vi.fn() }));
vi.mock("./domains", () => ({ connectLiveVaultDomain: async () => ({ actor: { get_file: m.get, begin_file_cleanup: m.begin, resume_file_cleanup: m.resume, delete_file_permanent: m.legacy } }), connectLivePiiAccessControl: vi.fn() }));
vi.mock("./piiVetKeys", () => ({}));
import { permanentlyDeleteLiveVaultFile } from "./features/vault";
const ctx = {} as FeatureBackendContext;
describe("on-chain Vault cleanup recovery", () => {
  beforeEach(() => { vi.clearAllMocks(); m.get.mockResolvedValue({ Ok: [] }); m.resume.mockReset(); m.begin.mockResolvedValue({ Ok: { id: "file" } }); });
  it("starts one intent then resumes the exact file", async () => {
    m.resume.mockResolvedValueOnce({ Err: "File cleanup required" }).mockResolvedValueOnce({ Ok: null });
    await permanentlyDeleteLiveVaultFile(ctx, "file");
    expect(m.begin).toHaveBeenCalledExactlyOnceWith("file");
    expect(m.resume.mock.calls).toEqual([["file"], ["file"]]);
    expect(m.legacy).not.toHaveBeenCalled();
  });
  it("reconciles already completed cleanup without creating another intent", async () => {
    m.resume.mockResolvedValue({ Ok: null });
    await permanentlyDeleteLiveVaultFile(ctx, "file");
    expect(m.begin).not.toHaveBeenCalled();
  });
  it("preserves unknown outcomes without replay or unsafe fallback", async () => {
    m.resume.mockRejectedValue(new Error("Cleanup outcome unknown"));
    await expect(permanentlyDeleteLiveVaultFile(ctx, "file")).rejects.toThrow("unknown");
    expect(m.resume).toHaveBeenCalledTimes(1);
    expect(m.begin).not.toHaveBeenCalled();
    expect(m.legacy).not.toHaveBeenCalled();
  });
  it("does not bypass denied or unavailable cleanup methods", async () => {
    m.resume.mockResolvedValue({ Err: "Scoped staff required" });
    await expect(permanentlyDeleteLiveVaultFile(ctx, "file")).rejects.toThrow("Scoped staff");
    expect(m.begin).not.toHaveBeenCalled();
  });
});