import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
vi.mock("@/hooks/useDebounce", () => ({ useDebounce: (value: string) => value }));
import { useChatHistorySearch } from "./useChatHistorySearch";

type Message = { id: string; text: string };
const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };

function setup(fetcher: (query: string, signal: AbortSignal) => Promise<Message[]>) {
  return renderHook(({ query, cacheKey = "team:1" }) => {
    const [messages, setMessages] = useState<Message[]>([{ id: "loaded", text: "Loaded" }]);
    const search = useChatHistorySearch({ searchQuery: query, loadedMessages: messages, setMessages, fetcher, cacheKey });
    return { messages, ...search };
  }, { initialProps: { query: "", cacheKey: "team:1" } });
}

describe("useChatHistorySearch race and merge safety", () => {

  it("does not query below the minimum and permits a local empty state", async () => {
    const fetcher = vi.fn();
    const hook = setup(fetcher);
    hook.rerender({ query: "x", cacheKey: "team:1" });
    await act(async () => {});
    expect(fetcher).not.toHaveBeenCalled();
    expect(hook.result.current.canShowEmpty).toBe(true);
  });

  it("shows searching throughout debounce and server execution", async () => {
    const request = deferred<Message[]>();
    const hook = setup(() => request.promise);
    hook.rerender({ query: "older", cacheKey: "team:1" });
    expect(hook.result.current.isSearching).toBe(true);
    await act(async () => {});
    expect(hook.result.current.isSearching).toBe(true);
    expect(hook.result.current.canShowEmpty).toBe(false);
    await act(async () => request.resolve([]));
    await waitFor(() => expect(hook.result.current.isSearching).toBe(false));
    expect(hook.result.current.canShowEmpty).toBe(true);
  });

  it("merges unseen history without duplicating loaded rows", async () => {
    const hook = setup(async () => [{ id: "loaded", text: "Duplicate" }, { id: "old", text: "Old result" }]);
    hook.rerender({ query: "old", cacheKey: "team:1" });
    await act(async () => {});
    await waitFor(() => expect(hook.result.current.messages.map((m) => m.id)).toEqual(["loaded", "old"]));
  });

  it("aborts the older request and never merges its late response", async () => {
    const first = deferred<Message[]>();
    const second = deferred<Message[]>();
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn((q: string, signal: AbortSignal) => { signals.push(signal); return q === "first" ? first.promise : second.promise; });
    const hook = setup(fetcher);
    hook.rerender({ query: "first", cacheKey: "team:1" });
    await act(async () => {});
    hook.rerender({ query: "second", cacheKey: "team:1" });
    await act(async () => {});
    expect(signals[0].aborted).toBe(true);
    await act(async () => first.resolve([{ id: "stale", text: "Stale" }]));
    await act(async () => second.resolve([{ id: "fresh", text: "Fresh" }]));
    await waitFor(() => expect(hook.result.current.messages.map((m) => m.id)).toContain("fresh"));
    expect(hook.result.current.messages.map((m) => m.id)).not.toContain("stale");
  });

  it("treats a failed latest search as settled without destroying loaded messages", async () => {
    const hook = setup(async () => { throw new Error("synthetic search failure"); });
    hook.rerender({ query: "failure", cacheKey: "team:1" });
    await act(async () => {});
    await waitFor(() => expect(hook.result.current.canShowEmpty).toBe(true));
    expect(hook.result.current.messages).toEqual([{ id: "loaded", text: "Loaded" }]);
  });

  it("re-runs the same query when the conversation cache key changes", async () => {
    const fetcher = vi.fn(async () => []);
    const hook = setup(fetcher);
    hook.rerender({ query: "hello", cacheKey: "team:1" });
    await act(async () => {});
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    hook.rerender({ query: "hello", cacheKey: "team:2" });
    await act(async () => {});
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });
});
