import { describe, expect, it, vi } from "vitest";
import { writeVaultBackupChunks } from "./vaultBackupWriter";

describe("incremental Vault backup output", () => {
  it("applies write backpressure before retrieving another chunk and commits only after completion", async () => {
    const events: string[] = [];
    async function* chunks() { events.push("read-1"); yield "first"; events.push("read-2"); yield "second"; }
    const sink = { write: vi.fn(async (chunk: string) => { events.push(chunk); }), close: vi.fn(async () => { events.push("commit"); }), abort: vi.fn() };
    await writeVaultBackupChunks(chunks(), sink);
    expect(events).toEqual(["read-1", "first", "read-2", "second", "commit"]);
    expect(sink.abort).not.toHaveBeenCalled();
  });
  it("aborts rather than committing partial data after page loss", async () => {
    async function* chunks() { yield "first"; throw new Error("revision changed"); }
    const sink = { write: vi.fn().mockResolvedValue(undefined), close: vi.fn(), abort: vi.fn().mockResolvedValue(undefined) };
    await expect(writeVaultBackupChunks(chunks(), sink)).rejects.toThrow("revision changed");
    expect(sink.write).toHaveBeenCalledExactlyOnceWith("first");
    expect(sink.close).not.toHaveBeenCalled();
    expect(sink.abort).toHaveBeenCalledTimes(1);
  });
  it("does not read ahead or finalize after a disk write failure", async () => {
    const read = vi.fn();
    async function* chunks() { yield "first"; read(); yield "second"; }
    const sink = { write: vi.fn().mockRejectedValue(new Error("disk full")), close: vi.fn(), abort: vi.fn().mockResolvedValue(undefined) };
    await expect(writeVaultBackupChunks(chunks(), sink)).rejects.toThrow("disk full");
    expect(read).not.toHaveBeenCalled(); expect(sink.close).not.toHaveBeenCalled();
  });
});