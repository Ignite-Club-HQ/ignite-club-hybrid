import { describe, expect, it } from "vitest";
// @ts-expect-error Worker helper is intentionally plain JavaScript for GitHub Node execution.
import { unwrapQueueResult } from "../../../scripts/icp-push-results.mjs";
describe("push worker canister results", () => {
  it("unwraps the actual device-token result variant", () => expect(unwrapQueueResult({ Ok: [{ user: "member", token: "device" }] }, "tokens")).toEqual([{ user: "member", token: "device" }]));
  it("rejects denied token access rather than marking notifications delivered", () => expect(() => unwrapQueueResult({ Err: "Worker required" }, "tokens")).toThrow("Worker required"));
  it("rejects failed acknowledgements", () => expect(() => unwrapQueueResult({ Err: "Not processing" }, "acknowledge")).toThrow("Not processing"));
  it("accepts null and zero successful results", () => { expect(unwrapQueueResult({ Ok: null }, "acknowledge")).toBeNull(); expect(unwrapQueueResult({ Ok: 0 }, "recover")).toBe(0); });
});