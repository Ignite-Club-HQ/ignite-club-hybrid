import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTeamChatAdminStatus, type TeamChatSupabaseClient } from "./useTeamChatAdminStatus";

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function makeSupabaseClient(responses: Record<string, { data: any }>): TeamChatSupabaseClient {
  return {
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        maybeSingle: () => Promise.resolve(responses[table] ?? { data: null }),
      };
      return chain;
    },
  };
}

describe("useTeamChatAdminStatus", () => {
  it("does not run the query when disabled", () => {
    const supabaseClient = makeSupabaseClient({});
    const { result } = renderHook(
      () =>
        useTeamChatAdminStatus({
          supabaseClient,
          teamId: "team-1",
          userId: "user-1",
          clubId: "club-1",
          enabled: false,
        }),
      { wrapper: makeWrapper() },
    );
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("resolves false when there is no teamId or userId", async () => {
    const supabaseClient = makeSupabaseClient({});
    const { result } = renderHook(
      () =>
        useTeamChatAdminStatus({
          supabaseClient,
          teamId: undefined,
          userId: "user-1",
          clubId: "club-1",
          enabled: true,
        }),
      { wrapper: makeWrapper() },
    );
    // enabled is gated on !!teamId internally, so the query never actually runs
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("resolves true when the user has a team_admin/coach role", async () => {
    const supabaseClient = makeSupabaseClient({
      user_roles: { data: { role: "coach" } },
    });
    const { result } = renderHook(
      () =>
        useTeamChatAdminStatus({
          supabaseClient,
          teamId: "team-1",
          userId: "user-1",
          clubId: null,
          enabled: true,
        }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toBe(true));
  });

  it("resolves false when none of the three role checks match", async () => {
    const supabaseClient = makeSupabaseClient({
      user_roles: { data: null },
    });
    const { result } = renderHook(
      () =>
        useTeamChatAdminStatus({
          supabaseClient,
          teamId: "team-1",
          userId: "user-1",
          clubId: null,
          enabled: true,
        }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(false);
  });

  it("skips the club_admin check entirely when there is no clubId", async () => {
    const fromSpy = vi.fn((table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        maybeSingle: () => Promise.resolve({ data: null }),
      };
      return chain;
    });
    const { result } = renderHook(
      () =>
        useTeamChatAdminStatus({
          supabaseClient: { from: fromSpy },
          teamId: "team-1",
          userId: "user-1",
          clubId: null,
          enabled: true,
        }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Only team-role and app-admin checks hit `from("user_roles")`; the
    // club_admin branch short-circuits to a resolved null without calling it.
    expect(fromSpy).toHaveBeenCalledTimes(2);
  });
});
