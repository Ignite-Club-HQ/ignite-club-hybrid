import { describe, expect, it, vi } from "vitest";
import { refreshEventDuties } from "./eventDutyCacheCompletion";

describe("refreshEventDuties", () => {
  it("invalidates only the exact event duty list", () => {
    const invalidateQueries = vi.fn();
    refreshEventDuties({ invalidateQueries }, "event-1");
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["event-duties", "event-1"],
    });
  });
});
