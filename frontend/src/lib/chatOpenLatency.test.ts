import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: vi.fn() }));
vi.mock("@/live/features/insights", () => ({ recordLivePerfSample: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

import { isTrueColdOpen } from "./chatOpenLatency";

describe("chat open timing", () => {
  it("counts app start only when chat opened within 5s of launch", () => {
    expect(isTrueColdOpen(3_415)).toBe(true);
    expect(isTrueColdOpen(5_000)).toBe(true);
  });
  it("does not count browsing time before opening chat", () => {
    expect(isTrueColdOpen(24_266)).toBe(false);
    expect(isTrueColdOpen(undefined)).toBe(false);
  });
});
