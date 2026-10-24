import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { chatVaultLocation, readChatVaultCard } from "./chatVaultCardRead";

describe("chat Vault card routing", () => {
  it("reads a same-club file once without resource rediscovery", async () => {
    const read = vi.fn().mockResolvedValue({ id: "file", name: "Rules.pdf" });
    expect(await readChatVaultCard({ clubId: "goat" }, { vaultFileId: "file" }, read)).toEqual({ id: "file", name: "Rules.pdf" });
    expect(read.mock.calls).toEqual([[{ clubId: "goat" }]]);
  });
  it("retains resource discovery for a cross-club share", async () => {
    const read = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "folder" });
    expect(await readChatVaultCard({ clubId: "goat" }, { vaultFolderId: "folder" }, read)).toEqual({ id: "folder" });
    expect(read.mock.calls).toEqual([[{ clubId: "goat" }], [{ vaultFolderId: "folder" }]]);
  });
  it("does not hide access or transport failures behind a fallback", async () => {
    const read = vi.fn().mockRejectedValue(new Error("access denied"));
    await expect(readChatVaultCard({ teamId: "u9" }, { vaultFileId: "file" }, read)).rejects.toThrow("access denied");
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("discovers a cold link without guessing a club", async () => {
    const read = vi.fn().mockResolvedValue(null);
    await readChatVaultCard(undefined, { vaultFileId: "file" }, read);
    expect(read.mock.calls).toEqual([[{ vaultFileId: "file" }]]);
  });
  it("uses only the current account's exact group location", () => {
    const client = new QueryClient();
    client.setQueryData(["my-chat-groups-with-messages", "paul"], { groups: [{ id: "coaches", club_id: "goat" }] });
    expect(chatVaultLocation(client, "paul", "/groups/coaches")).toEqual({ clubId: "goat" });
    expect(chatVaultLocation(client, "other", "/groups/coaches")).toBeUndefined();
    expect(chatVaultLocation(client, "paul", "/groups/unknown")).toBeUndefined();
    expect(chatVaultLocation(client, "paul", "/messages/dm/friend")).toBeUndefined();
    expect(chatVaultLocation(client, "paul", "/messages/club/goat")).toEqual({ clubId: "goat" });
    expect(chatVaultLocation(client, "paul", "/messages/u9")).toEqual({ teamId: "u9" });
    client.clear();
  });
});