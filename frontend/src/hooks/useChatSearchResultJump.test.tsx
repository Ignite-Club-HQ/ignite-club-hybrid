import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSearchResultJump } from "./useChatSearchResultJump";

type Row = { id: string };
function deferred() {
  let resolve: (rows: Row[]) => void = () => {};
  const promise = new Promise<Row[]>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("search result jumps", () => {
  function setup(loadContext: (row: Row) => Promise<Row[]>) {
    const jump = vi.fn();
    const mergeContext = vi.fn();
    const closeSearch = vi.fn();
    const hook = renderHook(({ scopeKey }) => useChatSearchResultJump({
      scopeKey, getMessages: () => [{ id: "a" }, { id: "b" }],
      loadContext, jump, mergeContext, closeSearch,
    }), { initialProps: { scopeKey: "account:club1" } });
    return { hook, jump, mergeContext, closeSearch };
  }
  it("jumps in the next frame while optional context is still pending", async () => {
    const pending = deferred();
    const { hook, jump, closeSearch, mergeContext } = setup(() => pending.promise);
    act(() => hook.result.current("a"));
    expect(closeSearch).toHaveBeenCalledOnce();
    await act(() => vi.advanceTimersByTimeAsync(16));
    expect(jump).toHaveBeenCalledWith("a");
    expect(mergeContext).not.toHaveBeenCalled();
  });
  it("only the latest selection may jump or merge late context", async () => {
    const a = deferred(); const b = deferred();
    const { hook, jump, mergeContext } = setup((row) => row.id === "a" ? a.promise : b.promise);
    act(() => { hook.result.current("a"); hook.result.current("b"); });
    await act(() => vi.advanceTimersByTimeAsync(16));
    expect(jump.mock.calls).toEqual([["b"]]);
    await act(async () => { b.resolve([{ id: "context-b" }]); a.resolve([{ id: "context-a" }]); });
    expect(mergeContext.mock.calls).toEqual([[[{ id: "context-b" }]]]);
  });
  it("discards pending continuations after account or thread changes", async () => {
    const pending = deferred();
    const { hook, jump, mergeContext } = setup(() => pending.promise);
    act(() => hook.result.current("a"));
    hook.rerender({ scopeKey: "other-account:club2" });
    await act(() => vi.advanceTimersByTimeAsync(16));
    await act(async () => pending.resolve([{ id: "private-context" }]));
    expect(jump).not.toHaveBeenCalled();
    expect(mergeContext).not.toHaveBeenCalled();
  });
  it("still jumps when optional context fails", async () => {
    const { hook, jump } = setup(async () => { throw new Error("context unavailable"); });
    act(() => hook.result.current("a"));
    await act(() => vi.advanceTimersByTimeAsync(16));
    expect(jump).toHaveBeenCalledWith("a");
  });
});