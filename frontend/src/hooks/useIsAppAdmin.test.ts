import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ backend: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    m.backend(providers),
}));

import { fetchIsAppAdmin } from "./useIsAppAdmin";

describe("fetchIsAppAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects within the read deadline when the backend call never settles", async () => {
    m.backend.mockReturnValue(new Promise(() => {})); // hangs forever
    const expectation = expect(fetchIsAppAdmin("user-a")).rejects.toThrow(/App admin check/i);
    await vi.advanceTimersByTimeAsync(25_000);
    await expectation;
  });

  it("passes through a resolved admin result", async () => {
    m.backend.mockResolvedValue(true);
    await expect(fetchIsAppAdmin("user-a")).resolves.toBe(true);
  });

  it("propagates backend denials", async () => {
    m.backend.mockRejectedValue(new Error("denied"));
    await expect(fetchIsAppAdmin("user-a")).rejects.toThrow("denied");
  });
});
