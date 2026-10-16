import { describe, expect, it } from "vitest";
import { batchRecipientIds, FAN_OUT_MAX_BATCH_SIZE } from "./notificationBatching";

describe("batchRecipientIds", () => {
  it("dedupes and caps each batch at the max fan-out size", () => {
    const ids = Array.from({ length: 1200 }, (_, i) => `user-${i % 900}`); // 900 unique, with dupes
    const batches = batchRecipientIds(ids);
    const flat = batches.flat();
    expect(new Set(flat).size).toBe(900);
    expect(flat.length).toBe(900);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(FAN_OUT_MAX_BATCH_SIZE);
    }
    expect(batches.length).toBe(2);
  });

  it("returns no batches for an empty list", () => {
    expect(batchRecipientIds([])).toEqual([]);
  });
});
