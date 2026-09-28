import { describe, expect, it, vi } from "vitest";
import { exportEventToCalendar } from "./eventCalendarExport";

describe("event calendar export", () => {
  it("passes the complete event/calendar contract to the exporter", async () => {
    const exporter = vi.fn().mockResolvedValue(undefined);
    const event = {
      id: "event-1", title: "Match", type: "game",
      event_date: "2026-08-12T10:30:00Z", start_time: "2026-08-12T10:30:00Z",
      end_time: "2026-08-12T11:30:00Z", description: "Round 4", location_name: "Oval",
      address: "1 Main Road", suburb: "Riverside", state: "SA", postcode: "5000",
      is_cancelled: false, updated_at: "2026-08-10T00:00:00Z",
    };
    await exportEventToCalendar(exporter, event, "https://app.test/events/event-1");
    expect(exporter).toHaveBeenCalledWith({ ...event, url: "https://app.test/events/event-1" });
  });

  it("propagates exporter failure for the page to report", async () => {
    const failure = new Error("calendar unavailable");
    await expect(exportEventToCalendar(vi.fn().mockRejectedValue(failure), {
      id: "event-1", title: "Match", type: "game", event_date: "2026-08-12T10:30:00Z",
    }, "https://app.test/events/event-1")).rejects.toBe(failure);
  });
});
