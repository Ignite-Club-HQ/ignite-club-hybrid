import { beforeEach, describe, expect, it, vi } from "vitest";

const eventMocks = vi.hoisted(() => ({
  backend: (process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase") as "supabase" | "icp",
  scopes: [] as Array<{ feature: string; scope: unknown }>,
  createOpenDuty: vi.fn(),
  createRecurringSeries: vi.fn(),
  getEventsSnapshot: vi.fn(),
  setDuty: vi.fn(),
  updateEvent: vi.fn(),
  updateSeries: vi.fn(),
}));
const supabaseMode = process.env.IGNITE_TEST_BACKEND_MODE !== "icp";
const icpContext = { identity: {}, target: { alias: "test" } };

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }, scope?: unknown) => {
    eventMocks.scopes.push({ feature, scope });
    return eventMocks.backend === "icp" ? providers.icp(icpContext) : providers.supabase();
  },
}));
vi.mock("@/live/features/events", () => ({
  createLiveOpenDuty: (...args: unknown[]) => eventMocks.createOpenDuty(...args),
  createLiveRecurringEventSeries: (...args: unknown[]) => eventMocks.createRecurringSeries(...args),
  getLiveEventsSnapshot: (...args: unknown[]) => eventMocks.getEventsSnapshot(...args),
  setLiveEventDuty: (...args: unknown[]) => eventMocks.setDuty(...args),
  updateLiveEvent: (...args: unknown[]) => eventMocks.updateEvent(...args),
  updateLiveEventSeries: (...args: unknown[]) => eventMocks.updateSeries(...args),
}));

import {
  convertEventToRecurringSeries,
  syncEventDuties,
  updateEventTransaction,
} from "@/features/events/editEventWorkflow";

const updateInput = {
  eventId: "event-1",
  updates: { title: "Final", opponent: "Riverside" },
  selectedEventDate: "2026-08-20T09:00:00.000Z",
  selectedStartTime: "2026-08-20T09:00:00.000Z",
  selectedEndTime: "2026-08-20T10:30:00.000Z",
  updateSeries: false,
};

describe.runIf(supabaseMode)("event edit transaction — Supabase", () => {
  it("updates only the selected occurrence with aligned timestamps", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });
    const rpc = vi.fn();

    await updateEventTransaction({ from, rpc }, updateInput);

    expect(from).toHaveBeenCalledWith("events");
    expect(update).toHaveBeenCalledWith({
      title: "Final",
      opponent: "Riverside",
      event_date: updateInput.selectedEventDate,
      start_time: updateInput.selectedStartTime,
      end_time: updateInput.selectedEndTime,
    });
    expect(eq).toHaveBeenCalledWith("id", "event-1");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("updates the existing series through the exact transactional RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn();

    await updateEventTransaction({ rpc, from }, { ...updateInput, updateSeries: true });

    expect(rpc).toHaveBeenCalledWith("update_event_series", {
      p_event_id: "event-1",
      p_updates: updateInput.updates,
      p_selected_event_date: updateInput.selectedEventDate,
      p_selected_start_time: updateInput.selectedStartTime,
      p_selected_end_time: updateInput.selectedEndTime,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it.each([false, true])("propagates a %s path failure", async (updateSeries) => {
    const denied = { code: "42501", message: "denied" };
    const eq = vi.fn().mockResolvedValue({ error: denied });
    const client = {
      rpc: vi.fn().mockResolvedValue({ error: denied }),
      from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue({ eq }) }),
    };
    await expect(updateEventTransaction(client, { ...updateInput, updateSeries })).rejects.toBe(denied);
  });

  it("does not mutate controller-owned updates", async () => {
    const updates = { ...updateInput.updates };
    const eq = vi.fn().mockResolvedValue({ error: null });
    const client = { from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue({ eq }) }) };
    await updateEventTransaction(client, { ...updateInput, updates });
    expect(updates).toEqual(updateInput.updates);
    expect(updates).not.toHaveProperty("event_date");
  });
});

describe.runIf(supabaseMode)("event duty transaction — Supabase", () => {
  it("maps additions, edits and removals to the exact atomic RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ idx: 1, id: "new-duty" }],
      error: null,
    });
    const duties = [
      { id: "duty-1", name: "Scorer", assignedTo: "adult-1" },
      { name: "First Aid", assignedTo: null },
    ];
    await expect(syncEventDuties({ rpc }, "event-1", ["old-duty"], duties))
      .resolves.toEqual([{ idx: 1, id: "new-duty" }]);
    expect(rpc).toHaveBeenCalledWith("sync_event_duties", {
      p_event_id: "event-1",
      p_delete_ids: ["old-duty"],
      p_duties: [
        { idx: 0, id: "duty-1", name: "Scorer", assigned_to: "adult-1" },
        { idx: 1, id: null, name: "First Aid", assigned_to: null },
      ],
    });
  });

  it("normalizes a successful null response to no generated ids", async () => {
    await expect(syncEventDuties(
      { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) },
      "event-1",
      [],
      [],
    )).resolves.toEqual([]);
  });

  it("propagates duty permission or transaction failure", async () => {
    const denied = { code: "42501", message: "denied" };
    await expect(syncEventDuties(
      { rpc: vi.fn().mockResolvedValue({ data: null, error: denied }) },
      "event-1",
      [],
      [],
    )).rejects.toBe(denied);
  });
});

describe.runIf(supabaseMode)("single event to recurring-series conversion — Supabase", () => {
  const conversionInput = {
    eventId: "event-1",
    updates: { title: "Training", club_id: "selected-club", team_id: "selected-team" },
    selectedDate: new Date("2026-08-20T09:15:00.000Z"),
    selectedStartTime: "2026-08-20T09:15:00.000Z",
    selectedEndTime: "2026-08-20T10:45:00.000Z",
    occurrenceDates: [
      new Date("2026-08-20T09:15:00.000Z"),
      new Date("2026-08-27T00:00:00.000Z"),
      new Date("2026-09-03T00:00:00.000Z"),
    ],
    recurrenceEndDate: "2026-09-03",
    frequency: "weekly" as const,
  };

  function conversionClient(data: unknown = { occurrence_count: 3 }, error: unknown = null) {
    const rpc = vi.fn().mockResolvedValue({ data, error });
    return { client: { rpc }, rpc };
  }

  it("sends parent and children through one atomic RPC", async () => {
    const { client, rpc } = conversionClient();
    await expect(convertEventToRecurringSeries(client, conversionInput)).resolves.toBe(3);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("convert_event_to_recurring_series", {
      p_event_id: "event-1",
      p_parent_updates: conversionInput.updates,
      p_child_events: expect.any(Array),
      p_parent_event_date: "2026-08-20T09:15:00.000Z",
      p_parent_start_time: conversionInput.selectedStartTime,
      p_parent_end_time: conversionInput.selectedEndTime,
      p_recurrence_end_date: "2026-09-03",
    });
  });

  it("sends only aligned child timestamps and no client-supplied scope", async () => {
    const { client, rpc } = conversionClient();
    await convertEventToRecurringSeries(client, conversionInput);
    const childEvents = rpc.mock.calls[0][1].p_child_events;
    expect(childEvents).toEqual([
      {
        event_date: "2026-08-27T09:15:00.000Z",
        start_time: "2026-08-27T09:15:00.000Z",
        end_time: "2026-08-27T10:45:00.000Z",
      },
      {
        event_date: "2026-09-03T09:15:00.000Z",
        start_time: "2026-09-03T09:15:00.000Z",
        end_time: "2026-09-03T10:45:00.000Z",
      },
    ]);
    for (const child of childEvents) {
      expect(child).not.toHaveProperty("club_id");
      expect(child).not.toHaveProperty("team_id");
      expect(child).not.toHaveProperty("created_by");
      expect(child).not.toHaveProperty("parent_event_id");
    }
  });

  it("sends an empty child list for a one-occurrence conversion", async () => {
    const { client, rpc } = conversionClient({ occurrence_count: 1 });
    await expect(convertEventToRecurringSeries(client, {
      ...conversionInput,
      occurrenceDates: [conversionInput.selectedDate],
    })).resolves.toBe(1);
    expect(rpc.mock.calls[0][1].p_child_events).toEqual([]);
  });

  it("keeps child end times null when the selected event has no end", async () => {
    const { client, rpc } = conversionClient();
    await convertEventToRecurringSeries(client, { ...conversionInput, selectedEndTime: null });
    expect(rpc.mock.calls[0][1].p_child_events).toEqual([
      expect.objectContaining({ end_time: null }),
      expect.objectContaining({ end_time: null }),
    ]);
  });

  it("propagates atomic conversion failure", async () => {
    const denied = { code: "42501", message: "denied" };
    const { client, rpc } = conversionClient(null, denied);
    await expect(convertEventToRecurringSeries(client, conversionInput)).rejects.toBe(denied);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("does not mutate dates or update data owned by the page", async () => {
    const { client } = conversionClient();
    const updates = { ...conversionInput.updates };
    const dates = conversionInput.occurrenceDates.map((date) => new Date(date));
    const before = dates.map((date) => date.toISOString());
    await convertEventToRecurringSeries(client, { ...conversionInput, updates, occurrenceDates: dates });
    expect(updates).toEqual(conversionInput.updates);
    expect(dates.map((date) => date.toISOString())).toEqual(before);
  });

  it("falls back to the generated count if an older compatible RPC omits it", async () => {
    const { client } = conversionClient({});
    await expect(convertEventToRecurringSeries(client, conversionInput)).resolves.toBe(3);
  });
});

describe.runIf(!supabaseMode)("event workflows — ICP", () => {
  beforeEach(() => {
    eventMocks.backend = "icp";
    eventMocks.scopes.length = 0;
    eventMocks.createOpenDuty.mockReset();
    eventMocks.createRecurringSeries.mockReset();
    eventMocks.getEventsSnapshot.mockReset();
    eventMocks.setDuty.mockReset();
    eventMocks.updateEvent.mockReset();
    eventMocks.updateSeries.mockReset();
  });

  it("updates a selected event through events_domain", async () => {
    eventMocks.updateEvent.mockResolvedValue(undefined);
    const client = { from: vi.fn(), rpc: vi.fn() };
    await updateEventTransaction(client, updateInput);
    expect(eventMocks.updateEvent).toHaveBeenCalledWith(icpContext, "event-1", expect.objectContaining({
      title: "Final",
      eventType: "training",
      startsAtMs: new Date(updateInput.selectedStartTime).getTime(),
    }));
    expect(eventMocks.scopes).toEqual([{
      feature: "events",
      scope: { eventId: "event-1", writeKey: "once", attempts: 1 },
    }]);
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("updates an existing event series from the selected occurrence onward", async () => {
    eventMocks.getEventsSnapshot.mockResolvedValue({
      events: [{ id: "event-1", series_id: ["series-1"] }],
      series: [{
        id: "series-1",
        title: "Original",
        description: "Original description",
        event_type: "training",
        location: [],
      }],
    });
    const client = { from: vi.fn(), rpc: vi.fn() };

    await updateEventTransaction(client, {
      ...updateInput,
      updates: { title: "Final", type: "game", address: "Oval" },
      updateSeries: true,
    });

    expect(eventMocks.getEventsSnapshot).toHaveBeenCalledWith(icpContext);
    expect(eventMocks.updateSeries).toHaveBeenCalledWith(icpContext, "series-1", expect.objectContaining({
      title: "Final",
      eventType: "game",
      location: "Oval",
      fromMs: new Date(updateInput.selectedEventDate).getTime(),
    }));
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("syncs assigned and open duties through events_domain", async () => {
    eventMocks.setDuty.mockResolvedValue(undefined);
    eventMocks.createOpenDuty.mockResolvedValue(undefined);
    const client = { rpc: vi.fn() };
    await expect(syncEventDuties(client, "event-1", [], [
      { name: "Referee", assignedTo: "account-a" },
      { name: "Scorer", assignedTo: null },
    ])).resolves.toEqual([]);
    expect(eventMocks.setDuty).toHaveBeenCalledWith(icpContext, "event-1", "account-a", "Referee");
    expect(eventMocks.createOpenDuty).toHaveBeenCalledWith(icpContext, "event-1", "Scorer");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("converts recurrence through the canister series adapter", async () => {
    eventMocks.createRecurringSeries.mockResolvedValue({ events: [{ id: "first" }, { id: "second" }] });
    const client = { rpc: vi.fn() };
    const input = {
      eventId: "event-1",
      updates: { title: "Training", club_id: "selected-club", team_id: "selected-team" },
      selectedDate: new Date("2026-08-20T09:15:00.000Z"),
      selectedStartTime: "2026-08-20T09:15:00.000Z",
      selectedEndTime: "2026-08-20T10:45:00.000Z",
      occurrenceDates: [new Date("2026-08-20T09:15:00.000Z"), new Date("2026-08-27T09:15:00.000Z")],
      recurrenceEndDate: "2026-08-27",
      frequency: "weekly" as const,
    };
    await expect(convertEventToRecurringSeries(client, input)).resolves.toBe(2);
    expect(eventMocks.createRecurringSeries).toHaveBeenCalledWith(icpContext, expect.objectContaining({
      clubId: "selected-club",
      teamId: "selected-team",
      title: "Training",
      frequency: "weekly",
    }));
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
