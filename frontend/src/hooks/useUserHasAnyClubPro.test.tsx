import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const rolesResult: { data: unknown; error: unknown } = { data: [], error: null };
const teamsResult: { data: unknown; error: unknown } = { data: [], error: null };
const subsResult: { data: unknown; error: unknown } = { data: [], error: null };

function makeBuilder(res: { data: unknown; error: unknown }) {
  return {
    select: () => ({
      eq: () => Promise.resolve(res),
      in: () => Promise.resolve(res),
    }),
  };
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "user_roles") return makeBuilder(rolesResult);
      if (table === "teams") return makeBuilder(teamsResult);
      if (table === "club_subscriptions") return makeBuilder(subsResult);
      return makeBuilder({ data: [], error: null });
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

import { useUserHasAnyClubPro } from "./useUserHasAnyClubPro";

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  rolesResult.data = [];
  rolesResult.error = null;
  teamsResult.data = [];
  teamsResult.error = null;
  subsResult.data = [];
  subsResult.error = null;
});

describe("useUserHasAnyClubPro fail-safe", () => {
  it("resolves Free when the user has no roles", async () => {
    const { result } = renderHook(() => useUserHasAnyClubPro(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasAnyClubPro).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it("resolves Pro when a matching subscription is active", async () => {
    rolesResult.data = [{ club_id: "c1", team_id: null }];
    subsResult.data = [{ is_pro: true, expires_at: null }];
    const { result } = renderHook(() => useUserHasAnyClubPro(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasAnyClubPro).toBe(true);
  });

  it.each([
    { is_pro: true },
    { is_pro_football: true },
    { admin_pro_override: true },
    { admin_pro_football_override: true },
  ])("recognises every active entitlement form: %o", async (entitlement) => {
    rolesResult.data = [{ club_id: "c1", team_id: null }];
    subsResult.data = [{ ...entitlement, expires_at: null }];
    const { result } = renderHook(() => useUserHasAnyClubPro(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasAnyClubPro).toBe(true);
  });

  it("resolves club access inherited through a team membership", async () => {
    rolesResult.data = [{ club_id: null, team_id: "t1" }];
    teamsResult.data = [{ club_id: "c1" }];
    subsResult.data = [{ is_pro: true, expires_at: null }];
    const { result } = renderHook(() => useUserHasAnyClubPro(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasAnyClubPro).toBe(true);
  });

  it("ignores an expired entitlement while granting another active club", async () => {
    rolesResult.data = [
      { club_id: "expired", team_id: null },
      { club_id: "active", team_id: null },
    ];
    subsResult.data = [
      { is_pro: true, expires_at: "2020-01-01T00:00:00Z" },
      { admin_pro_override: true, expires_at: "2099-01-01T00:00:00Z" },
    ];
    const { result } = renderHook(() => useUserHasAnyClubPro(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasAnyClubPro).toBe(true);
  });

  it("resolves definitive Free when every entitlement is expired", async () => {
    rolesResult.data = [{ club_id: "c1", team_id: null }];
    subsResult.data = [{ is_pro_football: true, expires_at: "2020-01-01T00:00:00Z" }];
    const { result } = renderHook(() => useUserHasAnyClubPro(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasAnyClubPro).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it("resolves Free (definitive) when subscriptions are all inactive/expired", async () => {
    rolesResult.data = [{ club_id: "c1", team_id: null }];
    subsResult.data = [{ is_pro: false, expires_at: null }];
    const { result } = renderHook(() => useUserHasAnyClubPro(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasAnyClubPro).toBe(false);
  });

  it("does NOT surface a definitive Free result when user_roles lookup errors", async () => {
    rolesResult.error = new Error("network");
    const { result } = renderHook(() => useUserHasAnyClubPro(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    // isLoading stays true so gating stays neutral (fail-safe): existing
    // callers use `!isLoading && !hasAnyClubPro` and MUST NOT display a
    // Free upsell during an unknown state.
    expect(result.current.isLoading).toBe(true);
    expect(result.current.hasAnyClubPro).toBe(false);
  });

  it("does NOT surface a definitive Free result when teams lookup errors", async () => {
    rolesResult.data = [{ club_id: null, team_id: "t1" }];
    teamsResult.error = new Error("network");
    const { result } = renderHook(() => useUserHasAnyClubPro(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.hasAnyClubPro).toBe(false);
  });

  it("does NOT surface a definitive Free result when club_subscriptions lookup errors", async () => {
    rolesResult.data = [{ club_id: "c1", team_id: null }];
    subsResult.error = new Error("network");
    const { result } = renderHook(() => useUserHasAnyClubPro(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.hasAnyClubPro).toBe(false);
  });
});
