import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "@icp-sdk/core/agent";
import type { IcpTargetConfig } from "./targetRegistry";
import { eraseIcpAccountAsAdmin } from "./adminAccountDeletion";
const m = vi.hoisted(() => ({ revoke: vi.fn(), erase: vi.fn(), dispose: vi.fn(), active: false,
  prepare: vi.fn(), commit: vi.fn(), settle: vi.fn(), validate: vi.fn(), sessionDispose: vi.fn(), targets: [] as IcpTargetConfig[] }));
vi.mock('./groupActivation', () => ({ SHIPPED_GATES: {}, activationStatus: () => ({ active: m.active }) }));
vi.mock('./generalActivation', () => ({ routingActive: async () => m.active, generalRoutingStatus: async () => ({ active: m.active, missing: [] }), cachedGeneralRoutingActive: () => m.active, clearGeneralRoutingCache: () => {} }));
vi.mock('./groupSessionLive', () => ({ openLiveGroupReadSession: async () => ({
  deletionRegistryRevision: 4n, readEveryGroup: async () => m.targets, assertRegistryUnchanged: m.validate, dispose: m.sessionDispose,
}) }));
vi.mock("./domains", () => ({ connectLiveClubDomain: async (target: IcpTargetConfig) => ({ actor: {
  erase_account_membership: (id: string) => m.revoke(id, target.canisterIds?.club_domain),
} }) }));
vi.mock("./identityAccess", () => ({ connectLiveIdentityAccessClientWithIdentity: async () => ({ client: { prepareAccountDeletion: m.prepare, commitAccountDeletion: m.commit, settleAccountDeletion: m.settle, eraseAccount: m.erase, dispose: m.dispose } }) }));
beforeEach(() => { vi.clearAllMocks(); m.active = false; m.targets = []; m.validate.mockResolvedValue(undefined);
  m.prepare.mockResolvedValue(undefined); m.commit.mockResolvedValue(undefined); m.settle.mockResolvedValue(undefined); m.revoke.mockResolvedValue({ Ok: null }); m.erase.mockResolvedValue(undefined); });
const target = (id: string) => ({ host: 'https://icp-api.io', networkKind: 'public_mainnet',
  canisterIds: { club_domain: id } }) as IcpTargetConfig;
describe("administrator erasure", () => {
  it("revokes the selected account before identity erasure", async () => {
    await eraseIcpAccountAsAdmin({} as Identity, {} as IcpTargetConfig, "selected-account");
    expect(m.revoke).toHaveBeenCalledWith("selected-account", undefined); expect(m.erase).toHaveBeenCalledWith("selected-account");
    expect(m.revoke.mock.invocationCallOrder[0]).toBeLessThan(m.erase.mock.invocationCallOrder[0] ?? 0);
    expect(m.dispose).toHaveBeenCalledOnce();
  });
  it("does not erase when authoritative membership revocation is denied", async () => {
    m.revoke.mockResolvedValue({ Err: "App admin required" });
    await expect(eraseIcpAccountAsAdmin({} as Identity, {} as IcpTargetConfig, "selected-account")).rejects.toThrow("App admin required");
    expect(m.erase).not.toHaveBeenCalled(); expect(m.dispose).toHaveBeenCalledOnce();
  });
  it('revokes selected-account access in every group, including groups without admin membership', async () => {
    m.active = true; m.targets = [target('legacy'), target('new')];
    await eraseIcpAccountAsAdmin({} as Identity, target('legacy'), 'selected-account');
    expect(m.revoke.mock.calls).toEqual([['selected-account', 'legacy'], ['selected-account', 'new']]);
    expect(m.prepare).toHaveBeenCalledWith('selected-account',4n);
    expect(m.prepare.mock.invocationCallOrder[0]).toBeLessThan(m.revoke.mock.invocationCallOrder[0]);
    expect(m.revoke.mock.invocationCallOrder[1]).toBeLessThan(m.commit.mock.invocationCallOrder[0]);
    expect(m.commit).toHaveBeenCalledWith('selected-account');
    expect(m.settle).toHaveBeenCalledWith('selected-account'); expect(m.erase).not.toHaveBeenCalled();
    expect(m.sessionDispose).toHaveBeenCalledOnce();
  });
  it('blocks shared erasure and permits full-inventory retry after partial revocation fails', async () => {
    m.active = true; m.targets = [target('new')];
    m.revoke.mockResolvedValueOnce({ Ok: null }).mockRejectedValueOnce(new Error('Authority unavailable'));
    await expect(eraseIcpAccountAsAdmin({} as Identity, target('legacy'), 'selected-account')).rejects.toThrow('unavailable');
    expect(m.erase).not.toHaveBeenCalled();
    await eraseIcpAccountAsAdmin({} as Identity, target('legacy'), 'selected-account');
    expect(m.revoke.mock.calls.map(c => c[1])).toEqual(['legacy', 'new', 'legacy', 'new']);
    expect(m.commit).toHaveBeenCalledOnce();
  });
  it('stops on registry change immediately after the first revocation', async () => {
    m.active = true; m.targets = [target('new')];
    m.revoke.mockImplementation(async () => {
      m.validate.mockRejectedValue(new Error('Group registry changed')); return { Ok: null };
    });
    await expect(eraseIcpAccountAsAdmin({} as Identity, target('legacy'), 'selected-account')).rejects.toThrow('registry changed');
    expect(m.revoke).toHaveBeenCalledOnce(); expect(m.erase).not.toHaveBeenCalled();
  });
  it('rejects an incomplete authority inventory before any revocation', async () => {
    m.active = true; m.targets = [{ canisterIds: {} } as IcpTargetConfig];
    await expect(eraseIcpAccountAsAdmin({} as Identity, target('legacy'), 'selected-account')).rejects.toThrow('requires club_domain');
    expect(m.revoke).not.toHaveBeenCalled(); expect(m.erase).not.toHaveBeenCalled();
  });
});