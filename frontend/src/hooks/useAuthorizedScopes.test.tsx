import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { membershipKeys } from "@/lab/membershipQueryKeys";

// Mocks -----------------------------------------------------------------------
const rolesResult = { data: [] as unknown, error: null as unknown };
const groupsResult = { data: [] as unknown, error: null as unknown };
const dmsResult = { data: [] as unknown, error: null as unknown };

function makeBuilder(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  b.select = chain;
  b.eq = () => Promise.resolve(result);
  b.or = () => Promise.resolve(result);
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "user_roles") return makeBuilder(rolesResult);
      if (table === "group_members") return makeBuilder(groupsResult);
      if (table === "direct_conversations") return makeBuilder(dmsResult);
      return makeBuilder({ data: [], error: null });
    },
  },
}));

const authState: { user: { id: string } | null } = { user: { id: "u1" } };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authState }));

const revokeScopeMock = vi.fn();
vi.mock("@/lib/realtimeChannelRegistry", () => ({
  revokeScope: (...args: unknown[]) => revokeScopeMock(...args),
}));

import { useAuthorizedScopes } from "./useAuthorizedScopes";

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  revokeScopeMock.mockClear();
  authState.user = { id: "u1" };
  rolesResult.data = [];
  rolesResult.error = null;
  groupsResult.data = [];
  groupsResult.error = null;
  dmsResult.data = [];
  dmsResult.error = null;
});

describe("useAuthorizedScopes", () => {
  it("returns loading with no user", () => {
    authState.user = null;
    const { result } = renderHook(() => useAuthorizedScopes(), { wrapper });
    expect(result.current.status).toBe("loading");
  });

  it("resolves ready with populated membership sets", async () => {
    rolesResult.data = [
      { club_id: "c1", team_id: "t1" },
      { club_id: "c1", team_id: "t2" },
      { club_id: "c2", team_id: null },
    ];
    groupsResult.data = [{ group_id: "g1" }];
    dmsResult.data = [{ id: "d1" }, { id: "d2" }];

    const { result } = renderHook(() => useAuthorizedScopes(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect([...result.current.clubIds].sort()).toEqual(["c1", "c2"]);
    expect([...result.current.teamIds].sort()).toEqual(["t1", "t2"]);
    expect([...result.current.groupIds]).toEqual(["g1"]);
    expect([...result.current.dmConversationIds].sort()).toEqual(["d1", "d2"]);
  });

  it("fails closed when any query errors", async () => {
    rolesResult.error = new Error("boom");
    const { result } = renderHook(() => useAuthorizedScopes(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.clubIds.size).toBe(0);
    expect(result.current.teamIds.size).toBe(0);
  });

  it("revokes scopes the user has lost when membership changes", async () => {
    rolesResult.data = [{ club_id: "c1", team_id: "t1" }];
    groupsResult.data = [{ group_id: "g1" }];
    dmsResult.data = [{ id: "d1" }];

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const w = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAuthorizedScopes(), { wrapper: w });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // Simulate membership shrinking.
    rolesResult.data = [];
    groupsResult.data = [];
    dmsResult.data = [];
    await act(async () => {
      await client.invalidateQueries({ queryKey: membershipKeys.authorizedScopesFor("u1") });
    });
    await waitFor(() => expect(result.current.teamIds.size).toBe(0));

    expect(revokeScopeMock).toHaveBeenCalledWith("u1", { kind: "club", id: "c1" });
    expect(revokeScopeMock).toHaveBeenCalledWith("u1", { kind: "team", id: "t1" });
    expect(revokeScopeMock).toHaveBeenCalledWith("u1", { kind: "group", id: "g1" });
    expect(revokeScopeMock).toHaveBeenCalledWith("u1", { kind: "dm", id: "d1" });
  });
});
