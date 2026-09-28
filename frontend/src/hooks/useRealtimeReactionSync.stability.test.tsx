import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useRealtimeReactionSync } from "./useRealtimeReactionSync";

type Msg = { id: string; reactions?: any[] | null };

/**
 * Chat pages list the reaction callbacks in their realtime effect dependency
 * arrays. If the callbacks change identity on ordinary renders, the Postgres
 * channel is torn down and recreated repeatedly and the page can stay stuck on
 * its loading spinner (observed on club-admin threads). Callers pass INLINE
 * arrow functions for `getLocalMessages` / `readMessages` / `writeMessages`, so
 * the hook must stay stable regardless.
 */
describe("useRealtimeReactionSync callback stability", () => {
  it("keeps callbacks referentially stable across rerenders with inline options", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const localRef = { current: [{ id: "m1" }] as Msg[] };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result, rerender } = renderHook(
      () =>
        useRealtimeReactionSync<Msg>({
          scopeKey: "club-admin:a",
          // new array identity every render, same content
          queryKey: ["club-admin-messages", "a"],
          setLocalMessages: (() => {}) as any,
          readMessages: (old: any) => old?.messages || [],
          writeMessages: (old: any, next: Msg[]) => ({ ...(old || {}), messages: next }),
          getLocalMessages: () => localRef.current,
        }),
      { wrapper },
    );

    const first = result.current;
    rerender();
    rerender();
    expect(result.current.applyRealtimeReaction).toBe(first.applyRealtimeReaction);
    expect(result.current.applyRealtimeReactionDelete).toBe(first.applyRealtimeReactionDelete);
  });

  it("still enforces scope after the stability latch", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["scoped-messages", "a"], { messages: [{ id: "m1" }] });
    let local: Msg[] = [{ id: "m1" }];
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () =>
        useRealtimeReactionSync<Msg>({
          scopeKey: "group:a",
          queryKey: ["scoped-messages", "a"],
          setLocalMessages: ((updater: any) => {
            local = typeof updater === "function" ? updater(local) : updater;
          }) as any,
          getLocalMessages: () => local,
        }),
      { wrapper },
    );

    result.current.applyRealtimeReaction("m-other", { id: "r1", user_id: "u1", reaction_type: "👍" });
    let cached: any = client.getQueryData(["scoped-messages", "a"]);
    expect(cached.messages[0].reactions ?? []).toHaveLength(0);

    result.current.applyRealtimeReaction("m1", { id: "r1", user_id: "u1", reaction_type: "👍" });
    cached = client.getQueryData(["scoped-messages", "a"]);
    expect(cached.messages[0].reactions).toHaveLength(1);
  });
});
