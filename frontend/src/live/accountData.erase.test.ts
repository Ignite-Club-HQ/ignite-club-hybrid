import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Identity } from "@icp-sdk/core/agent";
import { eraseMyIcpAccount } from "./accountData";

const mocks = vi.hoisted(() => ({
  whoami: vi.fn(), erase: vi.fn(), dispose: vi.fn(), revoke: vi.fn(),
  purgeVault: vi.fn(), purgeEvents: vi.fn(), purgeMessaging: vi.fn(),
}));
vi.mock("./domains", () => ({
  connectLiveClubDomain: async () => ({ actor: { erase_my_membership: mocks.revoke } }),
  connectLiveVaultDomain: async () => ({ actor: { purge_my_data: mocks.purgeVault } }),
  connectLiveEventsDomain: async () => ({ actor: { purge_my_data: mocks.purgeEvents } }),
  connectLiveMessagingDomain: async () => ({ actor: { purge_my_data: mocks.purgeMessaging } }),
}));
vi.mock("./targetRegistry", () => ({ getActiveIcpTarget: () => ({ alias: "test" }) }));
vi.mock("./identityAccess", () => ({
  isLiveIdentityAccessConfigured: () => true,
  connectLiveIdentityAccessClientWithIdentity: async () => ({ client: {
    whoami: mocks.whoami, eraseAccount: mocks.erase, dispose: mocks.dispose,
  } }),
}));
const identity = {} as Identity;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.whoami.mockResolvedValue({ id: "own-account" });
  mocks.erase.mockResolvedValue(undefined);
  mocks.revoke.mockResolvedValue({ Ok: null });
  mocks.purgeVault.mockResolvedValue({ Ok: 3 });
  mocks.purgeEvents.mockResolvedValue({ Ok: 5 });
  mocks.purgeMessaging.mockResolvedValue({ Ok: 7 });
});
describe("caller account erasure", () => {
  it("erases the account, revokes club access and purges personal content on every domain", async () => {
    const result = await eraseMyIcpAccount(identity);
    expect(mocks.erase).toHaveBeenCalledWith("own-account");
    expect(mocks.revoke).toHaveBeenCalledTimes(1);
    expect(mocks.purgeVault).toHaveBeenCalledTimes(1);
    expect(mocks.purgeEvents).toHaveBeenCalledTimes(1);
    expect(mocks.purgeMessaging).toHaveBeenCalledTimes(1);
    expect(result.note).toContain("permanently removed");
    expect(result.note).not.toContain("could not be completed");
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });
  it("still erases the identity but discloses a domain purge failure", async () => {
    mocks.purgeMessaging.mockResolvedValue({ Err: "Canister busy" });
    const result = await eraseMyIcpAccount(identity);
    expect(mocks.erase).toHaveBeenCalledWith("own-account");
    expect(result.note).toContain("messaging purge could not be completed");
  });
  it("propagates denied erasure and disposes the client", async () => {
    mocks.erase.mockRejectedValue(new Error("Governor account cannot be erased"));
    await expect(eraseMyIcpAccount(identity)).rejects.toThrow("Governor account cannot be erased");
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });
  it("never erases a supplied account when caller resolution fails", async () => {
    mocks.whoami.mockRejectedValue(new Error("Unlinked identity"));
    await expect(eraseMyIcpAccount(identity)).rejects.toThrow("Unlinked identity");
    expect(mocks.erase).not.toHaveBeenCalled();
  });
  it("does not erase the profile when club access revocation fails", async () => {
    mocks.revoke.mockResolvedValue({ Err: "Governor account cannot be erased" });
    await expect(eraseMyIcpAccount(identity)).rejects.toThrow("Governor account cannot be erased");
    expect(mocks.erase).not.toHaveBeenCalled();
    expect(mocks.purgeVault).not.toHaveBeenCalled();
  });
});
