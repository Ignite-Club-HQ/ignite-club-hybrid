import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { resolveGameNotificationPath } from "./gameNotificationRepository";

type IgniteSupabaseClient = SupabaseClient<Database>;

function fakeClient(data: unknown) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const query = {
    select: (...args: unknown[]) => { calls.push({ method: "select", args }); return query; },
    eq: (...args: unknown[]) => { calls.push({ method: "eq", args }); return query; },
    maybeSingle: async () => ({ data, error: null }),
  };
  return {
    calls,
    client: { from: (table: string) => {
      calls.push({ method: "from", args: [table] });
      return query;
    } } as unknown as IgniteSupabaseClient,
  };
}

describe("game notification repository", () => {
  it("routes a halftime or finished-game notification to its linked event", async () => {
    const fake = fakeClient({ pitch_state: { linkedEventId: "event-a" } });
    await expect(resolveGameNotificationPath("game-a", fake.client)).resolves.toBe("/events/event-a");
    expect(fake.calls).toEqual(expect.arrayContaining([
      { method: "from", args: ["active_games"] },
      { method: "select", args: ["pitch_state"] },
      { method: "eq", args: ["id", "game-a"] },
    ]));
  });

  it("does not query and safely returns home without a game id", async () => {
    const fake = fakeClient(null);
    await expect(resolveGameNotificationPath(null, fake.client)).resolves.toBe("/");
    expect(fake.calls).toEqual([]);
  });

  it.each([
    null,
    { pitch_state: null },
    { pitch_state: [] },
    { pitch_state: "invalid" },
    { pitch_state: { linkedEventId: null } },
    { pitch_state: { linkedEventId: 42 } },
    { pitch_state: { linkedEventId: "" } },
  ])("falls back home for missing or malformed pitch state: %s", async (data) => {
    await expect(resolveGameNotificationPath("game-a", fakeClient(data).client)).resolves.toBe("/");
  });
});
