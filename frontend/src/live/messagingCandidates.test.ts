import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { FeatureBackendContext } from "./featureRouter";
import { AnonymousIdentity } from "@icp-sdk/core/agent";
const mocks = vi.hoisted(() => ({ grants: vi.fn() }));
vi.mock("./features/membership", () => ({ listLiveRoleGrants: mocks.grants }));
import { normalizeAccountId, fetchLiveMessagingCandidates, __resetMessagingRosterMemo } from "./messagingCandidates";

const ctx: FeatureBackendContext = {
  identity: new AnonymousIdentity(),
  target: { provider: "icp", alias: "test", host: "https://icp-api.io", networkKind: "public_mainnet",
    deploymentClass: "public_subnet", canisterIds: { club_domain: "original" } },
};
beforeEach(() => { __resetMessagingRosterMemo(); mocks.grants.mockReset().mockResolvedValue([]); });
afterEach(() => vi.useRealTimers());

describe("shared club roster warm-up", () => {
  it("reuses Home's authorized read when either picker opens", async () => {
    await fetchLiveMessagingCandidates(ctx, ["club-a"]);
    await fetchLiveMessagingCandidates(ctx, ["club-a"]);
    expect(mocks.grants).toHaveBeenCalledTimes(1);
    expect(mocks.grants).toHaveBeenCalledWith(ctx, "club-a");
  });
  it("never shares a roster across clubs, accounts or destinations", async () => {
    await fetchLiveMessagingCandidates(ctx, ["club-a"]);
    await fetchLiveMessagingCandidates(ctx, ["club-b"]);
    await fetchLiveMessagingCandidates({ ...ctx, target: { ...ctx.target, host: "https://other.example" } }, ["club-a"]);
    await fetchLiveMessagingCandidates({ ...ctx, target: { ...ctx.target, canisterIds: { club_domain: "other" } } }, ["club-a"]);
    await fetchLiveMessagingCandidates({ ...ctx, identity: { ...ctx.identity, getPrincipal: () => ({ toText: () => "other-member" }) } as unknown as FeatureBackendContext["identity"] }, ["club-a"]);
    expect(mocks.grants).toHaveBeenCalledTimes(5);
  });
  it("expires the shared copy after three minutes", async () => {
    vi.useFakeTimers();
    await fetchLiveMessagingCandidates(ctx, ["club-a"]);
    vi.advanceTimersByTime(180_000);
    await fetchLiveMessagingCandidates(ctx, ["club-a"]);
    expect(mocks.grants).toHaveBeenCalledTimes(2);
  });
  it("retires a suspended read after 20 seconds so a retry can succeed", async () => {
    vi.useFakeTimers();
    mocks.grants.mockImplementationOnce(() => new Promise(() => {}));
    const pending = fetchLiveMessagingCandidates(ctx, ["club-a"]);
    const rejected = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    await fetchLiveMessagingCandidates(ctx, ["club-a"]);
    expect(mocks.grants).toHaveBeenCalledTimes(2);
  });
});

describe("normalizeAccountId", () => {
  it("strips the club_domain 'principal:' prefix so grants resolve to real principals", () => {
    expect(normalizeAccountId("principal:tbifj-jslqb-llr2n-54yzx-waeuk-ponhi-lildr-r5kwc-kfd5q-2sqjk-sqe"))
      .toBe("tbifj-jslqb-llr2n-54yzx-waeuk-ponhi-lildr-r5kwc-kfd5q-2sqjk-sqe");
  });

  it("leaves bare principal text unchanged", () => {
    expect(normalizeAccountId("2vxsx-fae")).toBe("2vxsx-fae");
  });
});
