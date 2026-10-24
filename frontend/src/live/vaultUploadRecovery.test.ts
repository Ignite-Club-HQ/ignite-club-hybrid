import { describe, expect, it, vi } from "vitest";
import { scheduleVaultUploadRecovery } from "./vaultUploadRecovery";

describe("bounded acknowledged Vault recovery", () => {
  it("continues past empty pages and coalesces concurrent openings", async () => {
    const identity = {};
    const read = vi.fn().mockResolvedValueOnce({ ids: [], next: ["a"] }).mockResolvedValueOnce({ ids: ["z"], next: [] });
    const recover = vi.fn().mockResolvedValue(undefined);
    const first = scheduleVaultUploadRecovery(identity, "target/club", read, recover);
    expect(scheduleVaultUploadRecovery(identity, "target/club", read, recover)).toBe(first);
    await first;
    expect(read.mock.calls).toEqual([[""], ["a"]]);
    expect(recover).toHaveBeenCalledExactlyOnceWith("z");
  });
  it("retains the current page after an unknown write and resumes only on another opening", async () => {
    const identity = {};
    const read = vi.fn().mockResolvedValueOnce({ ids: [], next: ["a"] }).mockResolvedValue({ ids: ["z"], next: [] });
    const recover = vi.fn().mockRejectedValueOnce(new Error("unknown outcome")).mockResolvedValue(undefined);
    await expect(scheduleVaultUploadRecovery(identity, "scope", read, recover)).rejects.toThrow("unknown");
    expect(recover).toHaveBeenCalledTimes(1);
    await scheduleVaultUploadRecovery(identity, "scope", read, recover);
    expect(read.mock.calls).toEqual([[""], ["a"], ["a"]]);
  });
  it("isolates accounts, stores and clubs", async () => {
    const first = {}, second = {};
    const read = vi.fn().mockResolvedValue({ ids: [], next: [] });
    const recover = vi.fn();
    await scheduleVaultUploadRecovery(first, "store-a/club", read, recover);
    await scheduleVaultUploadRecovery(first, "store-a/club", read, recover);
    await scheduleVaultUploadRecovery(second, "store-a/club", read, recover);
    await scheduleVaultUploadRecovery(first, "store-b/club", read, recover);
    expect(read).toHaveBeenCalledTimes(3);
  });
  it("refuses malformed pages before any recovery mutation", async () => {
    const recover = vi.fn();
    await expect(scheduleVaultUploadRecovery({}, "scope", async () => ({ ids: ["z"], next: ["a"] }), recover)).rejects.toThrow("continuation");
    expect(recover).not.toHaveBeenCalled();
  });
  it("does not guess completion or retry a failed page", async () => {
    const read = vi.fn().mockRejectedValue(new Error("membership unavailable"));
    const recover = vi.fn();
    await expect(scheduleVaultUploadRecovery({}, "scope", read, recover)).rejects.toThrow("unavailable");
    expect(read).toHaveBeenCalledTimes(1);
    expect(recover).not.toHaveBeenCalled();
  });
});