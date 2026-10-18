import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { confirmPendingSend, installPendingSendKeeper, mergePendingRows } from "./pendingSendKeeper";

describe("mergePendingRows", () => {
  const pending = { id: "temp-1", author_id: "a", text: "", image_url: "https://x" };
  it("restores a still-sending photo missing from a refetch", () => {
    expect(mergePendingRows([{ id: "m1", author_id: "b", text: "hi" }], [pending])?.map((m) => m.id)).toEqual(["m1", "temp-1"]);
  });
  it("does not restore once the real message has arrived", () => {
    expect(mergePendingRows([{ id: "m2", author_id: "a", text: "", image_url: "https://x" }], [pending])).toBeNull();
  });
  it("removes a restored preview already present alongside its confirmed photo", () => {
    const real = { id: "m2", author_id: "a", text: "", image_url: "https://x" };
    expect(mergePendingRows([pending, real], [pending])).toEqual([real]);
  });
  it("preserves a different pending send when a photo is confirmed", () => {
    const other = { id: "temp-2", author_id: "a", text: "Another photo", image_url: "blob:y" };
    const real = { id: "m2", author_id: "a", text: "", image_url: "https://x" };
    expect(mergePendingRows([pending, other, real], [pending, other])).toEqual([other, real]);
  });
  it("keeps only the saved photo after leaving, restoring and confirming a send", async () => {
    const client = new QueryClient();
    const key = ["club-messages", "goat"];
    installPendingSendKeeper(client);
    client.setQueryData(key, { messages: [pending] });
    await client.fetchQuery({ queryKey: key, queryFn: async () => ({ messages: [] }) });
    expect(client.getQueryData(key)).toEqual({ messages: [pending] });
    const real = { id: "m2", author_id: "a", text: "", image_url: "https://x" };
    client.setQueryData(key, { messages: [pending, real] });
    expect(client.getQueryData(key)).toEqual({ messages: [real] });
    await client.fetchQuery({ queryKey: key, queryFn: async () => ({ messages: [real] }) });
    expect(client.getQueryData(key)).toEqual({ messages: [real] });
    client.clear();
  });
  it("matches the single-space body of an ICP photo-only message", () => {
    const real = { id: "saved", author_id: "a", text: " ", image_url: "https://x" };
    expect(mergePendingRows([pending, real], [pending])).toEqual([real]);
  });
  it("does not consume a second photo-only send by the same author", () => {
    const other = { ...pending, id: "temp-2", image_url: "https://y" };
    const real = { ...pending, id: "saved", text: " " };
    expect(mergePendingRows([real], [pending, other])).toEqual([real, other]);
  });
  it("settles a local blob preview from its acknowledgement across navigation", async () => {
    const client = new QueryClient();
    const key = ["group-messages", "group-1"];
    installPendingSendKeeper(client);
    const local = { ...pending, image_url: "blob:local" };
    const other = { ...local, id: "temp-2", image_url: "blob:other" };
    client.setQueryData(key, { messages: [local, other], reactions: [] });
    await client.fetchQuery({ queryKey: key, queryFn: async () => ({ messages: [], reactions: [] }) });
    const saved = { id: "saved", text: " ", image_url: "https://stored", created_at: "2026-10-18T05:51:00Z" };
    confirmPendingSend(client, key, local.id, saved);
    const data = client.getQueryData<{ messages: typeof local[] }>(key);
    expect(data?.messages.map((row) => row.id)).toEqual(["temp-2", "saved"]);
    expect(data?.messages.find((row) => row.id === "saved")?.image_url).toBe("https://stored");
    await client.fetchQuery({ queryKey: key, queryFn: async () => ({ messages: [{ ...local, ...saved }], reactions: [] }) });
    expect(client.getQueryData<{ messages: typeof local[] }>(key)?.messages.map((row) => row.id)).toEqual(["saved", "temp-2"]);
    client.clear();
  });
});
