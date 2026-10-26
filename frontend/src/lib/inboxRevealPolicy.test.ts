import { describe, expect, it } from "vitest";
import { shouldBlockInboxReveal } from "./inboxRevealPolicy";

describe("quiet cached inbox reveal", () => {
  it("shows existing ICP rows while fresh ordering is pending", () => {
    expect(shouldBlockInboxReveal({ online: true, icp: true, hasRows: true, loading: false, orderReady: false })).toBe(false);
  });
  it("does not turn a cold pending inbox into an empty result", () => {
    expect(shouldBlockInboxReveal({ online: true, icp: true, hasRows: false, loading: true, orderReady: false })).toBe(true);
  });
  it("preserves Supabase first-order readiness", () => {
    expect(shouldBlockInboxReveal({ online: true, icp: false, hasRows: true, loading: false, orderReady: false })).toBe(true);
  });
  it("shows offline saved rows without awaiting a network", () => {
    expect(shouldBlockInboxReveal({ online: false, icp: true, hasRows: true, loading: true, orderReady: false })).toBe(false);
  });
});