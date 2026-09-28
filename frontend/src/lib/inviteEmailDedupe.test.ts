import { describe, it, expect, beforeEach, vi } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
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

  it("normalises (trim + lowercase) before calling the RPC", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await lookupInvitableUserByEmail({ email: "  redacted@example.invalid  " });
    expect(rpcMock).toHaveBeenCalledWith("lookup_invitable_user_by_email", expect.objectContaining({ _email: "redacted@example.invalid" }));
  });
});

describe("lookupInvitableUserByEmail — RPC response validation", () => {
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
