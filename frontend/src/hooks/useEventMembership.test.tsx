import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

import { useEventMembership } from "./useEventMembership";

type Result = { data?: unknown; error?: unknown };
function query(result: Result) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of ["select", "eq", "limit", "in"]) chain[name] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  Object.defineProperty(chain, "then", {
    value: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve),
  });
  return chain;
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}

describe("useEventMembership", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts a direct team role without querying child membership", async () => {
    from.mockReturnValueOnce(query({ data: [{ id: "role-1" }] }));
    const { result } = renderHook(
      () => useEventMembership({ team_id: "team-1", club_id: "club-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe(true));
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("accepts a parent whose child is assigned to the team", async () => {
    from
      .mockReturnValueOnce(query({ data: null }))
      .mockReturnValueOnce(query({ data: [{ id: "child-1" }] }));
    const { result } = renderHook(
      () => useEventMembership({ team_id: "team-1", club_id: "club-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe(true));
  });

  it("accepts a guardian-linked child assigned to the team", async () => {
    from
      .mockReturnValueOnce(query({ data: null }))
      .mockReturnValueOnce(query({ data: [] }))
      .mockReturnValueOnce(query({ data: [{ child_id: "child-1" }] }))
      .mockReturnValueOnce(query({ data: [{ child_id: "child-1" }] }));
    const { result } = renderHook(
      () => useEventMembership({ team_id: "team-1", club_id: "club-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe(true));
  });

  it("denies a team event to a user with no direct or child membership", async () => {
    from
      .mockReturnValueOnce(query({ data: null }))
      .mockReturnValueOnce(query({ data: [] }))
      .mockReturnValueOnce(query({ data: [] }));
    const { result } = renderHook(
      () => useEventMembership({ team_id: "team-1", club_id: "club-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe(false));
  });

  it("uses club roles for club-wide events", async () => {
    from.mockReturnValueOnce(query({ data: { id: "role-1" } }));
    const { result } = renderHook(
      () => useEventMembership({ team_id: null, club_id: "club-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe(true));
  });
});
