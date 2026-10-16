import { describe, expect, it, vi } from "vitest";

const eventMocks = vi.hoisted(() => ({
  backend: (process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase") as "supabase" | "icp",
  createLiveEvent: vi.fn(),
  createLiveEventSeries: vi.fn(),
  addLiveSeriesOccurrence: vi.fn(),
  createLiveOpenDuty: vi.fn(),
  setLiveEventAutoReminder: vi.fn(),
  setLiveEventDuty: vi.fn(),
}));
const supabaseMode = process.env.IGNITE_TEST_BACKEND_MODE !== "icp";
const icpContext = { identity: {}, target: { alias: "test" } };

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    eventMocks.backend === "icp" ? providers.icp(icpContext) : providers.supabase(),
}));
vi.mock("@/live/features/events", () => ({
  createLiveEvent: (...args: unknown[]) => eventMocks.createLiveEvent(...args),
  createLiveEventSeries: (...args: unknown[]) => eventMocks.createLiveEventSeries(...args),
  addLiveSeriesOccurrence: (...args: unknown[]) => eventMocks.addLiveSeriesOccurrence(...args),
  createLiveOpenDuty: (...args: unknown[]) => eventMocks.createLiveOpenDuty(...args),
  setLiveEventAutoReminder: (...args: unknown[]) => eventMocks.setLiveEventAutoReminder(...args),
  setLiveEventDuty: (...args: unknown[]) => eventMocks.setLiveEventDuty(...args),
}));

import { createEventTransaction } from "@/features/events/createEventWorkflow";

describe.runIf(supabaseMode)("atomic event create workflow — Supabase", () => {
  const input = {
    event: { title: "Match", club_id: "club-1", team_id: "team-1" },
    eventDate: "2026-08-20T09:00:00.000Z",
    childDates: ["2026-08-27T09:00:00.000Z"],
    duties: [{ name: "Referee", assigned_to: "adult-1" }],
  };

  it("sends event, recurring children and duties through one exact RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "event-1", error: null });
    await expect(createEventTransaction({ rpc }, input)).resolves.toBe("event-1");
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("create_event_with_duties", {
      p_event: {
        title: "Match", club_id: "club-1", team_id: "team-1",
        event_date: "2026-08-20T09:00:00.000Z",
      },
      p_child_dates: ["2026-08-27T09:00:00.000Z"],
      p_duties: [{ name: "Referee", assigned_to: "adult-1" }],
    });
  });

  it("supports a single event with no duties without changing the RPC shape", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "event-2", error: null });
    await createEventTransaction({ rpc }, { ...input, childDates: null, duties: [] });
    expect(rpc).toHaveBeenCalledWith("create_event_with_duties", expect.objectContaining({
      p_child_dates: null,
      p_duties: [],
    }));
  });

  it("propagates database/RPC failure and never attempts fallback writes", async () => {
    const denied = { code: "42501", message: "denied" };
    const rpc = vi.fn().mockResolvedValue({ data: null, error: denied });
    const from = vi.fn();
    await expect(createEventTransaction({ rpc, from }, input)).rejects.toBe(denied);
    expect(rpc).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a successful response that does not return an event id", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await expect(createEventTransaction({ rpc }, input)).rejects.toThrow("Event could not be created.");
  });

  it("does not mutate the controller-owned event payload", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "event-1", error: null });
    const event = { ...input.event };
    await createEventTransaction({ rpc }, { ...input, event });
    expect(event).toEqual(input.event);
    expect(event).not.toHaveProperty("event_date");
  });
});

describe.runIf(!supabaseMode)("atomic event create workflow — ICP", () => {
  it("creates the event through events_domain without using the Supabase RPC", async () => {
    eventMocks.backend = "icp";
    eventMocks.createLiveEvent.mockResolvedValue({ id: "icp-event-1" });
    const rpc = vi.fn();
    const eventDate = "2026-08-20T09:00:00.000Z";

    await expect(createEventTransaction({ rpc }, {
      event: { title: "Match", club_id: "club-1", team_id: "team-1", type: "game" },
      eventDate,
      childDates: null,
      duties: [],
    })).resolves.toBe("icp-event-1");

    expect(eventMocks.createLiveEvent).toHaveBeenCalledWith(icpContext, expect.objectContaining({
      clubId: "club-1",
      teamId: "team-1",
      title: "Match",
      eventType: "game",
      startsAtMs: new Date(eventDate).getTime(),
      endsAtMs: new Date(eventDate).getTime() + 3_600_000,
    }));
    expect(rpc).not.toHaveBeenCalled();
  });
});
