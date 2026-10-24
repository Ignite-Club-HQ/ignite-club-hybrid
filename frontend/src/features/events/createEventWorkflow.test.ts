import { beforeEach, describe, expect, it, vi } from "vitest";

const eventMocks = vi.hoisted(() => ({
  backend: (process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase") as "supabase" | "icp",
  scopes: [] as Array<{ feature: string; scope: unknown }>,
  createLiveEventWithSetup: vi.fn(),
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
  withFeatureBackend: (feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }, scope?: unknown) => {
    eventMocks.scopes.push({ feature, scope });
    return eventMocks.backend === "icp" ? providers.icp(icpContext) : providers.supabase();
  },
}));
vi.mock("@/live/features/events", () => ({
  createLiveEventWithSetup: (...args: unknown[]) => eventMocks.createLiveEventWithSetup(...args),
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
  beforeEach(() => { eventMocks.backend = 'icp'; eventMocks.scopes.length = 0; eventMocks.createLiveEventWithSetup.mockReset(); });
  it('commits exact dates, duties and reminders together without Supabase', async () => {
    eventMocks.createLiveEventWithSetup.mockResolvedValue({ first_event_id: 'first', event_ids: ['first', 'child'] });
    const rpc = vi.fn();
    const input = { requestId: 'stable-request', event: { title: 'Match', club_id: 'club-1', team_id: 'team-1', type: 'game', end_time: '2026-08-20T10:30:00Z', reminder_hours_before: 12, duty_team_id: 'duty-team' }, eventDate: '2026-08-20T09:00:00Z', childDates: ['2026-08-27T09:00:00Z'], duties: [{ name: 'Scorer', assigned_to: 'adult' }, { name: 'First Aid', assigned_to: null }] };
    expect(await createEventTransaction({ rpc }, input)).toBe('first');
    expect(eventMocks.createLiveEventWithSetup).toHaveBeenCalledOnce();
    expect(eventMocks.createLiveEventWithSetup).toHaveBeenCalledWith(icpContext, expect.objectContaining({
      requestId: 'stable-request', dutyTeamId: 'duty-team', reminderHours: 12, duties: input.duties,
      occurrences: [{ startsAtMs: Date.parse(input.eventDate), endsAtMs: Date.parse('2026-08-20T10:30:00Z') }, { startsAtMs: Date.parse('2026-08-27T09:00:00Z'), endsAtMs: Date.parse('2026-08-27T10:30:00Z') }],
    })); expect(rpc).not.toHaveBeenCalled();
  });
  it('waits for complete committed setup before returning', async () => {
    let finish: ((value: unknown) => void) | undefined;
    eventMocks.createLiveEventWithSetup.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    let returned = false;
    const pending = createEventTransaction({}, { requestId: 'r', event: { title: 'Match', club_id: 'club' }, eventDate: '2026-08-20T09:00:00Z', childDates: null, duties: [] }).then(id => { returned = true; return id; });
    await Promise.resolve(); expect(returned).toBe(false);
    finish?.({ first_event_id: 'saved' }); expect(await pending).toBe('saved');
  });
  it('never falls back after rejection', async () => {
    eventMocks.createLiveEventWithSetup.mockRejectedValue(new Error('denied')); const rpc = vi.fn();
    await expect(createEventTransaction({ rpc }, { event: { club_id: 'club' }, eventDate: '2026-08-20T09:00:00Z', childDates: null, duties: [] })).rejects.toThrow('denied'); expect(rpc).not.toHaveBeenCalled();
  });
});
