import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Identity } from "@icp-sdk/core/agent";
import { eraseMyIcpAccount } from "./accountData";

const mocks = vi.hoisted(() => ({ whoami: vi.fn(), erase: vi.fn(), dispose: vi.fn() }));
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
});
describe("caller account erasure", () => {
  it("erases only the account resolved by the authenticated canister client", async () => {
    const result = await eraseMyIcpAccount(identity);
    expect(mocks.erase).toHaveBeenCalledWith("own-account");
    expect(result.note).toContain("not yet covered");
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
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
});