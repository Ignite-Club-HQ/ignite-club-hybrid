import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const icpMode = process.env.IGNITE_TEST_BACKEND_MODE === "icp";
const { from, checkLiveEventMembership } = vi.hoisted(() => ({ from: vi.fn(), checkLiveEventMembership: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => icpMode }));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, handlers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    icpMode ? handlers.icp({}) : handlers.supabase(),
}));
vi.mock("@/live/features/events", () => ({ checkLiveEventMembership }));

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

describe.runIf(!icpMode)("useEventMembership Supabase membership", () => {
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

describe.runIf(icpMode)("useEventMembership ICP membership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates event-scoped membership to events_domain", async () => {
    checkLiveEventMembership.mockResolvedValue(true);
    const { result } = renderHook(
      () => useEventMembership({ id: "event-icp", team_id: "team-1", club_id: "club-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe(true));
    expect(checkLiveEventMembership).toHaveBeenCalledWith({}, "user-1", "event-icp");
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed when events_domain reports no membership", async () => {
    checkLiveEventMembership.mockResolvedValue(false);
    const { result } = renderHook(
      () => useEventMembership({ id: "event-icp", team_id: null, club_id: "club-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe(false));
    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces an unavailable membership check without probing Supabase", async () => {
    checkLiveEventMembership.mockRejectedValueOnce(new Error("membership unavailable"));
    const { result } = renderHook(
      () => useEventMembership({ id: "event-icp", team_id: "team-1", club_id: "club-1" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(from).not.toHaveBeenCalled();
  });
});
