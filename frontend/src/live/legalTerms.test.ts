import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  myTermsAcceptance: vi.fn(),
  setTermsAcceptance: vi.fn(),
  getTermsAcceptance: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("./identityAccess", () => ({
  connectLiveIdentityAccessClientWithIdentity: vi.fn(async () => ({
    client: {
      myTermsAcceptance: mocks.myTermsAcceptance,
      setTermsAcceptance: mocks.setTermsAcceptance,
      getTermsAcceptance: mocks.getTermsAcceptance,
      dispose: mocks.dispose,
    },
  })),
  isLiveIdentityAccessConfigured: () => true,
}));

vi.mock("./targetRegistry", () => ({
  getActiveIcpTarget: () => ({ alias: "test", canisterIds: {} }),
}));

import { fetchIcpTermsAcceptanceFor, fetchMyIcpTermsAcceptance, setIcpTermsAcceptance } from "./legalTerms";

const identity = {} as never;

describe("legalTerms", () => {
  it("maps a missing acceptance to null", async () => {
    mocks.myTermsAcceptance.mockResolvedValueOnce([]);
    const result = await fetchMyIcpTermsAcceptance(identity);
    expect(result).toBeNull();
    expect(mocks.dispose).toHaveBeenCalled();
  });

  it("maps an existing acceptance", async () => {
    mocks.myTermsAcceptance.mockResolvedValueOnce([
      { account_id: "acct-1", terms_version: 3, accepted_at_ms: 1000n },
    ]);
    const result = await fetchMyIcpTermsAcceptance(identity);
    expect(result).toEqual({ accountId: "acct-1", termsVersion: 3, acceptedAtMs: 1000 });
  });

  it("sets terms acceptance and maps the response", async () => {
    mocks.setTermsAcceptance.mockResolvedValueOnce({
      account_id: "acct-1",
      terms_version: 4,
      accepted_at_ms: 2000n,
    });
    const result = await setIcpTermsAcceptance(identity, 4);
    expect(mocks.setTermsAcceptance).toHaveBeenCalledWith(4);
    expect(result).toEqual({ accountId: "acct-1", termsVersion: 4, acceptedAtMs: 2000 });
  });

  it("fetches another account's acceptance (owner/governor gated)", async () => {
    mocks.getTermsAcceptance.mockResolvedValueOnce([]);
    const result = await fetchIcpTermsAcceptanceFor(identity, "acct-2");
    expect(mocks.getTermsAcceptance).toHaveBeenCalledWith("acct-2");
    expect(result).toBeNull();
  });
});
