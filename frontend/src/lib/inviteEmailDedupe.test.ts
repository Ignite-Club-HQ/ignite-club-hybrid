import { describe, it, expect, beforeEach, vi } from "vitest";

const { rpcMock, backend, context } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  backend: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  context: { identity: {}, target: {} },
}));
const supabaseMode = backend === "supabase";
const pendingLookup = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock("@/live/features/club", () => ({ findLivePendingInviteByEmailHash: pendingLookup }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    backend === "icp" ? providers.icp(context) : providers.supabase(),
}));

import { lookupInvitableUserByEmail, isPlausibleInvitableEmail } from "./inviteEmailDedupe";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("isPlausibleInvitableEmail", () => {
  it.each([
    "redacted@example.invalid",
    "redacted@example.invalid",
    "redacted@example.invalid",
  ])("accepts %s", (v) => expect(isPlausibleInvitableEmail(v)).toBe(true));

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["no @", "notanemail"],
    ["missing local", "@example.test"],
    ["missing domain", "x@"],
    ["missing TLD", "x@example"],
    ["short TLD", "x@example.c"],
    ["internal space", "a redacted@example.invalid"],
    ["embedded space", "a @example.com"],
    ["two @", "a@redacted@example.invalid"],
    ["double dot local", "re..dacted@example.invalid"],
    ["leading dot", ".redacted@example.invalid"],
    ["not a string", null as unknown as string],
  ])("rejects %s", (_label, v) => expect(isPlausibleInvitableEmail(v as string)).toBe(false));
});

describe("lookupInvitableUserByEmail — local validation", () => {
  it.each(["", "   ", "x@", "@example.test", "a redacted@example.invalid", "no-at", "a@example"])(
    "returns null without calling RPC for %s",
    async (bad) => {
      const result = await lookupInvitableUserByEmail({ email: bad });
      expect(result).toBeNull();
      expect(rpcMock).not.toHaveBeenCalled();
    },
  );

  it.runIf(supabaseMode)("normalises (trim + lowercase) before calling the RPC", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await lookupInvitableUserByEmail({ email: "  redacted@example.invalid  " });
    expect(rpcMock).toHaveBeenCalledWith("lookup_invitable_user_by_email", expect.objectContaining({ _email: "redacted@example.invalid" }));
  });
});

describe.runIf(supabaseMode)("lookupInvitableUserByEmail — RPC response validation", () => {
  const valid = {
    user_id: "u1",
    display_name: "Alice",
    avatar_url: null,
    already_in_club: true,
    already_in_team: false,
    already_in_mini_league: false,
  };

  it("accepts a well-formed object response", async () => {
    rpcMock.mockResolvedValue({ data: valid, error: null });
    const r = await lookupInvitableUserByEmail({ email: "redacted@example.invalid" });
    expect(r).toEqual(valid);
  });

  it("accepts the first element of a well-formed array response", async () => {
    rpcMock.mockResolvedValue({ data: [valid, { user_id: "ignored" }], error: null });
    const r = await lookupInvitableUserByEmail({ email: "redacted@example.invalid" });
    expect(r?.user_id).toBe("u1");
  });

  it("returns null when data is a string", async () => {
    rpcMock.mockResolvedValue({ data: "hacked", error: null });
    expect(await lookupInvitableUserByEmail({ email: "redacted@example.invalid" })).toBeNull();
  });

  it("returns null when data is a number", async () => {
    rpcMock.mockResolvedValue({ data: 42, error: null });
    expect(await lookupInvitableUserByEmail({ email: "redacted@example.invalid" })).toBeNull();
  });

  it("returns null when array contains a non-object", async () => {
    rpcMock.mockResolvedValue({ data: ["nope"], error: null });
    expect(await lookupInvitableUserByEmail({ email: "redacted@example.invalid" })).toBeNull();
  });

  it("returns null when user_id is missing", async () => {
    rpcMock.mockResolvedValue({ data: { display_name: "x" }, error: null });
    expect(await lookupInvitableUserByEmail({ email: "redacted@example.invalid" })).toBeNull();
  });

  it("returns null when user_id is empty string", async () => {
    rpcMock.mockResolvedValue({ data: { ...valid, user_id: "" }, error: null });
    expect(await lookupInvitableUserByEmail({ email: "redacted@example.invalid" })).toBeNull();
  });

  it("coerces non-boolean `already_in_*` fields to false", async () => {
    rpcMock.mockResolvedValue({
      data: { ...valid, already_in_club: "yes", already_in_team: 1, already_in_mini_league: null },
      error: null,
    });
    const r = await lookupInvitableUserByEmail({ email: "redacted@example.invalid" });
    expect(r).toEqual({ ...valid, already_in_club: false, already_in_team: false, already_in_mini_league: false });
  });

  it("returns null when RPC errors (privacy-safe fallback)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await lookupInvitableUserByEmail({ email: "redacted@example.invalid" })).toBeNull();
  });
});

describe.runIf(!supabaseMode)("lookupInvitableUserByEmail — ICP privacy fallback", () => {
  it("returns the normal-invite fallback without querying Supabase", async () => {
    await expect(lookupInvitableUserByEmail({
      email: "  redacted@example.invalid  ",
      clubId: "club-1",
      teamId: "team-1",
    })).resolves.toBeNull();
    expect(pendingLookup).toHaveBeenCalledWith(context, "club-1", expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("uses the normalized email hash to find an existing pending club invite", async () => {
    pendingLookup.mockResolvedValueOnce([{ invite_id: "pending-invite-1" }]);

    await expect(lookupInvitableUserByEmail({
      email: "  Parent@Example.Invalid  ",
      clubId: "club-1",
      teamId: "team-1",
    })).resolves.toEqual({
      user_id: "pending-invite-1",
      display_name: null,
      avatar_url: null,
      already_in_club: true,
      already_in_team: false,
      already_in_mini_league: false,
    });
    expect(pendingLookup).toHaveBeenCalledWith(context, "club-1", expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("does not perform hash lookup without a club scope", async () => {
    await expect(lookupInvitableUserByEmail({ email: "parent@example.invalid", teamId: "team-1" }))
      .resolves.toBeNull();
    expect(pendingLookup).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("falls back to a normal invite when the pending-hash lookup fails", async () => {
    pendingLookup.mockRejectedValueOnce(new Error("canister unavailable"));

    await expect(lookupInvitableUserByEmail({ email: "parent@example.invalid", clubId: "club-1" }))
      .resolves.toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
