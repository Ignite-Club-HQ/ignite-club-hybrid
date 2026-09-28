import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockUser: { id: string } | null = { id: "user-1" };
let currentUser: { id: string } | null = mockUser;

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: currentUser }),
}));

const maybeSingle = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: () => ({ maybeSingle }),
          }),
        }),
      }),
    }),
  },
}));

import { useIsAppAdmin, isAppAdminQueryKey } from "./useIsAppAdmin";

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("useIsAppAdmin", () => {
  beforeEach(() => {
    currentUser = { id: "user-1" };
    maybeSingle.mockReset();
  });

  it("resolves true for a confirmed app admin", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "role-1" }, error: null });
    const { result } = renderHook(() => useIsAppAdmin(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isAppAdmin).toBe(true));
  });

  it("resolves false for an ordinary user", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useIsAppAdmin(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAppAdmin).toBe(false);
  });

  it("is false while the permission query is loading", () => {
    maybeSingle.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useIsAppAdmin(), { wrapper: wrapper(newClient()) });
    expect(result.current.isAppAdmin).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });

  it("is false when the permission query errors", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useIsAppAdmin(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(maybeSingle).toHaveBeenCalled());
    expect(result.current.isAppAdmin).toBe(false);
  });

  it("is false with no authenticated user and does not query", () => {
    currentUser = null;
    const { result } = renderHook(() => useIsAppAdmin(), { wrapper: wrapper(newClient()) });
    expect(result.current.isAppAdmin).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("keys the cache per user so a cached false cannot leak across users", async () => {
    const client = newClient();
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const first = renderHook(() => useIsAppAdmin(), { wrapper: wrapper(client) });
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    expect(client.getQueryData(isAppAdminQueryKey("user-1"))).toBe(false);

    currentUser = { id: "user-2" };
    maybeSingle.mockResolvedValue({ data: { id: "role-9" }, error: null });
    const second = renderHook(() => useIsAppAdmin(), { wrapper: wrapper(client) });
    await waitFor(() => expect(second.result.current.isAppAdmin).toBe(true));
    expect(client.getQueryData(isAppAdminQueryKey("user-1"))).toBe(false);
    expect(client.getQueryData(isAppAdminQueryKey("user-2"))).toBe(true);
  });

  it("shares one cache entry between two consumers (AppHeader + BroadcastChatPage pattern)", async () => {
    const client = newClient();
    maybeSingle.mockResolvedValue({ data: { id: "role-1" }, error: null });
    const a = renderHook(() => useIsAppAdmin(), { wrapper: wrapper(client) });
    const b = renderHook(() => useIsAppAdmin(), { wrapper: wrapper(client) });
    await waitFor(() => expect(a.result.current.isAppAdmin).toBe(true));
    await waitFor(() => expect(b.result.current.isAppAdmin).toBe(true));
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });
});
