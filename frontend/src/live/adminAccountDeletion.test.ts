import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "@icp-sdk/core/agent";
import type { IcpTargetConfig } from "./targetRegistry";
import { eraseIcpAccountAsAdmin } from "./adminAccountDeletion";
const m = vi.hoisted(() => ({ revoke: vi.fn(), erase: vi.fn(), dispose: vi.fn() }));
vi.mock("./domains", () => ({ connectLiveClubDomain: async () => ({ actor: { erase_account_membership: m.revoke } }) }));
vi.mock("./identityAccess", () => ({ connectLiveIdentityAccessClientWithIdentity: async () => ({ client: { eraseAccount: m.erase, dispose: m.dispose } }) }));
beforeEach(() => { vi.clearAllMocks(); m.revoke.mockResolvedValue({ Ok: null }); m.erase.mockResolvedValue(undefined); });
describe("administrator erasure", () => {
  it("revokes the selected account before identity erasure", async () => {
    await eraseIcpAccountAsAdmin({} as Identity, {} as IcpTargetConfig, "selected-account");
    expect(m.revoke).toHaveBeenCalledWith("selected-account"); expect(m.erase).toHaveBeenCalledWith("selected-account");
    expect(m.revoke.mock.invocationCallOrder[0]).toBeLessThan(m.erase.mock.invocationCallOrder[0] ?? 0);
    expect(m.dispose).toHaveBeenCalledOnce();
  });
  it("does not erase when authoritative membership revocation is denied", async () => {
    m.revoke.mockResolvedValue({ Err: "App admin required" });
    await expect(eraseIcpAccountAsAdmin({} as Identity, {} as IcpTargetConfig, "selected-account")).rejects.toThrow("App admin required");
    expect(m.erase).not.toHaveBeenCalled(); expect(m.dispose).toHaveBeenCalledOnce();
  });
});