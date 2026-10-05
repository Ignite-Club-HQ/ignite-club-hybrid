import { describe, it, expect, vi } from "vitest";
const calls: string[] = [];
const actor = {
  get_club_profiles: vi.fn(async (ids: string[]) => { calls.push("batch"); return { Ok: ids.filter((i) => i !== "x").map((id) => ({ id })) }; }),
  get_club_profile: vi.fn(async (id: string) => { calls.push("single"); return { Ok: [{ id }] }; }),
};
vi.mock("../domains", () => ({ connectLiveClubDomain: async () => ({ actor }) }));
vi.mock("./vault", () => ({ registerLivePiiText: vi.fn() }));
import { getLiveClubProfile } from "./club";

describe("club read batching", () => {
  it("coalesces same-tick profile reads into one query", async () => {
    const ctx = { identity: {}, target: { canisterIds: {} } } as never;
    const [a, b, x] = await Promise.all([getLiveClubProfile(ctx, "a"), getLiveClubProfile(ctx, "b"), getLiveClubProfile(ctx, "x")]);
    expect(calls).toEqual(["batch"]);
    expect(a).toEqual([{ id: "a" }]); expect(b).toEqual([{ id: "b" }]); expect(x).toEqual([]);
  });
});
