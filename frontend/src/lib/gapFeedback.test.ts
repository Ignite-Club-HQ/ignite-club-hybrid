import { describe, expect, it, vi } from "vitest";
import { GAP_REPORT_EVENT, requestGapReport, takeGapReport } from "./gapFeedback";
describe("coverage feedback requests", () => {
  it("retains a report until the feedback dialog mounts and consumes it only once", () => {
    const listener = vi.fn();
    window.addEventListener(GAP_REPORT_EVENT, listener);
    requestGapReport("coverage events");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(takeGapReport()).toBe("coverage events");
    expect(takeGapReport()).toBeNull();
    window.removeEventListener(GAP_REPORT_EVENT, listener);
  });
});