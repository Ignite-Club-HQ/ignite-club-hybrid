import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

import { useCanStartGame } from "./useCanStartGame";

function resultQuery(data: unknown[]) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "in"]) chain[method] = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve({ data, error: null }));
  return chain;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

function game(minutesFromNow: number, overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    type: "game",
    team_id: "team-1",
    event_date: new Date(Date.now() + minutesFromNow * 60_000).toISOString(),
    ...overrides,
  };
}

describe("useCanStartGame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-07-19T12:00:00Z"));
  });

  it.each([
    [121, "future", false],
    [120, "imminent", true],
    [1, "imminent", true],
    [0, "live", true],
    [-179, "live", true],
    [-180, "past", false],
  ] as const)("maps kickoff offset %i minutes to %s", async (minutes, phase, canStart) => {
    from
      .mockReturnValueOnce(resultQuery([{ user_id: "user-1" }]))
      .mockReturnValueOnce(resultQuery([]));
    const { result } = renderHook(() => useCanStartGame(game(minutes)), { wrapper });
    await waitFor(() => expect(result.current.phase).toBe(phase));
    expect(result.current.canStart).toBe(canStart);
  });

  it("allows the assigned Subs Manager without an admin or coach role", async () => {
    from
      .mockReturnValueOnce(resultQuery([]))
      .mockReturnValueOnce(resultQuery([{ id: "duty-1" }]));
    const { result } = renderHook(() => useCanStartGame(game(30)), { wrapper });
    await waitFor(() => expect(result.current).toEqual({ canStart: true, phase: "imminent" }));
  });

  it.each([
    [game(30, { type: "training" })],
    [game(30, { is_cancelled: true })],
    [game(30, { is_bye: true })],
  ])("does not query permissions for an ineligible event", async (event) => {
    const { result } = renderHook(() => useCanStartGame(event), { wrapper });
    expect(result.current).toEqual({ canStart: false, phase: "future" });
    expect(from).not.toHaveBeenCalled();
  });

  it("denies an eligible event when the user has neither role nor duty", async () => {
    from.mockReturnValueOnce(resultQuery([])).mockReturnValueOnce(resultQuery([]));
    const { result } = renderHook(() => useCanStartGame(game(30)), { wrapper });
    await waitFor(() => expect(from).toHaveBeenCalledTimes(2));
    expect(result.current).toEqual({ canStart: false, phase: "future" });
  });
});
