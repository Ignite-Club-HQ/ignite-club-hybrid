import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getEffectiveBackendForFeature: vi.fn<(feature: string) => "supabase" | "icp">(),
  getCurrentInternetIdentity: vi.fn(),
  getActiveIcpTarget: vi.fn(() => ({ alias: "test-target" })),
  tryGetActiveIcpTarget: vi.fn<() => unknown>(() => null),
  isSignedInWithEmail: vi.fn(() => false),
}));

vi.mock("./loadBackendRouting", () => ({
  getEffectiveBackendForFeature: mocks.getEffectiveBackendForFeature,
  tryGetActiveIcpTarget: mocks.tryGetActiveIcpTarget,
  isSignedInWithEmail: mocks.isSignedInWithEmail,
}));

vi.mock("./internetIdentityAuth", () => ({
  getCurrentInternetIdentity: mocks.getCurrentInternetIdentity,
  getCurrentInternetIdentityConfirmed: mocks.getCurrentInternetIdentity,
}));

vi.mock("./targetRegistry", () => ({
  getActiveIcpTarget: mocks.getActiveIcpTarget,
}));

import { withFeatureBackend } from "./featureRouter";

describe("withFeatureBackend", () => {
  beforeEach(() => {
    mocks.getEffectiveBackendForFeature.mockReset();
    mocks.getCurrentInternetIdentity.mockReset();
    mocks.tryGetActiveIcpTarget.mockReturnValue(null);
    mocks.isSignedInWithEmail.mockReturnValue(false);
  });

  it("reads Supabase for an email sign-in even when a club pin routes the feature to ICP", async () => {
    mocks.isSignedInWithEmail.mockReturnValue(true);
    mocks.getEffectiveBackendForFeature.mockReturnValue("icp");
    const supabaseFn = vi.fn(async () => "supabase-result");
    const icpFn = vi.fn(async () => "icp-result");
    expect(await withFeatureBackend("messaging", { supabase: supabaseFn, icp: icpFn })).toBe("supabase-result");
    expect(icpFn).not.toHaveBeenCalled();
  });

  it("keeps an Internet Identity user on the canister when routing momentarily says Supabase", async () => {
    mocks.getEffectiveBackendForFeature.mockReturnValue("supabase");
    const target = { alias: "t", canisterIds: { events_domain: "aaaaa-aa" } };
    mocks.tryGetActiveIcpTarget.mockReturnValue(target);
    const identity = { getPrincipal: () => ({}) };
    mocks.getCurrentInternetIdentity.mockResolvedValue(identity);
    const supabaseFn = vi.fn(async () => "supabase-result");
    const icpFn = vi.fn(async () => "icp-result");
    expect(await withFeatureBackend("events", { supabase: supabaseFn, icp: icpFn })).toBe("icp-result");
    expect(supabaseFn).not.toHaveBeenCalled();
    expect(icpFn).toHaveBeenCalledWith({ identity, target });
  });

  it("calls only the supabase provider, never touching identity/ICP, when the feature is not ICP-routed", async () => {
    mocks.getEffectiveBackendForFeature.mockReturnValue("supabase");
    const supabaseFn = vi.fn(async () => "supabase-result");
    const icpFn = vi.fn(async () => "icp-result");

    const result = await withFeatureBackend("messaging", { supabase: supabaseFn, icp: icpFn });

    expect(result).toBe("supabase-result");
    expect(supabaseFn).toHaveBeenCalledTimes(1);
    expect(icpFn).not.toHaveBeenCalled();
    expect(mocks.getCurrentInternetIdentity).not.toHaveBeenCalled();
  });

  it("routes to the icp provider with the active identity/target when the feature is ICP-routed", async () => {
    mocks.getEffectiveBackendForFeature.mockReturnValue("icp");
    const identity = { getPrincipal: () => ({}) };
    mocks.getCurrentInternetIdentity.mockResolvedValue(identity);
    const supabaseFn = vi.fn(async () => "supabase-result");
    const icpFn = vi.fn(async (ctx) => `icp:${ctx.target.alias}`);

    const result = await withFeatureBackend("messaging", { supabase: supabaseFn, icp: icpFn });

    expect(result).toBe("icp:test-target");
    expect(supabaseFn).not.toHaveBeenCalled();
    expect(icpFn).toHaveBeenCalledWith({ identity, target: { alias: "test-target" } });
  });

  it("throws instead of silently falling back to Supabase when ICP-routed with no active session", async () => {
    mocks.getEffectiveBackendForFeature.mockReturnValue("icp");
    mocks.getCurrentInternetIdentity.mockResolvedValue(null);
    const supabaseFn = vi.fn(async () => "supabase-result");

    await expect(
      withFeatureBackend("messaging", { supabase: supabaseFn, icp: vi.fn() }),
    ).rejects.toThrow(/Internet Identity session/);
    expect(supabaseFn).not.toHaveBeenCalled();
  });
});
