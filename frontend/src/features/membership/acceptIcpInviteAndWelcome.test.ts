import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  acceptPendingLiveInvite: vi.fn(),
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
}));

import { acceptIcpInviteAndWelcome } from "./acceptIcpInviteAndWelcome";

describe("acceptIcpInviteAndWelcome", () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    mocks.acceptPendingLiveInvite.mockReset().mockImplementation(async () => {
      mocks.calls.push("accepted");
    });
    mocks.invoke.mockReset().mockImplementation(async () => {
      mocks.calls.push("email-requested");
      return { error: null };
    });
  });

  it("accepts the invite before requesting its welcome email", async () => {
    await acceptIcpInviteAndWelcome("invite-1");

    expect(mocks.acceptPendingLiveInvite).toHaveBeenCalledWith(
      { identity: {}, target: {} },
      "invite-1",
    );
    expect(mocks.invoke).toHaveBeenCalledWith("send-welcome-email-icp", {
      body: { inviteId: "invite-1" },
    });
    expect(mocks.calls).toEqual(["accepted", "email-requested"]);
  });

  it("keeps the accepted invite successful when Edge Function delivery fails", async () => {
    const logError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.invoke.mockRejectedValueOnce(new Error("mail service unavailable"));

    await expect(acceptIcpInviteAndWelcome("invite-1")).resolves.toBeUndefined();
    expect(mocks.acceptPendingLiveInvite).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalled();
    logError.mockRestore();
  });
});
