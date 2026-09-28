import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingleMocks: Record<string, () => Promise<{ data: unknown; error: unknown }>> = {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            (maybeSingleMocks[table] ?? (async () => ({ data: null, error: null })))(),
        }),
      }),
    }),
  },
}));

import {
  resolveChatTargetForMessageId,
  chatTargetPath,
  NOTIFICATION_FALLBACK_PATH,
} from "./notificationChatRouting";

function setTable(table: string, data: unknown, error: unknown = null) {
  maybeSingleMocks[table] = async () => ({ data, error });
}

beforeEach(() => {
  for (const key of Object.keys(maybeSingleMocks)) delete maybeSingleMocks[key];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("resolveChatTargetForMessageId", () => {
  it("resolves an accessible team message to the exact message", async () => {
    setTable("team_messages", { team_id: "team-1" });
    expect(await resolveChatTargetForMessageId("m1")).toEqual({
      kind: "team",
      targetId: "team-1",
      messageId: "m1",
      path: "/messages/team-1?message=m1",
    });
  });

  it("resolves club messages", async () => {
    setTable("club_messages", { club_id: "club-1" });
    const t = await resolveChatTargetForMessageId("m2");
    expect(t?.path).toBe("/messages/club/club-1?message=m2");
  });

  it("resolves group messages", async () => {
    setTable("group_messages", { group_id: "g1" });
    expect((await resolveChatTargetForMessageId("m3"))?.path).toBe("/groups/g1?message=m3");
  });

  it("resolves direct messages", async () => {
    setTable("direct_messages", { conversation_id: "c1" });
    expect((await resolveChatTargetForMessageId("m4"))?.path).toBe("/messages/dm/c1?message=m4");
  });

  it("resolves broadcast messages", async () => {
    setTable("broadcast_messages", { id: "m5" });
    expect((await resolveChatTargetForMessageId("m5"))?.path).toBe("/messages/broadcast?message=m5");
  });

  it("resolves club admin messages", async () => {
    setTable("club_admin_messages", { conversation_id: "cc1" });
    expect((await resolveChatTargetForMessageId("m6"))?.path).toBe(
      "/messages/club-admin/cc1?message=m6",
    );
  });

  it("returns null for a deleted message (no rows anywhere)", async () => {
    expect(await resolveChatTargetForMessageId("gone")).toBeNull();
  });

  it("returns null for an RLS-hidden message", async () => {
    setTable("team_messages", null, null);
    expect(await resolveChatTargetForMessageId("hidden")).toBeNull();
  });

  it("returns null and does not throw when a lookup errors", async () => {
    setTable("team_messages", null, { code: "42501", message: "permission denied" });
    expect(await resolveChatTargetForMessageId("err")).toBeNull();
  });

  it("returns null when a lookup rejects", async () => {
    maybeSingleMocks["team_messages"] = async () => {
      throw new Error("network");
    };
    expect(await resolveChatTargetForMessageId("boom")).toBeNull();
  });

  it("returns null for an empty message id", async () => {
    expect(await resolveChatTargetForMessageId("")).toBeNull();
  });
});

describe("fallback path", () => {
  it("never embeds an unverified id", () => {
    expect(NOTIFICATION_FALLBACK_PATH).toBe("/messages");
    expect(chatTargetPath("team", null, "unverified")).toBe("/messages");
    expect(chatTargetPath("dm", null, "unverified")).toBe("/messages");
    expect(chatTargetPath("club_admin", null, "unverified")).toBe("/messages");
  });
});
