import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolvePublicInviteCode } from "./invitePublicRead";
const m = vi.hoisted(() => ({ targets: vi.fn(), resolve: vi.fn() }));
vi.mock("./publicGroupReads", () => ({ readFreshPublicTargets: m.targets }));
vi.mock("./features/club", () => ({ resolveLiveInviteShortCode: m.resolve }));
const base = { canisterIds: { club_domain: "g1" } } as Parameters<typeof resolvePublicInviteCode>[0];
beforeEach(() => { m.targets.mockReset().mockResolvedValue([base, { canisterIds: { club_domain: "g2" } }]); m.resolve.mockReset(); });
describe("public ICP short invite discovery", () => {
  it("finds Group 2 without a membership or Supabase lookup", async () => {
    m.resolve.mockImplementation(async ctx => ctx.target.canisterIds.club_domain === "g2" ? "pinv-g2" : Promise.reject(new Error("Resolve invite short code failed: Short code not found")));
    expect(await resolvePublicInviteCode(base, "ABC")).toBe("pinv-g2");
    expect(m.resolve).toHaveBeenCalledTimes(2);
  });
  it("rejects duplicate owners", async () => {
    m.resolve.mockResolvedValue("pinv-collision");
    await expect(resolvePublicInviteCode(base, "ABC")).rejects.toThrow("multiple owners");
  });
  it("preserves transport failure rather than treating it as absence", async () => {
    m.resolve.mockRejectedValue(new Error("Connection lost"));
    await expect(resolvePublicInviteCode(base, "ABC")).rejects.toThrow("Connection lost");
  });
});