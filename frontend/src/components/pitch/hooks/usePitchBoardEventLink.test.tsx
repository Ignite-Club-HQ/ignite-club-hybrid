import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, rpc, loadPitchNotifyFlags, enabledRoleListFromFlags, tableData } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  loadPitchNotifyFlags: vi.fn(),
  enabledRoleListFromFlags: vi.fn(),
  tableData: new Map<string, unknown>(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from, rpc } }));
vi.mock("@/components/pitch/pitchBoardNotifyFlags", () => ({
  loadPitchNotifyFlags,
  enabledRoleListFromFlags,
}));

import { usePitchBoardEventLink } from "./usePitchBoardEventLink";

function queryFor(table: string) {
  const result = () => ({ data: tableData.get(table) ?? null, error: null });
  const query: Record<string, any> = {};
  for (const method of ["select", "eq", "in", "not"]) query[method] = vi.fn(() => query);
  query.single = vi.fn(async () => result());
  query.maybeSingle = vi.fn(async () => result());
  query.then = vi.fn((resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result())));
  return query;
}

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function args(overrides: Record<string, unknown> = {}) {
  return {
    initialLinkedEventId: null,
    savedLinkedEventId: null,
    teamId: "team-1",
    teamName: "U10 Blue",
    userId: "current-user",
    ...overrides,
  };
}

describe("usePitchBoardEventLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableData.clear();
    from.mockImplementation((table: string) => queryFor(table));
    rpc.mockResolvedValue({ data: null, error: null });
    loadPitchNotifyFlags.mockResolvedValue({ coaches: true, admins: true, subs_manager: true });
    enabledRoleListFromFlags.mockReturnValue(["coach", "admin"]);
  });

  it("prefers an explicitly linked event over an older saved link", () => {
    const { result } = renderHook(
      () => usePitchBoardEventLink(args({ initialLinkedEventId: "event-new", savedLinkedEventId: "event-old" })),
      { wrapper: createWrapper() },
    );
    expect(result.current.linkedEventId).toBe("event-new");
  });

  it("deduplicates role and duty recipients and never emails the linking user", async () => {
    tableData.set("user_roles", [
      { user_id: "coach-1" },
      { user_id: "shared-user" },
      { user_id: "current-user" },
    ]);
    tableData.set("duties", [
      { assigned_to: "shared-user" },
      { assigned_to: "subs-1" },
      { assigned_to: "current-user" },
    ]);
    tableData.set("events", { title: "U10 Blue vs Riverside" });
    const { result } = renderHook(() => usePitchBoardEventLink(args()), { wrapper: createWrapper() });

    await act(async () => result.current.handleLinkEvent("event-1"));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(3));

    expect(rpc.mock.calls.map(([, payload]) => payload._recipient_user_id).sort()).toEqual([
      "coach-1", "shared-user", "subs-1",
    ]);
    expect(rpc).toHaveBeenCalledWith("send_pitch_board_notification_email_rpc", expect.objectContaining({
      _team_id: "team-1",
      _event_id: "event-1",
      _notification_type: "game_linked",
      _notification_message: 'The pitch board has been linked to "U10 Blue vs Riverside"',
    }));
  });

  it("honours disabled role and Subs Manager notification preferences", async () => {
    loadPitchNotifyFlags.mockResolvedValue({ coaches: false, admins: false, subs_manager: false });
    enabledRoleListFromFlags.mockReturnValue([]);
    const { result } = renderHook(() => usePitchBoardEventLink(args()), { wrapper: createWrapper() });

    await act(async () => result.current.handleLinkEvent("event-1"));

    expect(from).not.toHaveBeenCalledWith("user_roles");
    expect(from).not.toHaveBeenCalledWith("duties");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses only match-specific referee and Subs Manager duties for event-group boards", async () => {
    tableData.set("event_group_duties", [
      { assigned_to: "referee-1" },
      { assigned_to: "subs-1" },
      { assigned_to: "current-user" },
    ]);
    tableData.set("events", { title: "Final" });
    const { result } = renderHook(
      () => usePitchBoardEventLink(args({ teamId: "event-group-group-42" })),
      { wrapper: createWrapper() },
    );

    await act(async () => result.current.handleLinkEvent("event-1"));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));

    expect(loadPitchNotifyFlags).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith("user_roles");
    expect(rpc.mock.calls.map(([, payload]) => payload._recipient_user_id).sort()).toEqual(["referee-1", "subs-1"]);
  });

  it("does not notify when unlinking, relinking the same event, or no user is signed in", async () => {
    const first = renderHook(
      () => usePitchBoardEventLink(args({ initialLinkedEventId: "event-1" })),
      { wrapper: createWrapper() },
    );
    await act(async () => first.result.current.handleLinkEvent("event-1"));
    await act(async () => first.result.current.handleLinkEvent(null));

    const anonymous = renderHook(
      () => usePitchBoardEventLink(args({ userId: undefined })),
      { wrapper: createWrapper() },
    );
    await act(async () => anonymous.result.current.handleLinkEvent("event-2"));

    expect(rpc).not.toHaveBeenCalled();
    expect(loadPitchNotifyFlags).not.toHaveBeenCalled();
  });

  it.each([
    [{ opponent: "Riverside FC", title: "Round 3" }, "Riverside FC"],
    [{ opponent: null, title: "U10 Blue vs Hills United" }, "Hills United"],
    [{ opponent: null, title: "Training game" }, "Opponent"],
  ])("derives a stable opponent label from linked event data", async (event, expected) => {
    // Opponent parsing is independent of fixture expiry. Use a fresh kickoff so
    // this contract cannot age past the intentional 24-hour auto-unlink boundary.
    tableData.set("events", {
      ...event,
      start_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const { result } = renderHook(
      () => usePitchBoardEventLink(args({ initialLinkedEventId: "event-1" })),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.opponentName).toBe(expected));
  });

  it("automatically unlinks a fixture more than 24 hours after kickoff", async () => {
    tableData.set("events", {
      opponent: "Riverside FC",
      title: "Game",
      start_time: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });
    const { result } = renderHook(
      () => usePitchBoardEventLink(args({ initialLinkedEventId: "event-old" })),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.linkedEventId).toBeNull());
  });
});
