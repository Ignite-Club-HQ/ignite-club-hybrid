import { describe, expect, it, vi } from "vitest";
import { refreshEventPayments } from "./eventPaymentCacheCompletion";

describe("refreshEventPayments", () => {
  it("invalidates only the exact event payment ledger", () => {
    const invalidateQueries = vi.fn();
    refreshEventPayments({ invalidateQueries }, "event-1");
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["event-payments", "event-1"],
    });
  });
});
