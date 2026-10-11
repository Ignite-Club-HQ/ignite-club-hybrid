import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { installPendingSendKeeper, mergePendingRows } from "./pendingSendKeeper";

describe("mergePendingRows", () => {
  const pending = { id: "temp-1", author_id: "a", text: "", image_url: "blob:x" };
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
});
