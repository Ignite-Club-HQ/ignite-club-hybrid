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
const icpMode = process.env.IGNITE_TEST_BACKEND_MODE === "icp";
const live = vi.hoisted(() => ({ recipients: vi.fn(), event: vi.fn(), fan: vi.fn() }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: async (_: string, providers: { icp: (ctx: unknown) => unknown }) => providers.icp({}) }));
vi.mock("./livePitchNotifications", () => ({ livePitchRecipients: live.recipients, livePitchEvent: live.event }));
vi.mock("@/live/features/notifications", () => ({ fanOutLiveNotifications: live.fan }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from, rpc } }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => icpMode ? "icp" : "supabase" }));
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
    live.recipients.mockResolvedValue({ userIds: [], clubId: "club-1", event: { title: "Match" } });
    live.event.mockImplementation(async () => {
      const event = tableData.get("events") as { opponent?: string; title?: string; start_time?: string } | undefined;
      return event ? { id: "event-1", opponent: event.opponent ? [event.opponent] : [], title: event.title,
        starts_at_ms: BigInt(new Date(event.start_time ?? Date.now()).getTime()) } : null;
    });
  });

  it("prefers an explicitly linked event over an older saved link", () => {
    const { result } = renderHook(
      () => usePitchBoardEventLink(args({ initialLinkedEventId: "event-new", savedLinkedEventId: "event-old" })),
      { wrapper: createWrapper() },
    );
    expect(result.current.linkedEventId).toBe("event-new");
  });

  it.runIf(!icpMode)("deduplicates role and duty recipients and never emails the linking user", async () => {
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

  it.runIf(!icpMode)("uses only match-specific referee and Subs Manager duties for event-group boards", async () => {
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

  it.runIf(icpMode)("sends a club-scoped pitch-board alert without Supabase reads or email", async () => {
    live.recipients.mockResolvedValue({ userIds: ["coach", "admin", "subs"], clubId: "club-1", event: { title: "Match" } });
    const { result } = renderHook(() => usePitchBoardEventLink(args()), { wrapper: createWrapper() });
    await act(async () => result.current.handleLinkEvent("event-1"));
    expect(from).not.toHaveBeenCalledWith("user_roles");
    expect(from).not.toHaveBeenCalledWith("duties");
    expect(from).not.toHaveBeenCalledWith("event_group_duties");
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(live.recipients).toHaveBeenCalledWith({}, "team-1", "event-1", "current-user", false, true);
    expect(live.fan).toHaveBeenCalledWith({}, expect.objectContaining({ userIds: ["coach", "admin", "subs"], clubId: "club-1", kind: "pitch_board", relatedId: "team-1" }));
  });
});
