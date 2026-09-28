import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, invalidateQueries, authState, queryOptions, mutations } = vi.hoisted(() => ({
  from: vi.fn(),
  invalidateQueries: vi.fn(),
  authState: { user: null as { id: string } | null },
  queryOptions: { current: null as any },
  mutations: [] as any[],
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authState }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
  useQuery: (options: any) => {
    queryOptions.current = options;
    return { data: options.enabled ? ["blocked-existing"] : undefined, isLoading: false };
  },
  useMutation: (options: any) => {
    mutations.push(options);
    return {
      mutateAsync: async (input: any) => {
        const value = await options.mutationFn(input);
        options.onSuccess?.(value);
        return value;
      },
    };
  },
}));

import { useBlockedUsers } from "./useBlockedUsers";

function selectQuery(data: unknown = [], error: unknown = null) {
  const query: any = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  Object.defineProperty(query, "then", {
    value: (resolve: any) => Promise.resolve({ data, error }).then(resolve),
  });
  return query;
}

function insertQuery(error: unknown = null) {
  return { insert: vi.fn().mockResolvedValue({ error }) };
}

function deleteQuery(error: unknown = null) {
  const query: any = {};
  query.delete = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  Object.defineProperty(query, "then", {
    value: (resolve: any) => Promise.resolve({ error }).then(resolve),
  });
  return query;
}

describe("useBlockedUsers messaging permission boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutations.length = 0;
    queryOptions.current = null;
    authState.user = { id: "user-1" };
  });

  it("disables blocked-user discovery without an authenticated identity", () => {
    authState.user = null;
    const { result } = renderHook(() => useBlockedUsers());

    expect(queryOptions.current.enabled).toBe(false);
    expect(queryOptions.current.queryKey).toEqual(["blocked-users", undefined]);
    expect(result.current.blockedUserIds).toEqual([]);
    expect(result.current.isBlocked("blocked-existing")).toBe(false);
  });

  it("loads only rows where the current user is the blocker", async () => {
    const query = selectQuery([
      { blocked_id: "user-2" },
      { blocked_id: "user-3" },
    ]);
    from.mockReturnValueOnce(query);
    renderHook(() => useBlockedUsers());

    await expect(queryOptions.current.queryFn()).resolves.toEqual([
      "user-2",
      "user-3",
    ]);
    expect(from).toHaveBeenCalledWith("blocked_users");
    expect(query.select).toHaveBeenCalledWith("blocked_id");
    expect(query.eq).toHaveBeenCalledWith("blocker_id", "user-1");
  });

  it("propagates permission failures instead of treating them as an empty block list", async () => {
    from.mockReturnValueOnce(selectQuery([], { message: "RLS denied" }));
    renderHook(() => useBlockedUsers());

    await expect(queryOptions.current.queryFn()).rejects.toEqual({
      message: "RLS denied",
    });
  });

  it("creates a block with the authenticated blocker identity and optional reason", async () => {
    const query = insertQuery();
    from.mockReturnValueOnce(query);
    const { result } = renderHook(() => useBlockedUsers());

    await act(async () =>
      result.current.blockUser.mutateAsync({
        blockedId: "user-2",
        reason: "Harassment",
      }),
    );

    expect(query.insert).toHaveBeenCalledWith({
      blocker_id: "user-1",
      blocked_id: "user-2",
      reason: "Harassment",
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["blocked-users", "user-1"],
    });
  });

  it("does not invalidate successful state when block insertion is denied", async () => {
    from.mockReturnValueOnce(insertQuery({ message: "block denied" }));
    const { result } = renderHook(() => useBlockedUsers());

    await expect(
      act(async () =>
        result.current.blockUser.mutateAsync({ blockedId: "user-2" }),
      ),
    ).rejects.toEqual({ message: "block denied" });
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("deletes only the current user's exact block relationship", async () => {
    const query = deleteQuery();
    from.mockReturnValueOnce(query);
    const { result } = renderHook(() => useBlockedUsers());

    await act(async () => result.current.unblockUser.mutateAsync("user-2"));

    expect(query.delete).toHaveBeenCalledOnce();
    expect(query.eq.mock.calls).toEqual([
      ["blocker_id", "user-1"],
      ["blocked_id", "user-2"],
    ]);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["blocked-users", "user-1"],
    });
  });

  it("reports membership from the cached block list", () => {
    const { result } = renderHook(() => useBlockedUsers());

    expect(result.current.isBlocked("blocked-existing")).toBe(true);
    expect(result.current.isBlocked("other-user")).toBe(false);
  });
});
