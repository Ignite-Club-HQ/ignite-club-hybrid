import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backendMocks = vi.hoisted(() => ({
  mode: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  context: { identity: {}, target: {} },
  getRoster: vi.fn(),
  from: vi.fn(),
  response: { data: [] as any[] | null, error: null as any },
}));
const { from, response } = backendMocks;
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: backendMocks.from } }));
vi.mock("@/live/loadBackendRouting", () => ({
  isFeatureRoutedToIcp: () => backendMocks.mode === "icp",
}));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    backendMocks.mode === "icp" ? providers.icp(backendMocks.context) : providers.supabase(),
}));
vi.mock("@/live/features/events", () => ({
  getLiveEventRosterDetailed: (...args: unknown[]) => backendMocks.getRoster(...args),
}));

import { useEventGoingAttendees } from "./useEventGoingAttendees";

function query() {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  Object.defineProperty(chain, "then", {
    value: (resolve: any) => Promise.resolve(response).then(resolve),
  });
  return chain;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

describe("useEventGoingAttendees", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    response.data = [];
    response.error = null;
    from.mockImplementation(() => query());
    backendMocks.getRoster.mockReset();
  });

  it.each([null, undefined, ""])("does not query when event identity is %s", eventId => {
    const { result } = renderHook(() => useEventGoingAttendees(eventId), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
    expect(from).not.toHaveBeenCalled();
  });

  it.runIf(backendMocks.mode === "supabase")("queries only going RSVPs for the requested event", async () => {
    const chain = query();
    from.mockReturnValue(chain);
    const { result } = renderHook(() => useEventGoingAttendees("event-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(from).toHaveBeenCalledWith("rsvps");
    expect(chain.select).toHaveBeenCalledWith("user_id, child_id, status");
    expect(chain.eq).toHaveBeenNthCalledWith(1, "event_id", "event-1");
    expect(chain.eq).toHaveBeenNthCalledWith(2, "status", "going");
  });

  it.runIf(backendMocks.mode === "supabase")("merges adult and child attendees into one identity set", async () => {
    response.data = [
      { user_id: "adult-1", child_id: null, status: "going" },
      { user_id: "parent-1", child_id: "child-1", status: "going" },
    ];
    const { result } = renderHook(() => useEventGoingAttendees("event-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(new Set(["adult-1", "child-1"]));
    expect(result.current.data?.has("parent-1")).toBe(false);
  });

  it.runIf(backendMocks.mode === "supabase")("deduplicates repeated attendee identities", async () => {
    response.data = [
      { user_id: "adult-1", child_id: null, status: "going" },
      { user_id: "adult-1", child_id: null, status: "going" },
      { user_id: "parent-1", child_id: "adult-1", status: "going" },
    ];
    const { result } = renderHook(() => useEventGoingAttendees("event-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect([...result.current.data!]).toEqual(["adult-1"]);
  });

  it.runIf(backendMocks.mode === "supabase")("returns an empty set when nobody is going", async () => {
    response.data = null;
    const { result } = renderHook(() => useEventGoingAttendees("event-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(new Set());
  });

  it.runIf(backendMocks.mode === "supabase")("surfaces lookup failures instead of treating them as zero attendees", async () => {
    response.error = { message: "RSVP lookup denied" };
    const { result } = renderHook(() => useEventGoingAttendees("event-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toEqual(response.error);
  });

  it.runIf(backendMocks.mode === "icp")("maps the canister roster to adult and child identity ids", async () => {
    backendMocks.getRoster.mockResolvedValue({ rsvps: [
      { rsvp: { account_id: "principal-adult", child_id: [], state: "going" } },
      { rsvp: { account_id: "principal-parent", child_id: ["child-1"], state: "going" } },
      { rsvp: { account_id: "principal-maybe", child_id: [], state: "maybe" } },
    ] });
    const { result } = renderHook(() => useEventGoingAttendees("event-icp"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(new Set(["principal-adult", "child-1"]));
    expect(backendMocks.getRoster).toHaveBeenCalledWith(backendMocks.context, "event-icp");
    expect(from).not.toHaveBeenCalled();
  });

  it.runIf(backendMocks.mode === "icp")("deduplicates adult and child attendee identities from the canister roster", async () => {
    backendMocks.getRoster.mockResolvedValue({ rsvps: [
      { rsvp: { account_id: "principal-adult", child_id: [], state: "going" } },
      { rsvp: { account_id: "principal-adult", child_id: [], state: "going" } },
      { rsvp: { account_id: "principal-parent", child_id: ["child-1"], state: "going" } },
      { rsvp: { account_id: "principal-parent-2", child_id: ["child-1"], state: "going" } },
      { rsvp: { account_id: "principal-maybe", child_id: [], state: "maybe" } },
    ] });
    const { result } = renderHook(() => useEventGoingAttendees("event-icp"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(new Set(["principal-adult", "child-1"]));
    expect(from).not.toHaveBeenCalled();
  });

  it.runIf(backendMocks.mode === "icp")("returns an empty set when no canister RSVP is going", async () => {
    backendMocks.getRoster.mockResolvedValue({ rsvps: [
      { rsvp: { account_id: "principal-maybe", child_id: [], state: "maybe" } },
      { rsvp: { account_id: "principal-no", child_id: ["child-1"], state: "not_going" } },
    ] });
    const { result } = renderHook(() => useEventGoingAttendees("event-icp"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(new Set());
    expect(from).not.toHaveBeenCalled();
  });

  it.runIf(backendMocks.mode === "icp")("surfaces canister roster failures instead of showing zero attendees", async () => {
    backendMocks.getRoster.mockRejectedValue(new Error("roster unavailable"));
    const { result } = renderHook(() => useEventGoingAttendees("event-icp"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(from).not.toHaveBeenCalled();
  });
});
