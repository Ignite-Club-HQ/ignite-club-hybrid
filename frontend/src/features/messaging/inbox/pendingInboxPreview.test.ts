import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyPendingInboxPreview,
  discardPendingInboxPreview,
  resetPendingInboxPreviewsForTests,
  settlePendingInboxPreview,
} from "./pendingInboxPreview";

const dmRow = {
  id: "dm-1",
  updated_at: "2026-10-28T20:00:00Z",
  last_message: { text: "Old", image_url: null, created_at: "2026-10-28T20:00:00Z", author_id: "peer" },
};

afterEach(() => {
  resetPendingInboxPreviewsForTests();
  vi.useRealTimers();
});

describe("pending inbox previews", () => {
  it.each([
    ["team", "my-teams-with-messages", "teams"],
    ["club", "member-clubs-with-messages", "clubs"],
    ["group", "my-chat-groups-with-messages", "groups"],
  ] as const)("shows the still-sending %s message without a refetch", (scope, prefix, collection) => {
    const client = new QueryClient();
    const key = [prefix, "paul"];
    client.setQueryData(key, { [collection]: [{ id: "chat" }], latestMessages: {} });
    applyPendingInboxPreview(client, scope, "paul", "chat", { text: "Sending now", image_url: null });
    const preview = client.getQueryData<any>(key)?.latestMessages.chat;
    expect(preview.text).toBe("Sending now");
    expect(preview.author).toBe("You");
    expect(preview.created_at).toBeTruthy();
    expect(client.isFetching()).toBe(0);
    client.clear();
  });

  it("shows the still-sending direct message at the top of the list", () => {
    const client = new QueryClient();
    const key = ["dm-conversations", "paul"];
    client.setQueryData(key, [dmRow]);
    applyPendingInboxPreview(client, "dm", "paul", "dm-1", { text: "Sending now", image_url: null });
    const data = client.getQueryData<any[]>(key)!;
    expect(data[0].last_message.text).toBe("Sending now");
    expect(data[0].last_message.author_id).toBe("paul");
    expect(data[0].updated_at).not.toBe(dmRow.updated_at);
    client.clear();
  });

  it("keeps the pending preview while an older in-flight fetch finishes", async () => {
    const client = new QueryClient();
    const key = ["my-chat-groups-with-messages", "paul"];
    const data = { groups: [{ id: "chat" }], latestMessages: {} };
    client.setQueryData(key, data);
    let finish: ((value: typeof data) => void) | undefined;
    const fetch = client.fetchQuery({ queryKey: key, queryFn: () => new Promise<typeof data>((resolve) => { finish = resolve; }) });
    applyPendingInboxPreview(client, "group", "paul", "chat", { text: "Sending now", image_url: null });
    finish?.(data);
    await fetch;
    expect(client.getQueryData<any>(key)?.latestMessages.chat.text).toBe("Sending now");
    client.clear();
  });

  it("yields to a newer remote preview that lands while the send is in flight", () => {
    const client = new QueryClient();
    const key = ["my-chat-groups-with-messages", "paul"];
    const data = { groups: [{ id: "chat" }], latestMessages: {} };
    client.setQueryData(key, data);
    applyPendingInboxPreview(client, "group", "paul", "chat", { text: "Sending now", image_url: null });
    const newer = { text: "Reply from Alex", author: "Alex", created_at: "2026-10-28T23:59:00Z", image_url: null };
    client.setQueryData(key, { ...data, latestMessages: { chat: newer } });
    expect(client.getQueryData<any>(key)?.latestMessages.chat).toEqual(newer);
    client.clear();
  });

  it("settling lets the acknowledged copy and later refetches own the preview", async () => {
    const client = new QueryClient();
    const key = ["my-chat-groups-with-messages", "paul"];
    const data = { groups: [{ id: "chat" }], latestMessages: {} };
    client.setQueryData(key, data);
    applyPendingInboxPreview(client, "group", "paul", "chat", { text: "Sending now", image_url: null });
    settlePendingInboxPreview(client, "group", "paul", "chat");
    // A refetch that does not yet contain the send no longer gets overridden.
    const fetched = { groups: [{ id: "chat" }], latestMessages: {} };
    await client.fetchQuery({ queryKey: key, queryFn: async () => fetched });
    expect(client.getQueryData(key)).toEqual(fetched);
    client.clear();
  });

  it("settling a direct message swaps in the acknowledged row", () => {
    const client = new QueryClient();
    const key = ["dm-conversations", "paul"];
    client.setQueryData(key, [dmRow]);
    applyPendingInboxPreview(client, "dm", "paul", "dm-1", { text: "Sending now", image_url: null });
    settlePendingInboxPreview(client, "dm", "paul", "dm-1", {
      text: "Sending now",
      image_url: null,
      created_at: "2026-10-28T21:00:00Z",
    });
    const data = client.getQueryData<any[]>(key)!;
    expect(data[0].last_message.text).toBe("Sending now");
    expect(data[0].last_message.created_at).toBe("2026-10-28T21:00:00Z");
    client.clear();
  });

  it("a failed send restores the previous preview", () => {
    const client = new QueryClient();
    const key = ["my-teams-with-messages", "paul"];
    const previous = { text: "Older", author: "Alex", created_at: "2026-10-28T19:00:00Z", image_url: null };
    client.setQueryData(key, { teams: [{ id: "chat" }], latestMessages: { chat: previous } });
    applyPendingInboxPreview(client, "team", "paul", "chat", { text: "Sending now", image_url: null });
    discardPendingInboxPreview(client, "team", "paul", "chat");
    expect(client.getQueryData<any>(key)?.latestMessages.chat).toEqual(previous);
    // And a later refetch is no longer protected.
    const fetched = { teams: [{ id: "chat" }], latestMessages: {} };
    client.setQueryData(key, fetched);
    expect(client.getQueryData(key)).toEqual(fetched);
    client.clear();
  });

  it("a failed send restores the previous direct-message row exactly", () => {
    const client = new QueryClient();
    const key = ["dm-conversations", "paul"];
    client.setQueryData(key, [dmRow]);
    applyPendingInboxPreview(client, "dm", "paul", "dm-1", { text: "Sending now", image_url: null });
    discardPendingInboxPreview(client, "dm", "paul", "dm-1");
    expect(client.getQueryData(key)).toEqual([dmRow]);
    client.clear();
  });

  it("a failed send with no previous preview clears the row", () => {
    const client = new QueryClient();
    const key = ["member-clubs-with-messages", "paul"];
    client.setQueryData(key, { clubs: [{ id: "chat" }], latestMessages: {} });
    applyPendingInboxPreview(client, "club", "paul", "chat", { text: "Sending now", image_url: null });
    discardPendingInboxPreview(client, "club", "paul", "chat");
    expect(client.getQueryData<any>(key)?.latestMessages.chat).toBeUndefined();
    client.clear();
  });

  it("never borrows another account's list or touches unlisted conversations", () => {
    const client = new QueryClient();
    const otherKey = ["member-clubs-with-messages", "other"];
    const data = { clubs: [{ id: "chat" }], latestMessages: {} };
    client.setQueryData(otherKey, data);
    client.setQueryData(["dm-conversations", "other"], [dmRow]);
    applyPendingInboxPreview(client, "club", "paul", "chat", { text: "Sending now", image_url: null });
    applyPendingInboxPreview(client, "dm", "paul", "dm-1", { text: "Sending now", image_url: null });
    applyPendingInboxPreview(client, "club", "paul", "unlisted", { text: "Sending now", image_url: null });
    expect(client.getQueryData(otherKey)).toEqual(data);
    expect(client.getQueryData(["dm-conversations", "other"])).toEqual([dmRow]);
    expect(client.getQueryData(["member-clubs-with-messages", "paul"])).toBeUndefined();
    client.clear();
  });

  it("consecutive sends to one chat update the preview without stacking marks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T22:00:00Z"));
    const client = new QueryClient();
    const key = ["my-chat-groups-with-messages", "paul"];
    client.setQueryData(key, { groups: [{ id: "chat" }], latestMessages: {} });
    applyPendingInboxPreview(client, "group", "paul", "chat", { text: "First", image_url: null });
    vi.advanceTimersByTime(2000);
    applyPendingInboxPreview(client, "group", "paul", "chat", { text: "Second", image_url: null });
    expect(client.getQueryData<any>(key)?.latestMessages.chat.text).toBe("Second");
    // One settle clears both.
    settlePendingInboxPreview(client, "group", "paul", "chat");
    const fetched = { groups: [{ id: "chat" }], latestMessages: {} };
    client.setQueryData(key, fetched);
    expect(client.getQueryData(key)).toEqual(fetched);
    client.clear();
  });
});
