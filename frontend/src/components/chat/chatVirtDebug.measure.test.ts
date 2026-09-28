import { describe, it, expect, beforeEach } from "vitest";
import {
  setChatVirtDebugEnabled,
  debugLogMeasure,
  clearMeasurementSummary,
  getMeasurementSummary,
} from "./chatVirtDebug";
import {
  clearChatRowHeightCache,
  setCachedRowHeight,
  getCachedRowHeight,
} from "./chatRowHeightCache";

type MeasureEvent = {
  kind: string;
  data: { messageId: string; estimated?: number; measured: number; delta?: number | null };
};

function measureEventsFor(id: string): MeasureEvent[] {
  const buf = (window.__chatVirtDebugDump?.() ?? []) as unknown as MeasureEvent[];
  return buf.filter((e) => e.kind === "measure" && e.data.messageId === id);
}

describe("chat-virt measurement telemetry", () => {
  beforeEach(() => {
    setChatVirtDebugEnabled(true);
    window.__chatVirtDebugClear?.();
    clearMeasurementSummary();
    clearChatRowHeightCache();
  });

  it("emits a measure event on a row's first visit, then suppresses subsequent in-tolerance re-measures", () => {
    const id = "msg-A";

    // First visit: estimator hasn't seen this row, real measurement differs.
    debugLogMeasure(id, 200, 220, "text"); // delta +20 (≤24, but first visit)
    expect(measureEventsFor(id)).toHaveLength(1);

    // Cache the now-known height the way the real wrapper does.
    setCachedRowHeight(id, 220);
    expect(getCachedRowHeight(id)).toBe(220);

    // Re-visits: estimator returns the cached 220 → delta 0, must NOT push.
    debugLogMeasure(id, 220, 220, "text");
    debugLogMeasure(id, 220, 220, "text");
    debugLogMeasure(id, 220, 220, "text");
    expect(measureEventsFor(id)).toHaveLength(1);

    // Small in-tolerance drift (≤24px) on a re-visit must also stay quiet.
    debugLogMeasure(id, 220, 230, "text"); // delta +10
    expect(measureEventsFor(id)).toHaveLength(1);
  });

  it("still emits a measure event on a re-visit when drift is material (>24px)", () => {
    const id = "msg-B";
    debugLogMeasure(id, 100, 105, "text"); // first visit
    expect(measureEventsFor(id)).toHaveLength(1);

    setCachedRowHeight(id, 105);

    // Material drift on re-visit (e.g. content hydrated) → must push to alert.
    debugLogMeasure(id, 105, 160, "text"); // delta +55
    const events = measureEventsFor(id);
    expect(events).toHaveLength(2);
    expect(events[1].data.delta).toBe(55);
  });

  it("aggregates per-type drift in the summary across all measurements", () => {
    debugLogMeasure("img-1", 240, 260, "image"); // first visit
    setCachedRowHeight("img-1", 260);
    debugLogMeasure("img-1", 260, 260, "image"); // suppressed event, still aggregated

    debugLogMeasure("txt-1", 80, 80, "text");

    const summary = getMeasurementSummary();
    expect(summary.totalMeasurements).toBe(3);
    const image = summary.byType.find((r) => r.type === "image");
    expect(image?.count).toBe(2);
    expect(image?.avgMeasured).toBe(260);
  });
});
