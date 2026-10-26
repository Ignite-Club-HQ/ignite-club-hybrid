import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ provider: "icp", from: vi.fn(), read: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/live/features/club", () => ({ getLiveClubSubscription: mocks.read }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: mocks.dispatch }));
import { readUpgradeClubSubscription } from "./upgradeSubscriptionReader";
beforeEach(() => {
  vi.clearAllMocks(); mocks.provider = "icp";
  mocks.dispatch.mockImplementation((_feature, providers) => mocks.provider === "icp" ? providers.icp({ target: {}, identity: {} }) : providers.supabase());
});
describe("upgrade subscription provider isolation", () => {
  it("reads the exact on-chain club without querying Supabase", async () => {
    mocks.read.mockResolvedValue({ is_pro: true, admin_pro_override: false, is_pro_football: false, admin_pro_football_override: false, expires_at_ms: [1790000000000n], plan: "usd_v2_small", team_limit: [3n], is_trial: false, trial_ends_at_ms: [] });
    expect(await readUpgradeClubSubscription("club-g2")).toMatchObject({ is_pro: true, team_limit: 3, plan: "usd_v2_small" });
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), "club-g2");
    expect(mocks.dispatch).toHaveBeenCalledWith("membership", expect.anything(), { clubId: "club-g2" });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("preserves an absent on-chain subscription without fallback", async () => {
    mocks.read.mockResolvedValue(null);
    expect(await readUpgradeClubSubscription("club-free")).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("propagates failed ICP reads rather than returning Free or using Supabase", async () => {
    mocks.read.mockRejectedValue(new Error("access refused"));
    await expect(readUpgradeClubSubscription("club-g2")).rejects.toThrow("access refused");
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("retains the exact-club Supabase read for email accounts", async () => {
    mocks.provider = "supabase";
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { is_pro: true }, error: null }) };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); mocks.from.mockReturnValue(query);
    expect(await readUpgradeClubSubscription("email-club")).toEqual({ is_pro: true });
    expect(query.eq).toHaveBeenCalledWith("club_id", "email-club");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("does not hide Supabase read errors as an absent subscription", async () => {
    mocks.provider = "supabase";
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error("network") }) };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); mocks.from.mockReturnValue(query);
    await expect(readUpgradeClubSubscription("email-club")).rejects.toThrow("network");
  });
});