import { describe, expect, it } from "vitest";
import {
  BROADCAST_CHAT_SCOPE,
  buildChatScopeFilter,
  CHAT_SCOPE_ADAPTERS,
  getChatScopeAdapterByTable,
} from "./chatScopeAdapters";

const cases = [
  ["team", "team_messages", "team_id", "team_message_id", "team-messages", "/messages/scope-1"],
  ["club", "club_messages", "club_id", "club_message_id", "club-messages", "/messages/club/scope-1"],
  ["group", "group_messages", "group_id", "group_message_id", "group-messages", "/groups/scope-1"],
  ["direct", "direct_messages", "conversation_id", "direct_message_id", "dm-messages", "/messages/dm/scope-1"],
  ["club_admin", "club_admin_messages", "conversation_id", "club_admin_message_id", "club-admin-messages", "/messages/club-admin/scope-1"],
] as const;

describe("chat scope adapters", () => {
  it.each(cases)(
    "keeps the %s surface's table, scope, reaction, cache and route identity explicit",
    (kind, table, scopeColumn, reactionForeignKey, cachePrefix, route) => {
      const adapter = CHAT_SCOPE_ADAPTERS[kind];
      expect(adapter).toMatchObject({
        kind,
        messageTable: table,
        scopeColumn,
        reactionForeignKey,
        cachePrefix,
      });
      expect(adapter.route("scope-1")).toBe(route);
      expect(buildChatScopeFilter(adapter, "scope-1")).toEqual({ [scopeColumn]: "scope-1" });
      expect(getChatScopeAdapterByTable(table)).toBe(adapter);
    },
  );

  it("keeps broadcast global and queryable without inventing a scope id", () => {
    expect(BROADCAST_CHAT_SCOPE).toMatchObject({
      messageTable: "broadcast_messages",
      scopeColumn: null,
      reactionForeignKey: "broadcast_message_id",
      cachePrefix: "broadcast-messages",
    });
    expect(BROADCAST_CHAT_SCOPE.route()).toBe("/messages/broadcast");
    expect(buildChatScopeFilter(BROADCAST_CHAT_SCOPE)).toEqual({});
    expect(getChatScopeAdapterByTable("broadcast_messages")).toBe(BROADCAST_CHAT_SCOPE);
  });

  it.each(cases)("rejects a missing %s scope id", (kind) => {
    const adapter = CHAT_SCOPE_ADAPTERS[kind];
    expect(() => adapter.route()).toThrow(`${kind} chat requires a scope id`);
    expect(() => buildChatScopeFilter(adapter)).toThrow(`${kind} chat requires a scope id`);
  });

  it("defines exactly the six supported surfaces", () => {
    expect(Object.keys(CHAT_SCOPE_ADAPTERS)).toEqual([
      "team",
      "club",
      "group",
      "direct",
      "club_admin",
      "broadcast",
    ]);
  });

  it("keeps membership and participant authorization boundaries explicit", () => {
    expect(CHAT_SCOPE_ADAPTERS.team).toMatchObject({
      readBoundary: "team_membership",
      sendBoundary: "team_membership",
    });
    expect(CHAT_SCOPE_ADAPTERS.club).toMatchObject({
      readBoundary: "club_membership",
      sendBoundary: "club_membership",
    });
    expect(CHAT_SCOPE_ADAPTERS.group).toMatchObject({
      readBoundary: "group_membership",
      sendBoundary: "group_membership",
    });
    for (const kind of ["direct", "club_admin"] as const) {
      expect(CHAT_SCOPE_ADAPTERS[kind]).toMatchObject({
        readBoundary: "conversation_participant",
        sendBoundary: "conversation_participant",
      });
    }
    expect(CHAT_SCOPE_ADAPTERS.broadcast).toMatchObject({
      readBoundary: "authenticated",
      sendBoundary: "app_admin",
    });
  });

  it("preserves capability differences rather than flattening all chat surfaces", () => {
    expect(CHAT_SCOPE_ADAPTERS.team.capabilities).toEqual({
      attachments: "supported",
      vaultPicker: "supported",
      polls: "supported",
      scheduling: "supported",
      pinning: "supported",
      forwarding: "supported",
      galleryPublishing: "conditional",
      clubAnnouncements: "supported",
    });
    expect(CHAT_SCOPE_ADAPTERS.club.capabilities).toEqual({
      attachments: "supported",
      vaultPicker: "supported",
      polls: "supported",
      scheduling: "supported",
      pinning: "supported",
      forwarding: "supported",
      galleryPublishing: "unsupported",
      clubAnnouncements: "unsupported",
    });
    expect(CHAT_SCOPE_ADAPTERS.group.capabilities).toEqual({
      attachments: "supported",
      vaultPicker: "conditional",
      polls: "supported",
      scheduling: "supported",
      pinning: "supported",
      forwarding: "conditional",
      galleryPublishing: "conditional",
      clubAnnouncements: "unsupported",
    });
    expect(CHAT_SCOPE_ADAPTERS.direct.capabilities).toEqual({
      attachments: "conditional",
      vaultPicker: "conditional",
      polls: "unsupported",
      scheduling: "conditional",
      pinning: "conditional",
      forwarding: "conditional",
      galleryPublishing: "unsupported",
      clubAnnouncements: "unsupported",
    });
    expect(CHAT_SCOPE_ADAPTERS.club_admin.capabilities).toEqual({
      attachments: "supported",
      vaultPicker: "conditional",
      polls: "supported",
      scheduling: "supported",
      pinning: "unsupported",
      forwarding: "supported",
      galleryPublishing: "unsupported",
      clubAnnouncements: "unsupported",
    });
    expect(CHAT_SCOPE_ADAPTERS.broadcast.capabilities).toEqual({
      attachments: "supported",
      vaultPicker: "unsupported",
      polls: "supported",
      scheduling: "conditional",
      pinning: "unsupported",
      forwarding: "supported",
      galleryPublishing: "unsupported",
      clubAnnouncements: "unsupported",
    });
  });
});
