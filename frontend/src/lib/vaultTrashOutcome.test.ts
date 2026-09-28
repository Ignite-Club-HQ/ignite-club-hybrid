import { describe, expect, it } from "vitest";
import { resolveEmptyTrashOutcome } from "@/lib/vaultTrashOutcome";

describe("resolveEmptyTrashOutcome", () => {
  it("reports complete success when nothing failed", () => {
    const outcome = resolveEmptyTrashOutcome({ succeededCount: 12, failedCount: 0 });
    expect(outcome.kind).toBe("success");
    expect(outcome.message).toBe("Trash emptied successfully");
  });

  it("reports a single accurate warning on partial success", () => {
    const outcome = resolveEmptyTrashOutcome({ succeededCount: 7, failedCount: 3 });
    expect(outcome.kind).toBe("warning");
    expect(outcome.message).toContain("7 item(s) deleted");
    expect(outcome.message).toContain("3 item(s) could not be deleted");
  });

  it("never reports success when any item failed", () => {
    for (const failedCount of [1, 5, 100]) {
      for (const succeededCount of [0, 1, 50]) {
        expect(resolveEmptyTrashOutcome({ succeededCount, failedCount }).kind).not.toBe("success");
      }
    }
  });

  it("reports an error when every item fails", () => {
    const outcome = resolveEmptyTrashOutcome({ succeededCount: 0, failedCount: 4 });
    expect(outcome.kind).toBe("error");
    expect(outcome.message).toBe("4 item(s) could not be deleted");
  });

  it("does not emit contradictory success text in failure paths", () => {
    const partial = resolveEmptyTrashOutcome({ succeededCount: 2, failedCount: 2 });
    const total = resolveEmptyTrashOutcome({ succeededCount: 0, failedCount: 2 });
    expect(partial.message).not.toContain("Trash emptied successfully");
    expect(total.message).not.toContain("successfully");
  });
});
