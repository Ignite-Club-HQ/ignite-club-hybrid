import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression guard: a failed message-table probe (offline / dropped socket)
 * must resolve to `unreachable`, never `not_found`. `not_found` sends the user
 * to /messages as if the message were deleted — which is exactly the
 * misleading behaviour reported for notification taps on flaky coverage.
 */

type Probe = { data: unknown; error: unknown };
const probes: Probe[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => probes.shift() ?? { data: null, error: null },
        }),
      }),
    }),
  },
}));

const empty = (): Probe => ({ data: null, error: null });
const netFail = (): Probe => ({ data: null, error: { message: "Failed to fetch" } });

async function resolve(id: string) {
  const mod = await import("@/lib/notificationChatRouting");
  return mod.resolveChatTargetResult(id);
}

describe("resolveChatTargetResult", () => {
  beforeEach(() => {
    probes.length = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("returns found for a team message", async () => {
    probes.push({ data: { team_id: "t1" }, error: null });
    const r = await resolve("m1");
    expect(r.status).toBe("found");
    expect(r.target?.path).toBe("/messages/t1?message=m1");
  });

  it("returns found for a group message after earlier empty probes", async () => {
    probes.push(empty(), empty(), { data: { group_id: "g1" }, error: null });
    const r = await resolve("m2");
    expect(r.status).toBe("found");
    expect(r.target?.kind).toBe("group");
  });

  it("returns not_found when every probe succeeds with no row", async () => {
    for (let i = 0; i < 6; i++) probes.push(empty());
    expect((await resolve("m3")).status).toBe("not_found");
  });

  it("returns unreachable when any probe fails", async () => {
    probes.push(empty(), netFail(), empty(), empty(), empty(), empty());
    expect((await resolve("m4")).status).toBe("unreachable");
  });

  it("returns unreachable when the very first probe fails", async () => {
    probes.push(netFail(), empty(), empty(), empty(), empty(), empty());
    expect((await resolve("m5")).status).toBe("unreachable");
  });

  it("still returns found when a later probe would have failed", async () => {
    probes.push({ data: { team_id: "t9" }, error: null }, netFail());
    expect((await resolve("m6")).status).toBe("found");
  });

  it("treats PGRST116 as an expected miss, not a failure", async () => {
    for (let i = 0; i < 6; i++) probes.push({ data: null, error: { code: "PGRST116" } });
    expect((await resolve("m7")).status).toBe("not_found");
  });

  it("returns unreachable when the device is offline even if probes look empty", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    for (let i = 0; i < 6; i++) probes.push(empty());
    expect((await resolve("m8")).status).toBe("unreachable");
  });

  it("returns not_found for an empty message id", async () => {
    expect((await resolve("")).status).toBe("not_found");
  });

  it("back-compat wrapper still yields null for unreachable and not_found", async () => {
    const mod = await import("@/lib/notificationChatRouting");
    probes.push(netFail(), empty(), empty(), empty(), empty(), empty());
    expect(await mod.resolveChatTargetForMessageId("m9")).toBeNull();
  });
});
