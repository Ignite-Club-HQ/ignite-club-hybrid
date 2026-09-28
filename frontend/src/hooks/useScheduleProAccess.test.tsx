/**
 * Regression tests for useScheduleProAccess.
 *
 * Verifies cross-club entitlement classification per the fail-closed rules:
 *   - Explicit club_id → that club's entitlement only.
 *   - team_id (no club_id) → resolved team's owning club; loading and lookup
 *     failure fail closed; NO any-club fallback.
 *   - Genuinely clubless targets (DM, broadcast, standalone group) →
 *     any-club Pro.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---- Mocks --------------------------------------------------------------

const clubProResponses: Record<string, { hasPro: boolean; isLoading: boolean }> = {};
const anyClubProResponse = { hasAnyClubPro: false, isLoading: false };

vi.mock("@/hooks/useClubProAccess", () => ({
  useClubProAccess: (clubId: string | null | undefined, opts?: { enabled?: boolean }) => {
    if (!clubId || opts?.enabled === false) {
      return { hasPro: false, hasProFootball: false, isLoading: false };
    }
    const r = clubProResponses[clubId] ?? { hasPro: false, isLoading: false };
    return { hasPro: r.hasPro, hasProFootball: false, isLoading: r.isLoading };
  },
}));

vi.mock("@/hooks/useUserHasAnyClubPro", () => ({
  useUserHasAnyClubPro: () => anyClubProResponse,
}));

// Supabase team lookup mock
type TeamRow = { club_id: string | null };
const teamLookup: {
  data: Record<string, TeamRow | null>;
  error: Record<string, unknown>;
  delay: number;
} = { data: {}, error: {}, delay: 0 };

vi.mock("@/integrations/supabase/client", () => {
  const makeChain = () => {
    let currentId: string | null = null;
    const chain: any = {
      select: () => chain,
      eq: (_col: string, id: string) => {
        currentId = id;
        return chain;
      },
      maybeSingle: async () => {
        if (teamLookup.delay > 0) {
          await new Promise((r) => setTimeout(r, teamLookup.delay));
        }
        const err = teamLookup.error[currentId!];
        if (err) return { data: null, error: err };
        return { data: teamLookup.data[currentId!] ?? null, error: null };
      },
    };
    return chain;
  };
  return {
    supabase: { from: (_t: string) => makeChain() },
  };
});

// ---- Import after mocks -------------------------------------------------
import { useScheduleProAccess } from "./useScheduleProAccess";

function wrap() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  Object.keys(clubProResponses).forEach((k) => delete clubProResponses[k]);
  Object.keys(teamLookup.data).forEach((k) => delete teamLookup.data[k]);
  Object.keys(teamLookup.error).forEach((k) => delete teamLookup.error[k]);
  teamLookup.delay = 0;
  anyClubProResponse.hasAnyClubPro = false;
  anyClubProResponse.isLoading = false;
});

// ---- Tests --------------------------------------------------------------

describe("useScheduleProAccess", () => {
  it("1. explicit Pro club grants access via that club's entitlement only", () => {
    clubProResponses["club-A"] = { hasPro: true, isLoading: false };
    anyClubProResponse.hasAnyClubPro = false;
    const { result } = renderHook(
      () => useScheduleProAccess({ chat_type: "club", club_id: "club-A" }),
      { wrapper: wrap() },
    );
    expect(result.current).toEqual({ hasAccess: true, isLoading: false });
  });

  it("2. explicit free club denies access even when user has Pro elsewhere", () => {
    clubProResponses["club-free"] = { hasPro: false, isLoading: false };
    anyClubProResponse.hasAnyClubPro = true; // user has Pro at another club
    const { result } = renderHook(
      () => useScheduleProAccess({ chat_type: "club", club_id: "club-free" }),
      { wrapper: wrap() },
    );
    expect(result.current.hasAccess).toBe(false);
  });

  it("3. Pro at unrelated club does not unlock an explicit free club", () => {
    clubProResponses["club-free"] = { hasPro: false, isLoading: false };
    anyClubProResponse.hasAnyClubPro = true;
    const { result } = renderHook(
      () => useScheduleProAccess({ chat_type: "club", club_id: "club-free" }),
      { wrapper: wrap() },
    );
    expect(result.current.hasAccess).toBe(false);
  });

  it("4. team-only target resolves to owning Pro club and grants access", async () => {
    teamLookup.data["team-1"] = { club_id: "club-Pro" };
    clubProResponses["club-Pro"] = { hasPro: true, isLoading: false };
    const { result } = renderHook(
      () => useScheduleProAccess({ chat_type: "team", team_id: "team-1" }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.hasAccess).toBe(true));
    expect(result.current.isLoading).toBe(false);
  });

  it("5. team-only target resolving to a free club is denied (no any-club fallback)", async () => {
    teamLookup.data["team-free"] = { club_id: "club-free" };
    clubProResponses["club-free"] = { hasPro: false, isLoading: false };
    anyClubProResponse.hasAnyClubPro = true; // Pro at unrelated club
    const { result } = renderHook(
      () => useScheduleProAccess({ chat_type: "team", team_id: "team-free" }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasAccess).toBe(false);
  });

  it("6. while team ownership is loading, access is false and loading is true (never leaks any-club Pro)", async () => {
    teamLookup.delay = 50;
    teamLookup.data["team-slow"] = { club_id: "club-Pro" };
    clubProResponses["club-Pro"] = { hasPro: true, isLoading: false };
    anyClubProResponse.hasAnyClubPro = true; // would incorrectly unlock under old bug
    const { result } = renderHook(
      () => useScheduleProAccess({ chat_type: "team", team_id: "team-slow" }),
      { wrapper: wrap() },
    );
    // Immediately after mount, still loading — must NOT show hasAccess:true.
    expect(result.current).toEqual({ hasAccess: false, isLoading: true });
    await waitFor(() => expect(result.current.hasAccess).toBe(true));
  });

  it("7. team resolving to no club fails closed", async () => {
    teamLookup.data["team-orphan"] = { club_id: null };
    anyClubProResponse.hasAnyClubPro = true;
    const { result } = renderHook(
      () => useScheduleProAccess({ chat_type: "team", team_id: "team-orphan" }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toEqual({ hasAccess: false, isLoading: false });
  });

  it("8. team lookup error fails closed (no any-club fallback)", async () => {
    teamLookup.error["team-err"] = { message: "network" };
    anyClubProResponse.hasAnyClubPro = true;
    const { result } = renderHook(
      () => useScheduleProAccess({ chat_type: "team", team_id: "team-err" }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toEqual({ hasAccess: false, isLoading: false });
  });

  it("9. target supplying both team and club uses the exact supplied club without any-club fallback", () => {
    clubProResponses["club-supplied"] = { hasPro: true, isLoading: false };
    anyClubProResponse.hasAnyClubPro = false;
    // Team lookup should be skipped — set an error to prove it's not consulted.
    teamLookup.error["team-x"] = { message: "should not be called" };
    const { result } = renderHook(
      () =>
        useScheduleProAccess({
          chat_type: "team",
          team_id: "team-x",
          club_id: "club-supplied",
        }),
      { wrapper: wrap() },
    );
    expect(result.current).toEqual({ hasAccess: true, isLoading: false });
  });

  it("10. DMs retain any-club fallback behavior", () => {
    anyClubProResponse.hasAnyClubPro = true;
    const { result } = renderHook(
      () =>
        useScheduleProAccess({
          chat_type: "direct",
          conversation_id: "dm-1",
        }),
      { wrapper: wrap() },
    );
    expect(result.current).toEqual({ hasAccess: true, isLoading: false });
  });

  it("11. broadcasts retain any-club fallback behavior", () => {
    anyClubProResponse.hasAnyClubPro = true;
    const { result } = renderHook(
      () => useScheduleProAccess({ chat_type: "broadcast" }),
      { wrapper: wrap() },
    );
    expect(result.current.hasAccess).toBe(true);
  });

  it("12. any-club loading propagates for genuinely clubless targets", () => {
    anyClubProResponse.hasAnyClubPro = false;
    anyClubProResponse.isLoading = true;
    const { result } = renderHook(
      () => useScheduleProAccess({ chat_type: "direct", conversation_id: "dm-2" }),
      { wrapper: wrap() },
    );
    expect(result.current).toEqual({ hasAccess: false, isLoading: true });
  });

  it("13. UI does not briefly render enabled scheduling controls during team lookup", async () => {
    teamLookup.delay = 30;
    teamLookup.data["team-flash"] = { club_id: "club-Pro" };
    clubProResponses["club-Pro"] = { hasPro: true, isLoading: false };
    anyClubProResponse.hasAnyClubPro = true;
    const { result } = renderHook(
      () => useScheduleProAccess({ chat_type: "team", team_id: "team-flash" }),
      { wrapper: wrap() },
    );
    // Take a snapshot every 5ms during the lookup window; hasAccess must
    // never be true until loading completes.
    const snapshots: Array<{ hasAccess: boolean; isLoading: boolean }> = [];
    for (let i = 0; i < 4; i++) {
      snapshots.push({ ...result.current });
      await new Promise((r) => setTimeout(r, 5));
    }
    for (const s of snapshots) {
      if (s.isLoading) expect(s.hasAccess).toBe(false);
    }
    await waitFor(() => expect(result.current.hasAccess).toBe(true));
  });
});
