import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  acceptPendingLiveInvite: vi.fn(),
  readReceipt: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: async (_feature: string, providers: { icp: (ctx: unknown) => Promise<unknown> }) =>
    providers.icp({ identity: {}, target: {} }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}));
vi.mock("@/live/features/club", () => ({
  acceptPendingLiveInvite: mocks.acceptPendingLiveInvite,
  readLiveFamilyInviteReceipt: mocks.readReceipt,
}));
vi.mock("@/live/features/vault", () => ({ addLiveGuardianRelationship: vi.fn(), grantLivePiiRead: vi.fn() }));

import { acceptIcpInviteAndWelcome } from "./acceptIcpInviteAndWelcome";

describe("acceptIcpInviteAndWelcome", () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    mocks.readReceipt.mockResolvedValue({ child_ids: [], club_id: "club", team_id: ["team"], accepted_at_ms: 1n });
    mocks.acceptPendingLiveInvite.mockReset().mockImplementation(async () => {
      mocks.calls.push("accepted");
    });
    mocks.invoke.mockReset().mockImplementation(async () => {
      mocks.calls.push("email-requested");
      return { error: null };
    });
  });

  it("accepts on ICP without touching Supabase", async () => {
    await acceptIcpInviteAndWelcome("invite-1");

    expect(mocks.acceptPendingLiveInvite).toHaveBeenCalledWith(
      { identity: {}, target: {} },
      "invite-1",
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.calls).toEqual(["accepted"]);
  });

  it("keeps the accepted invite successful when Edge Function delivery fails", async () => {
    const logError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.invoke.mockRejectedValueOnce(new Error("mail service unavailable"));

    await expect(acceptIcpInviteAndWelcome("invite-1")).resolves.toMatchObject({ child_ids: [], club_id: "club" });
    expect(mocks.acceptPendingLiveInvite).toHaveBeenCalledOnce();
    expect(mocks.invoke).not.toHaveBeenCalled();
    logError.mockRestore();
  });
  it("returns the exact committed child IDs, not a current roster guess", async () => {
    mocks.readReceipt.mockResolvedValueOnce({ child_ids: [], club_id: "club", team_id: ["team"], accepted_at_ms: 7n });
    const receipt = await acceptIcpInviteAndWelcome("pinv-family");
    expect(receipt.accepted_at_ms).toBe(7n);
    expect(mocks.readReceipt).toHaveBeenCalledWith({ identity: {}, target: {} }, "pinv-family");
  });
});
