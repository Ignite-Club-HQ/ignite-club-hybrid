import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { sendScheduleBroadcast, subscribeToScheduleBroadcasts } from "./scheduleBroadcast";

const mocks = vi.hoisted(() => ({
  mode: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  identity: { getPrincipal: () => ({ toText: () => "member" }) },
  getIdentity: vi.fn(), listTeam: vi.fn(), listClub: vi.fn(), fanOut: vi.fn(),
  insert: vi.fn(), fresh: vi.fn(), channel: vi.fn(), remove: vi.fn(), refreshes: vi.fn(),
}));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: (_feature: unknown, providers: { icp: (ctx: unknown) => unknown }) => providers.icp({ identity: mocks.identity, target: {} }) }));
vi.mock('@/live/clubScope', () => ({ writeOnce: (scope: unknown) => scope }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => mocks.mode }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => mocks.mode === "icp" }));
vi.mock("@/live/internetIdentityAuth", () => ({ getCurrentInternetIdentity: mocks.getIdentity }));
vi.mock("@/live/targetRegistry", () => ({ getActiveIcpTarget: () => ({}) }));
vi.mock("@/live/features/membership", () => ({ listLiveTeamRoleGrants: mocks.listTeam, listLiveRoleGrants: mocks.listClub }));
vi.mock("@/live/features/notifications", () => ({ fanOutLiveNotifications: mocks.fanOut, getLiveScheduleRefreshes: mocks.refreshes }));
vi.mock("@/lib/ensureFreshSession", () => ({ ensureFreshSession: mocks.fresh }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => ({ insert: mocks.insert }), channel: mocks.channel, removeChannel: mocks.remove,
} }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getIdentity.mockResolvedValue(mocks.identity);
  mocks.listTeam.mockResolvedValue([{ account_id: "principal:member", team: ["team-1"] }]);
  mocks.listClub.mockResolvedValue([{ account_id: "principal:member" }]);
  mocks.fanOut.mockResolvedValue(1);
  mocks.insert.mockResolvedValue({ error: null });
  mocks.fresh.mockResolvedValue("user-1");
  mocks.refreshes.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe.runIf(mocks.mode === "icp")("ICP schedule broadcasts", () => {
  it("notifies the team-scoped roster without dropping account-role rows", async () => {
    mocks.listTeam.mockResolvedValue([
      { account_id: "principal:member", team: ["team-1"] },
      { account_id: "principal:member", team: ["team-1"] },
      { account_id: "principal:coach", team: ["team-1"] },
    ]);
    expect(await sendScheduleBroadcast("club-1", "team-1")).toEqual({ ok: true });
    expect(mocks.listTeam).toHaveBeenCalledWith(expect.anything(), "team-1");
    expect(mocks.listClub).not.toHaveBeenCalled();
    expect(mocks.fanOut).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userIds: ["member", "coach"], clubId: "club-1", relatedId: "team-1", kind: "schedule_refresh",
    }));
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.fresh).not.toHaveBeenCalled();
  });
  it("notifies a club roster once per account", async () => {
    expect(await sendScheduleBroadcast("club-1")).toEqual({ ok: true });
    expect(mocks.fanOut).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userIds: ["member"], relatedId: null }));
  });
  it("reports canister authorization failures instead of reporting success", async () => {
    mocks.fanOut.mockRejectedValue(new Error("Schedule manager required"));
    expect(await sendScheduleBroadcast("club-1", "team-1")).toEqual({ ok: false, error: "Schedule manager required" });
  });
  it("requires an Internet Identity session", async () => {
    mocks.getIdentity.mockResolvedValue(null);
    expect((await sendScheduleBroadcast("club-1")).ok).toBe(false);
    expect(mocks.fanOut).not.toHaveBeenCalled();
  });
  it("does not fan out an empty roster", async () => {
    mocks.listTeam.mockResolvedValue([]);
    expect(await sendScheduleBroadcast("club-1", "team-1")).toEqual({ ok: true });
    expect(mocks.fanOut).not.toHaveBeenCalled();
  });
  it("refreshes only for new durable signals and stops after unsubscribe", async () => {
    vi.useFakeTimers();
    const bump = vi.fn();
    const stop = subscribeToScheduleBroadcasts(["club-1"], bump);
    await vi.advanceTimersByTimeAsync(0);
    expect(bump).not.toHaveBeenCalled();
    mocks.refreshes.mockResolvedValue([{ club: "club-1", team: ["team-1"], key: "signal-1" }]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(bump).toHaveBeenCalledTimes(1);
    expect(bump).toHaveBeenCalledWith({ club_id: "club-1", team_id: "team-1" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(bump).toHaveBeenCalledTimes(1);
    mocks.refreshes.mockResolvedValue([{ club: "club-1", team: ["team-1"], key: "signal-2" }]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(bump).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(bump).toHaveBeenCalledTimes(2);
    expect(mocks.channel).not.toHaveBeenCalled();
  });
});

describe.runIf(mocks.mode === "supabase")("Supabase schedule broadcasts", () => {
  it("keeps the authenticated schedule_broadcasts insert", async () => {
    expect(await sendScheduleBroadcast("club-1", "team-1")).toEqual({ ok: true });
    expect(mocks.insert).toHaveBeenCalledWith({ club_id: "club-1", team_id: "team-1", bumped_by: "user-1" });
    expect(mocks.fanOut).not.toHaveBeenCalled();
  });
  it("reports an insert rejection", async () => {
    mocks.insert.mockResolvedValue({ error: { message: "permission denied" } });
    expect(await sendScheduleBroadcast("club-1")).toEqual({ ok: false, error: "permission denied" });
  });
});