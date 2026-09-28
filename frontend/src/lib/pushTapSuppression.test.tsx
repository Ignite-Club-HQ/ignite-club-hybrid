import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSuppressedChatScope,
  suppressChatScope,
  useSuppressedChatScopes,
} from "./pushTapSuppression";

describe("push-tap unread suppression", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T12:00:00Z"));
    for (const kind of ["team", "club", "club_admin", "group", "dm", "broadcast"] as const) {
      clearSuppressedChatScope(kind, null);
      clearSuppressedChatScope(kind, "scope-1");
      clearSuppressedChatScope(kind, "scope-2");
    }
  });

  it("suppresses only the exact chat scope selected from a push", () => {
    const { result } = renderHook(() => useSuppressedChatScopes());
    act(() => {
      suppressChatScope("team", "scope-1", 1000);
      suppressChatScope("team", "scope-2", 1000);
      suppressChatScope("club", "scope-1", 1000);
    });
    expect(result.current.map(({ kind, targetId }) => `${kind}:${targetId}`).sort()).toEqual([
      "club:scope-1", "team:scope-1", "team:scope-2",
    ]);
  });

  it("deduplicates repeated taps and extends rather than shortens suppression", () => {
    const { result } = renderHook(() => useSuppressedChatScopes());
    act(() => suppressChatScope("dm", "scope-1", 1000));
    const firstExpiry = result.current[0].expiresAt;
    act(() => {
      vi.advanceTimersByTime(100);
      suppressChatScope("dm", "scope-1", 3000);
      suppressChatScope("dm", "scope-1", 250);
    });
    expect(result.current).toHaveLength(1);
    expect(result.current[0].expiresAt).toBeGreaterThan(firstExpiry);
  });

  it("automatically releases a scope after its suppression window", () => {
    const { result } = renderHook(() => useSuppressedChatScopes());
    act(() => suppressChatScope("group", "scope-1", 500));
    expect(result.current).toHaveLength(1);
    act(() => vi.advanceTimersByTime(521));
    expect(result.current).toEqual([]);
  });

  it("can clear one scope after its read receipt without affecting other chats", () => {
    const { result } = renderHook(() => useSuppressedChatScopes());
    act(() => {
      suppressChatScope("team", "scope-1");
      suppressChatScope("team", "scope-2");
      clearSuppressedChatScope("team", "scope-1");
    });
    expect(result.current).toMatchObject([{ kind: "team", targetId: "scope-2" }]);
  });
});
