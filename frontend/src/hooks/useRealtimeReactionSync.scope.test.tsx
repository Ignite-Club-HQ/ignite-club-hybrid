import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useRealtimeReactionSync } from "./useRealtimeReactionSync";

type Msg = { id: string; reactions?: any[] | null };

function setup(localMessages: Msg[] | undefined, cached: Msg[] | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cached) client.setQueryData(["scoped-messages", "a"], { messages: cached });
  const setLocal = (updater: any) => {
    const next = typeof updater === "function" ? updater(localMessages) : updater;
    if (next) localMessages = next;
  };
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () =>
      useRealtimeReactionSync<Msg>({
        scopeKey: "group:a",
        queryKey: ["scoped-messages", "a"],
        setLocalMessages: setLocal as any,
        getLocalMessages: () => localMessages,
      }),
    { wrapper },
  );
  return { client, result, read: () => localMessages };
}

describe("useRealtimeReactionSync scope enforcement", () => {
  it("ignores reactions whose parent message is not loaded in this chat", () => {
    const { client, result } = setup([{ id: "m1" }], [{ id: "m1" }]);
    result.current.applyRealtimeReaction("m-other-group", {
      id: "r1",
      user_id: "u1",
      reaction_type: "👍",
    });
    const cached: any = client.getQueryData(["scoped-messages", "a"]);
    expect(cached.messages).toHaveLength(1);
    expect(cached.messages[0].reactions ?? []).toHaveLength(0);
  });

  it("applies reactions for messages loaded in this chat", () => {
    const { client, result } = setup([{ id: "m1" }], [{ id: "m1" }]);
    result.current.applyRealtimeReaction("m1", {
      id: "r1",
      user_id: "u1",
      reaction_type: "👍",
    });
    const cached: any = client.getQueryData(["scoped-messages", "a"]);
    expect(cached.messages[0].reactions).toHaveLength(1);
  });

  it("ignores deletes targeting out-of-scope messages", () => {
    const { client, result } = setup([{ id: "m1", reactions: [{ id: "r1" }] }], [
      { id: "m1", reactions: [{ id: "r1" }] },
    ]);
    result.current.applyRealtimeReactionDelete("m-other-group", "r1");
    const cached: any = client.getQueryData(["scoped-messages", "a"]);
    expect(cached.messages[0].reactions).toHaveLength(1);
  });
});
