import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getEffectiveBackendForFeature: vi.fn<(feature: string) => "supabase" | "icp">(),
  getCurrentInternetIdentity: vi.fn(),
  getActiveIcpTarget: vi.fn(() => ({ alias: "test-target" })),
  tryGetActiveIcpTarget: vi.fn<() => unknown>(() => null),
  isSignedInWithEmail: vi.fn(() => false),
  groupActive: false,
  readFor: vi.fn(),
  writeFor: vi.fn(),
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
vi.mock("./groupActivation", () => ({
  activationStatus: () => ({ active: mocks.groupActive, missing: [] }),
  SHIPPED_GATES: {},
}));
vi.mock('./generalActivation', () => ({ routingActive: async () => mocks.groupActive, generalRoutingStatus: async () => ({ active: mocks.groupActive, missing: [] }), cachedGeneralRoutingActive: () => mocks.groupActive, clearGeneralRoutingCache: () => {} }));
vi.mock("./groupDispatch", () => ({
  clubDispatch: {
    forNewClub: vi.fn(),
    forInvite: vi.fn(),
    readAcross: vi.fn(),
    readFor: mocks.readFor,
    writeFor: mocks.writeFor,
  },
}));

import { withFeatureBackend } from "./featureRouter";

describe("withFeatureBackend", () => {
  beforeEach(() => {
    mocks.getEffectiveBackendForFeature.mockReset();
    mocks.getCurrentInternetIdentity.mockReset();
    mocks.tryGetActiveIcpTarget.mockReturnValue(null);
    mocks.isSignedInWithEmail.mockReturnValue(false);
    mocks.groupActive = false;
    mocks.readFor.mockReset(); mocks.writeFor.mockReset();
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

  it("dispatches an event-scoped read through its grouped domain when group routing is active", async () => {
    mocks.getEffectiveBackendForFeature.mockReturnValue("icp");
    mocks.getCurrentInternetIdentity.mockResolvedValue({ getPrincipal: () => ({}) });
    mocks.groupActive = true;
    const groupContext = { identity: {}, target: { canisterIds: { events_domain: "group-events" } } };
    mocks.readFor.mockImplementation(async (
      _feature: string,
      _scope: unknown,
      _domain: string,
      read: (ctx: unknown) => Promise<string>,
    ) => read(groupContext));
    const supabaseFn = vi.fn(async () => "supabase-result");
    const icpFn = vi.fn(async (ctx: { target: { canisterIds: { events_domain: string } } }) =>
      ctx.target.canisterIds.events_domain);

    await expect(withFeatureBackend("events", { supabase: supabaseFn, icp: icpFn }, { eventId: "event-1" }))
      .resolves.toBe("group-events");

    expect(mocks.readFor).toHaveBeenCalledWith(
      "events",
      { eventId: "event-1" },
      "events_domain",
      expect.any(Function),
    );
    expect(icpFn).toHaveBeenCalledWith(groupContext);
    expect(supabaseFn).not.toHaveBeenCalled();
  });

  it("fails closed for an unscoped club-data call when group routing is active", async () => {
    mocks.getEffectiveBackendForFeature.mockReturnValue("icp");
    mocks.getCurrentInternetIdentity.mockResolvedValue({ getPrincipal: () => ({}) });
    mocks.groupActive = true;
    const icpFn = vi.fn();

    await expect(withFeatureBackend("events", { supabase: vi.fn(), icp: icpFn }))
      .rejects.toThrow('"events" call has no club scope');

    expect(mocks.readFor).not.toHaveBeenCalled();
    expect(mocks.writeFor).not.toHaveBeenCalled();
    expect(icpFn).not.toHaveBeenCalled();
  });

  it.each(['icp', 'supabase'] as const)('preserves two-club dispatch when placement momentarily resolves to %s', async backend => {
    mocks.groupActive = true;
    mocks.getEffectiveBackendForFeature.mockReturnValue(backend);
    mocks.tryGetActiveIcpTarget.mockReturnValue({ alias: 'shared', canisterIds: { messaging_domain: 'aaaaa-aa' } });
    const identity = { getPrincipal: () => ({ toText: () => 'member' }) };
    mocks.getCurrentInternetIdentity.mockResolvedValue(identity);
    mocks.readFor.mockImplementation(async (_feature, scope, _domain, read) => read({ identity, target: { alias: scope.clubId === 'club-a' ? 'group-a' : 'group-b' } }));
    const supabase = vi.fn();
    const icp = vi.fn(async ctx => ctx.target.alias);
    expect(await withFeatureBackend('messaging', { supabase, icp }, { clubId: 'club-a' })).toBe('group-a');
    expect(await withFeatureBackend('messaging', { supabase, icp }, { clubId: 'club-b' })).toBe('group-b');
    mocks.readFor.mockRejectedValueOnce(new Error('Club access revoked'));
    await expect(withFeatureBackend('messaging', { supabase, icp }, { clubId: 'club-a' })).rejects.toThrow('revoked');
    expect(await withFeatureBackend('messaging', { supabase, icp }, { clubId: 'club-b' })).toBe('group-b');
    mocks.readFor.mockRejectedValueOnce(new Error('Group unavailable'));
    await expect(withFeatureBackend('messaging', { supabase, icp }, { clubId: 'club-b' })).rejects.toThrow('unavailable');
    await expect(withFeatureBackend('messaging', { supabase, icp })).rejects.toThrow('no club scope');
    expect(supabase).not.toHaveBeenCalled();
    expect(icp.mock.calls.map(([ctx]) => ctx.target.alias)).toEqual(['group-a', 'group-b', 'group-b']);
  });

  it('dispatches a scoped mutation once with the original single-attempt policy', async () => {
    mocks.groupActive = true; mocks.getEffectiveBackendForFeature.mockReturnValue('icp');
    mocks.getCurrentInternetIdentity.mockResolvedValue({ getPrincipal: () => ({}) });
    mocks.writeFor.mockRejectedValue(new Error('Outcome unknown'));
    const icp = vi.fn(); const supabase = vi.fn();
    await expect(withFeatureBackend('media', { supabase, icp }, { clubId: 'club-a', writeKey: 'upload-once', attempts: 1 })).rejects.toThrow('unknown');
    expect(mocks.writeFor).toHaveBeenCalledExactlyOnceWith('media', expect.objectContaining({ clubId: 'club-a' }), 'media_metadata', 'upload-once', expect.any(Function), 1);
    expect(icp).not.toHaveBeenCalled(); expect(supabase).not.toHaveBeenCalled();
  });
});
