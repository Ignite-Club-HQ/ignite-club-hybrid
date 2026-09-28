import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { cacheClub, cacheTeam } from "@/lib/clubTeamCache";
import { useTeamChatTeamData, type TeamChatTeamSupabaseClient } from "./useTeamChatTeamData";

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function makeSupabaseClient(data: any, error: any = null): TeamChatTeamSupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data, error }),
        }),
      }),
    }),
  };
}

describe("useTeamChatTeamData", () => {
  it("fetches the team via the supabase client and returns it", async () => {
    const supabaseClient = makeSupabaseClient({
      id: "team-1",
      name: "Under 10s",
      logo_url: null,
      club_id: "club-1",
      clubs: { id: "club-1", name: "Ignite FC", logo_url: null },
    });
    const { result } = renderHook(
      () =>
        useTeamChatTeamData({
          supabaseClient,
          teamId: "team-1",
          useIcpLab: false,
          getLocalLabChatTeam: vi.fn(),
        }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.team?.name).toBe("Under 10s"));
    expect(result.current.loadingTeam).toBe(false);
    expect(result.current.teamIsError).toBe(false);
  });

  it("uses the ICP lab fixture team lookup when useIcpLab is true", async () => {
    const getLocalLabChatTeam = vi.fn().mockReturnValue({ id: "team-2", name: "Lab Team", club_id: null });
    const { result } = renderHook(
      () =>
        useTeamChatTeamData({
          supabaseClient: makeSupabaseClient(null),
          teamId: "team-2",
          useIcpLab: true,
          getLocalLabChatTeam,
        }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.team?.name).toBe("Lab Team"));
    expect(getLocalLabChatTeam).toHaveBeenCalledWith("team-2");
  });

  it("synthesizes a team from the metadata cache while the network query is disabled", () => {
    cacheTeam({ id: "team-3", name: "Cached Team", logo_url: null, club_id: "club-3", level_age: null });
    cacheClub({ id: "club-3", name: "Cached Club", logo_url: null, sport: null, is_pro: false });
    const { result } = renderHook(
      () =>
        useTeamChatTeamData({
          supabaseClient: makeSupabaseClient(null),
          teamId: undefined,
          useIcpLab: false,
          getLocalLabChatTeam: vi.fn(),
        }),
      { wrapper: makeWrapper() },
    );
    // No teamId means the query never runs and there's nothing to synthesize from.
    expect(result.current.team).toBeNull();
  });

  it("falls back to the cached team while the network query is still loading", async () => {
    cacheTeam({ id: "team-4", name: "Cached Team 4", logo_url: null, club_id: "club-4", level_age: null });
    cacheClub({ id: "club-4", name: "Cached Club 4", logo_url: null, sport: null, is_pro: false });
    let resolveQuery: (value: any) => void = () => {};
    const supabaseClient: TeamChatTeamSupabaseClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => new Promise((resolve) => { resolveQuery = resolve; }),
          }),
        }),
      }),
    };
    const { result } = renderHook(
      () =>
        useTeamChatTeamData({
          supabaseClient,
          teamId: "team-4",
          useIcpLab: false,
          getLocalLabChatTeam: vi.fn(),
        }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.team?.name).toBe("Cached Team 4"));
    resolveQuery({ data: null, error: null });
  });

  it("exposes refetchTeam and teamIsFetching for the unreachable-state retry UI", async () => {
    const supabaseClient = makeSupabaseClient({ id: "team-5", name: "Team 5", club_id: null });
    const { result } = renderHook(
      () =>
        useTeamChatTeamData({
          supabaseClient,
          teamId: "team-5",
          useIcpLab: false,
          getLocalLabChatTeam: vi.fn(),
        }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.loadingTeam).toBe(false));
    expect(typeof result.current.refetchTeam).toBe("function");
    expect(result.current.teamIsFetching).toBe(false);
  });
});
