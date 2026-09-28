import { describe, it, expect } from "vitest";
import { resolveChatMetadataState } from "@/lib/chatMetadataGate";

/**
 * Regression guard: a dropped connection must never be reported to the user as
 * "this chat group has been removed". Only a query that SUCCEEDED and returned
 * no row may be classified as `missing`.
 */
const base = {
  data: null as unknown,
  isLoading: false,
  isError: false,
  fetchStatus: "idle" as const,
  status: "success" as const,
  isOnline: true,
};

describe("resolveChatMetadataState", () => {
  it("is ready whenever a row is in hand, even mid-error", () => {
    expect(resolveChatMetadataState({ ...base, data: { id: "g1" }, isError: true })).toBe("ready");
    expect(
      resolveChatMetadataState({ ...base, data: { id: "g1" }, fetchStatus: "paused", isOnline: false }),
    ).toBe("ready");
  });

  it("reports unreachable (not missing) when the fetch errored", () => {
    expect(resolveChatMetadataState({ ...base, isError: true, status: "error" })).toBe("unreachable");
  });

  it("reports unreachable when the query is paused offline", () => {
    expect(resolveChatMetadataState({ ...base, fetchStatus: "paused", status: "pending" })).toBe(
      "unreachable",
    );
  });

  it("reports unreachable when settled with no row while offline", () => {
    expect(resolveChatMetadataState({ ...base, isOnline: false })).toBe("unreachable");
  });

  it("reports unreachable when idle but never succeeded (aborted zombie fetch)", () => {
    expect(resolveChatMetadataState({ ...base, status: "pending" })).toBe("unreachable");
  });

  it("reports loading while the first fetch is in flight", () => {
    expect(resolveChatMetadataState({ ...base, isLoading: true, fetchStatus: "fetching", status: "pending" })).toBe(
      "loading",
    );
    expect(resolveChatMetadataState({ ...base, fetchStatus: "fetching", status: "pending" })).toBe("loading");
  });

  it("reports missing only on a proven-successful empty result while online", () => {
    expect(resolveChatMetadataState({ ...base })).toBe("missing");
    expect(resolveChatMetadataState({ ...base, data: undefined })).toBe("missing");
  });

  it("defaults isOnline to true when unspecified", () => {
    const { isOnline: _omit, ...noOnline } = base;
    expect(resolveChatMetadataState(noOnline)).toBe("missing");
  });
});
