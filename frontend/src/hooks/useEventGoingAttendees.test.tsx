import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, response } = vi.hoisted(() => ({
  from: vi.fn(),
  response: { data: [] as any[] | null, error: null as any },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));

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
  });

  it.each([null, undefined, ""])("does not query when event identity is %s", eventId => {
    const { result } = renderHook(() => useEventGoingAttendees(eventId), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
    expect(from).not.toHaveBeenCalled();
  });

  it("queries only going RSVPs for the requested event", async () => {
    const chain = query();
    from.mockReturnValue(chain);
    const { result } = renderHook(() => useEventGoingAttendees("event-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(from).toHaveBeenCalledWith("rsvps");
    expect(chain.select).toHaveBeenCalledWith("user_id, child_id, status");
    expect(chain.eq).toHaveBeenNthCalledWith(1, "event_id", "event-1");
    expect(chain.eq).toHaveBeenNthCalledWith(2, "status", "going");
  });

  it("merges adult and child attendees into one identity set", async () => {
    response.data = [
      { user_id: "adult-1", child_id: null, status: "going" },
      { user_id: "parent-1", child_id: "child-1", status: "going" },
    ];
    const { result } = renderHook(() => useEventGoingAttendees("event-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(new Set(["adult-1", "child-1"]));
    expect(result.current.data?.has("parent-1")).toBe(false);
  });

  it("deduplicates repeated attendee identities", async () => {
    response.data = [
      { user_id: "adult-1", child_id: null, status: "going" },
      { user_id: "adult-1", child_id: null, status: "going" },
      { user_id: "parent-1", child_id: "adult-1", status: "going" },
    ];
    const { result } = renderHook(() => useEventGoingAttendees("event-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect([...result.current.data!]).toEqual(["adult-1"]);
  });

  it("returns an empty set when nobody is going", async () => {
    response.data = null;
    const { result } = renderHook(() => useEventGoingAttendees("event-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(new Set());
  });

  it("surfaces lookup failures instead of treating them as zero attendees", async () => {
    response.error = { message: "RSVP lookup denied" };
    const { result } = renderHook(() => useEventGoingAttendees("event-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toEqual(response.error);
  });
});
