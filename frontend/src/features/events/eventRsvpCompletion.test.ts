import { describe, expect, it, vi } from "vitest";
import { completeEventRsvp } from "@/features/events/eventRsvpCompletion";

describe("RSVP completion cache policy", () => {
  it("always refreshes the event attendance rows and going roster", () => {
    const invalidateQueries = vi.fn();
    completeEventRsvp({ invalidateQueries }, { eventId: "event-1" });
    expect(invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ["event-rsvps", "event-1"] }],
      [{ queryKey: ["event-rsvps-going", "event-1"] }],
    ]);
  });

  it("adds group and exact PitchBoard refresh only when requested", () => {
    const invalidateQueries = vi.fn();
    completeEventRsvp({ invalidateQueries }, {
      eventId: "event-1", teamId: "team-1", includeGroups: true, includePitch: true,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["event-groups", "event-1"] });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["team-members-for-pitch", "team-1", "event-1"],
    });
  });

  it("delays points refresh to preserve fire-and-forget award timing", () => {
    const invalidateQueries = vi.fn();
    const schedule = vi.fn();
    completeEventRsvp({ invalidateQueries }, {
      eventId: "event-1", includePoints: true, schedule,
    });
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 1500);
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["points-history"] });
    schedule.mock.calls[0][0]();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["points-history"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["points-rank"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["points-rank-seasoned"] });
  });

  it("does not schedule points work for admin or mini-league completion profiles", () => {
    const schedule = vi.fn();
    completeEventRsvp({ invalidateQueries: vi.fn() }, {
      eventId: "event-1", includeGroups: true, includePitch: true, schedule,
    });
    expect(schedule).not.toHaveBeenCalled();
  });
});
