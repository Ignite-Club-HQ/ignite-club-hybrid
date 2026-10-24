import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Identity } from "@icp-sdk/core/agent";
import { eraseMyIcpAccount } from "./accountData";

const mocks = vi.hoisted(() => ({
  whoami: vi.fn(), erase: vi.fn(), dispose: vi.fn(), revoke: vi.fn(),
  purgeVault: vi.fn(), purgeEvents: vi.fn(), purgeMessaging: vi.fn(), purgeCompetitions: vi.fn(),
  prepare: vi.fn(), checkBroadcast: vi.fn(), purgeRelay: vi.fn(), purgeQueue: vi.fn(),
}));
vi.mock("./domains", () => ({
  connectLiveClubDomain: async () => ({ actor: { erase_my_membership: mocks.revoke, prepare_my_broadcast_erasure: mocks.prepare, purge_my_broadcast_data: mocks.purgeRelay } }),
  connectLiveVaultDomain: async () => ({ actor: { purge_my_data: mocks.purgeVault } }),
  connectLiveEventsDomain: async () => ({ actor: { purge_my_data: mocks.purgeEvents } }),
  connectLiveMessagingDomain: async () => ({ actor: { purge_my_data: mocks.purgeMessaging } }),
  connectLiveCompetitionDomain: async () => ({ actor: { purge_my_data: mocks.purgeCompetitions, prepare_my_broadcast_erasure: mocks.prepare, check_my_broadcast_erasure: mocks.checkBroadcast } }),
  connectLiveNotificationQueue: async () => ({ actor: { purge_my_data: mocks.purgeQueue, prepare_my_broadcast_erasure: mocks.prepare } }),
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
  mocks.purgeCompetitions.mockResolvedValue({ Ok: 2 });
  mocks.prepare.mockResolvedValue({ Ok: null });
  mocks.checkBroadcast.mockResolvedValue({ Ok: null });
  mocks.purgeRelay.mockResolvedValue({ Ok: 1 });
  mocks.purgeQueue.mockResolvedValue({ Ok: 1 });
});
describe("caller account erasure", () => {
  it("never retires relay evidence or revokes access when a frozen broadcast is incomplete", async () => {
    mocks.checkBroadcast.mockResolvedValueOnce({ Err: "Original broadcast must complete" });
    await expect(eraseMyIcpAccount(identity)).rejects.toThrow("Original broadcast must complete");
    expect(mocks.purgeRelay).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.erase).not.toHaveBeenCalled();
  });
  it("erases the account, revokes club access and purges personal content on every domain", async () => {
    const result = await eraseMyIcpAccount(identity);
    expect(mocks.erase).toHaveBeenCalledWith("own-account");
    expect(mocks.revoke).toHaveBeenCalledTimes(1);
    expect(mocks.purgeVault).toHaveBeenCalledTimes(1);
    expect(mocks.purgeEvents).toHaveBeenCalledTimes(1);
    expect(mocks.purgeMessaging).toHaveBeenCalledTimes(1);
    expect(mocks.purgeCompetitions).toHaveBeenCalledTimes(1);
    expect(mocks.purgeQueue).toHaveBeenCalledTimes(1);
    expect(result.note).toContain("acknowledged cleanup");
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });
  it("retains the identity when personal-content cleanup is refused", async () => {
    mocks.purgeMessaging.mockResolvedValue({ Err: "Canister busy" });
    await expect(eraseMyIcpAccount(identity)).rejects.toThrow("Account deletion is incomplete: messaging");
    expect(mocks.erase).not.toHaveBeenCalled();
    expect(mocks.purgeCompetitions).toHaveBeenCalledTimes(1);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });
  it("retains the identity after an unknown cleanup outcome and permits confirmed retry", async () => {
    mocks.purgeCompetitions.mockRejectedValueOnce(new Error("Reply lost"));
    await expect(eraseMyIcpAccount(identity)).rejects.toThrow("Account deletion is incomplete: competitions");
    expect(mocks.erase).not.toHaveBeenCalled();
    await eraseMyIcpAccount(identity);
    expect(mocks.erase).toHaveBeenCalledTimes(1);
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
