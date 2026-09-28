import { describe, expect, it, vi } from "vitest";
import { createEventTransaction } from "@/features/events/createEventWorkflow";
import { updateEventTransaction } from "@/features/events/editEventWorkflow";

describe("CreateEventPage and EditEventPage mutation contracts", () => {
  it("CreateEventPage creates one event with optional children and duties", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "created-event", error: null });

    await expect(createEventTransaction({ rpc }, {
      event: { title: "Training", club_id: "club-1", team_id: "team-1" },
      eventDate: "2026-09-21T09:00:00.000Z",
      childDates: ["2026-09-28T09:00:00.000Z"],
      duties: [{ name: "Scorer", assigned_to: null }],
    })).resolves.toBe("created-event");

    expect(rpc).toHaveBeenCalledWith("create_event_with_duties", expect.objectContaining({
      p_child_dates: ["2026-09-28T09:00:00.000Z"],
      p_duties: [{ name: "Scorer", assigned_to: null }],
    }));
  });

  it("CreateEventPage does not fall back to separate writes after a failed create", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: "42501" } });
    const from = vi.fn();

    await expect(createEventTransaction({ rpc, from }, {
      event: { title: "Training" },
      eventDate: "2026-09-21T09:00:00.000Z",
      childDates: null,
      duties: [],
    })).rejects.toEqual({ code: "42501" });
    expect(from).not.toHaveBeenCalled();
  });

  it("EditEventPage updates only the selected occurrence when series editing is off", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });
    const rpc = vi.fn();

    await updateEventTransaction({ from, rpc }, {
      eventId: "event-1",
      updates: { title: "Updated" },
      selectedEventDate: "2026-09-21T09:00:00.000Z",
      selectedStartTime: "2026-09-21T09:00:00.000Z",
      selectedEndTime: "2026-09-21T10:00:00.000Z",
      updateSeries: false,
    });

    expect(from).toHaveBeenCalledWith("events");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("EditEventPage uses the transactional series RPC when series editing is on", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn();

    await updateEventTransaction({ rpc, from }, {
      eventId: "event-1",
      updates: { title: "Updated" },
      selectedEventDate: "2026-09-21T09:00:00.000Z",
      selectedStartTime: "2026-09-21T09:00:00.000Z",
      selectedEndTime: "2026-09-21T10:00:00.000Z",
      updateSeries: true,
    });

    expect(rpc).toHaveBeenCalledWith("update_event_series", expect.objectContaining({
      p_event_id: "event-1",
      p_updates: { title: "Updated" },
    }));
    expect(from).not.toHaveBeenCalled();
  });
});
