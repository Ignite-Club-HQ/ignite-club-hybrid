import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAllChatDrafts, useAllChatDrafts, useChatDraft } from "./useChatDraft";

describe("chat draft isolation and lifecycle", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("keeps drafts isolated when the user switches conversations", () => {
    const { result, rerender } = renderHook(({ id }) => useChatDraft(id), { initialProps: { id: "team-1" } });
    act(() => result.current[1]("Team draft"));
    rerender({ id: "team-2" });
    expect(result.current[0]).toBe("");
    act(() => result.current[1]("Other draft"));
    rerender({ id: "team-1" });
    expect(result.current[0]).toBe("Team draft");
  });

  it("supports functional composer updates and clears only the active draft", () => {
    sessionStorage.setItem("chat_draft_other", JSON.stringify({ text: "Keep", updatedAt: "2026-01-01" }));
    const { result } = renderHook(() => useChatDraft("active"));
    act(() => result.current[1]((previous) => `${previous}Hello`));
    act(() => result.current[1]((previous) => `${previous} world`));
    expect(result.current[0]).toBe("Hello world");
    act(() => result.current[2]());
    expect(result.current[0]).toBe("");
    expect(getAllChatDrafts()).toMatchObject({ other: { text: "Keep" } });
  });

  it("restores legacy plain-text drafts and ignores malformed structured drafts", () => {
    sessionStorage.setItem("chat_draft_legacy", "Old draft");
    sessionStorage.setItem("chat_draft_bad", "{broken");
    expect(renderHook(() => useChatDraft("legacy")).result.current[0]).toBe("Old draft");
    expect(renderHook(() => useChatDraft("bad")).result.current[0]).toBe("");
  });

  it("coalesces rapid keystrokes into one subscriber refresh to protect IME composition", () => {
    const event = vi.fn();
    window.addEventListener("chat-draft-changed", event);
    const { result } = renderHook(() => useChatDraft("team-1"));
    act(() => {
      result.current[1]("b");
      result.current[1]("be");
      result.current[1]("because");
    });
    act(() => vi.advanceTimersByTime(249));
    expect(event).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(event).toHaveBeenCalledOnce();
    window.removeEventListener("chat-draft-changed", event);
  });

  it("updates the all-drafts view after the coalesced event", () => {
    const all = renderHook(() => useAllChatDrafts());
    const active = renderHook(() => useChatDraft("group-1"));
    act(() => active.result.current[1]("Group note"));
    expect(all.result.current).toEqual({});
    act(() => vi.advanceTimersByTime(250));
    expect(all.result.current["group-1"].text).toBe("Group note");
  });
});
