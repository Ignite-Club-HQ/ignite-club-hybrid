import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { applyConfirmedInboxPreview } from "./confirmedInboxPreview";

const saved = { text: "Second message", image_url: null, created_at: "2026-10-24T06:29:00Z" };
describe("confirmed inbox previews", () => {
  it.each([
    ["team", "my-teams-with-messages", "teams"],
    ["club", "member-clubs-with-messages", "clubs"],
    ["group", "my-chat-groups-with-messages", "groups"],
  ] as const)("updates %s immediately without a list refetch", (scope, prefix, collection) => {
    const client = new QueryClient();
    const key = [prefix, "paul"];
    client.setQueryData(key, { [collection]: [{ id: "chat" }], latestMessages: {} });
    applyConfirmedInboxPreview(client, scope, "paul", "chat", saved);
    expect(client.getQueryData<any>(key)?.latestMessages.chat).toEqual({ ...saved, author: "You" });
    expect(client.isFetching()).toBe(0);
    client.clear();
  });
  it("preserves the acknowledgement while an older in-flight fetch finishes", async () => {
    const client = new QueryClient();
    const key = ["my-chat-groups-with-messages", "paul"];
    const data = { groups: [{ id: "chat" }], latestMessages: {} };
    client.setQueryData(key, data);
    let finish: ((value: typeof data) => void) | undefined;
    const fetch = client.fetchQuery({ queryKey: key, queryFn: () => new Promise<typeof data>((resolve) => { finish = resolve; }) });
    applyConfirmedInboxPreview(client, "group", "paul", "chat", saved);
    finish?.(data);
    await fetch;
    expect(client.getQueryData<any>(key)?.latestMessages.chat.text).toBe("Second message");
    client.clear();
  });
  it("does not regress when consecutive acknowledgements arrive out of order", () => {
    const client = new QueryClient();
    const key = ["my-teams-with-messages", "paul"];
    client.setQueryData(key, { teams: [{ id: "chat" }], latestMessages: {} });
    applyConfirmedInboxPreview(client, "team", "paul", "chat", saved);
    applyConfirmedInboxPreview(client, "team", "paul", "chat", { ...saved, text: "First", created_at: "2026-10-24T06:28:00Z" });
    expect(client.getQueryData<any>(key)?.latestMessages.chat.text).toBe("Second message");
    client.clear();
  });
  it("never borrows another account's list or creates unlisted conversations", () => {
    const client = new QueryClient();
    const key = ["member-clubs-with-messages", "other"];
    const data = { clubs: [{ id: "chat" }], latestMessages: {} };
    client.setQueryData(key, data);
    applyConfirmedInboxPreview(client, "club", "paul", "chat", saved);
    applyConfirmedInboxPreview(client, "club", "other", "unlisted", saved);
    expect(client.getQueryData(key)).toEqual(data);
    expect(client.getQueryData(["member-clubs-with-messages", "paul"])).toBeUndefined();
    client.clear();
  });
  it("accepts newer remote previews and clears protection on sign-out", () => {
    const client = new QueryClient();
    const key = ["my-chat-groups-with-messages", "paul"];
    const data = { groups: [{ id: "chat" }], latestMessages: {} };
    client.setQueryData(key, data);
    applyConfirmedInboxPreview(client, "group", "paul", "chat", saved);
    const newer = { ...saved, author: "Alex", text: "Reply", created_at: "2026-10-24T06:30:00Z" };
    client.setQueryData(key, { ...data, latestMessages: { chat: newer } });
    expect(client.getQueryData<any>(key)?.latestMessages.chat).toEqual(newer);
    client.clear();
    client.setQueryData(key, data);
    expect(client.getQueryData(key)).toEqual(data);
    client.clear();
  });
});