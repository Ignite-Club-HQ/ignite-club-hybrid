import { describe, expect, it } from "vitest";
import {
  attachInboxDrafts,
  deriveActiveMutedChats,
  filterInboxConversations,
  inboxConversationIdentity,
  isHiddenConversationVisible,
  normalizeInboxTypeFilter,
  partitionInboxByReadState,
  resolveClubProEntitlement,
  resolveGroupUnreadCount,
  resolveOperationalConversationDisclosure,
  type InboxConversation,
  type InboxConversationType,
} from "./inboxReadModel";

const NOW = Date.parse("2026-08-04T12:00:00.000Z");

function conversation(
  key: string,
  type: InboxConversationType,
  overrides: Partial<InboxConversation> = {},
): InboxConversation {
  return {
    type,
    id: key,
    key,
    name: key,
    link: `/messages/${key}`,
    lastActivity: "2026-08-04T10:00:00.000Z",
    unreadCount: 0,
    isMuted: false,
    ...overrides,
  };
}

describe("messaging inbox read model", () => {
  it("builds stable identity and routes for every inbox conversation scope", () => {
    expect(inboxConversationIdentity("broadcast", "ignored")).toEqual({
      id: "broadcast", key: "broadcast", link: "/messages/broadcast",
    });
    expect(inboxConversationIdentity("support", "ignored")).toEqual({
      id: "ignite-support", key: "ignite-support", link: "/messages/welcome",
    });
    expect(inboxConversationIdentity("club", "c1")).toEqual({
      id: "c1", key: "club-c1", link: "/messages/club/c1",
    });
    expect(inboxConversationIdentity("team", "t1")).toEqual({
      id: "t1", key: "team-t1", link: "/messages/t1",
    });
    expect(inboxConversationIdentity("group", "g1")).toEqual({
      id: "g1", key: "group-g1", link: "/groups/g1",
    });
    expect(inboxConversationIdentity("league", "l1")).toEqual({
      id: "l1", key: "league-l1", link: "/groups/l1",
    });
    expect(inboxConversationIdentity("dm", "d1")).toEqual({
      id: "d1", key: "dm-d1", link: "/messages/dm/d1",
    });
    expect(inboxConversationIdentity("admin_group", "a1")).toEqual({
      id: "a1", key: "admin-group-a1", link: "/messages/club-admin/a1",
    });
  });

  it("prefers the realtime group unread count, including an explicit zero", () => {
    expect(resolveGroupUnreadCount(0, 4)).toBe(0);
    expect(resolveGroupUnreadCount(3, 4)).toBe(3);
    expect(resolveGroupUnreadCount(undefined, 4)).toBe(4);
    expect(resolveGroupUnreadCount(undefined, undefined)).toBe(0);
  });

  it("treats club Pro access as available until the entitlement result is definitive", () => {
    expect(resolveClubProEntitlement({
      clubId: "club-1", statuses: undefined, isLoading: false, isFetching: false,
    })).toEqual({ known: false, hasAccess: true });
    expect(resolveClubProEntitlement({
      clubId: "club-1", statuses: { "club-1": false }, isLoading: true, isFetching: false,
    })).toEqual({ known: false, hasAccess: true });
    expect(resolveClubProEntitlement({
      clubId: "club-1", statuses: { "club-1": false }, isLoading: false, isFetching: true,
    })).toEqual({ known: false, hasAccess: true });
    expect(resolveClubProEntitlement({
      clubId: "club-1", statuses: { "club-1": false }, isLoading: false, isFetching: false,
    })).toEqual({ known: true, hasAccess: false });
    expect(resolveClubProEntitlement({
      clubId: "club-1", statuses: {}, isLoading: false, isFetching: false,
    })).toEqual({ known: true, hasAccess: false });
    expect(resolveClubProEntitlement({
      clubId: "club-1", statuses: { "club-1": true }, isLoading: false, isFetching: false,
    })).toEqual({ known: true, hasAccess: true });
  });

  it("attaches drafts and only bumps activity for a strictly newer valid timestamp", () => {
    const rows = [
      conversation("newer-draft", "team", { lastActivity: "2026-08-04T10:00:00.000Z" }),
      conversation("equal-draft", "group", { lastActivity: "2026-08-04T10:00:00.000Z" }),
      conversation("no-activity", "dm", { lastActivity: "" }),
      conversation("no-draft", "club"),
    ];

    const result = attachInboxDrafts(rows, {
      "newer-draft": { text: "new", updatedAt: "2026-08-04T10:00:00.001Z" },
      "equal-draft": { text: "equal", updatedAt: "2026-08-04T10:00:00.000Z" },
      "no-activity": { text: "unsent", updatedAt: "2026-08-03T10:00:00.000Z" },
    });

    expect(result[0]).toMatchObject({ draftText: "new", lastActivity: "2026-08-04T10:00:00.001Z" });
    expect(result[1]).toMatchObject({ draftText: "equal", lastActivity: "2026-08-04T10:00:00.000Z" });
    expect(result[2]).toMatchObject({ draftText: "unsent", lastActivity: "2026-08-03T10:00:00.000Z" });
    expect(result[3]).toBe(rows[3]);
    expect(rows[0].draftText).toBeUndefined();
  });

  it("preserves activity when a draft timestamp cannot be compared", () => {
    const row = conversation("invalid-draft-time", "team", {
      lastActivity: "2026-08-04T10:00:00.000Z",
    });

    expect(attachInboxDrafts([row], {
      "invalid-draft-time": { text: "draft", updatedAt: "not-a-date" },
    })[0]).toMatchObject({
      draftText: "draft",
      lastActivity: "2026-08-04T10:00:00.000Z",
    });
  });

  it("keeps indefinite and future mute preferences active by their exact scope", () => {
    const muted = deriveActiveMutedChats([
      { chat_id: "team-forever", chat_type: "team", muted_until: null },
      { chat_id: "club-future", chat_type: "club", muted_until: "2026-08-04T12:00:01.000Z" },
      { chat_id: "group-future", chat_type: "group", muted_until: "2026-08-05T00:00:00.000Z" },
    ], NOW);

    expect([...muted.teams]).toEqual(["team-forever"]);
    expect([...muted.clubs]).toEqual(["club-future"]);
    expect([...muted.groups]).toEqual(["group-future"]);
  });

  it("excludes expired, boundary-time, invalid and unsupported mute preferences", () => {
    const muted = deriveActiveMutedChats([
      { chat_id: "expired", chat_type: "team", muted_until: "2026-08-04T11:59:59.999Z" },
      { chat_id: "at-now", chat_type: "club", muted_until: "2026-08-04T12:00:00.000Z" },
      { chat_id: "invalid", chat_type: "group", muted_until: "not-a-date" },
      { chat_id: "dm", chat_type: "dm", muted_until: null },
    ], NOW);

    expect([...muted.teams]).toEqual([]);
    expect([...muted.clubs]).toEqual([]);
    expect([...muted.groups]).toEqual([]);
  });

  it("keeps a hidden conversation absent until a strictly newer message arrives", () => {
    const hiddenAt = "2026-08-04T10:00:00.000Z";

    expect(isHiddenConversationVisible({ hiddenAt, lastMessageAt: undefined, hasSearchQuery: false })).toBe(false);
    expect(isHiddenConversationVisible({ hiddenAt, lastMessageAt: hiddenAt, hasSearchQuery: false })).toBe(false);
    expect(isHiddenConversationVisible({
      hiddenAt,
      lastMessageAt: "2026-08-04T10:00:00.001Z",
      hasSearchQuery: false,
    })).toBe(true);
  });

  it("reveals hidden conversations during search without changing persisted hidden state", () => {
    expect(isHiddenConversationVisible({
      hiddenAt: "2026-08-04T10:00:00.000Z",
      lastMessageAt: "2026-08-03T10:00:00.000Z",
      hasSearchQuery: true,
    })).toBe(true);
    expect(isHiddenConversationVisible({
      hiddenAt: undefined,
      lastMessageAt: undefined,
      hasSearchQuery: false,
    })).toBe(true);
  });

  it("preserves visibility when stored hidden timestamps cannot be compared", () => {
    expect(isHiddenConversationVisible({
      hiddenAt: "not-a-date",
      lastMessageAt: "2026-08-04T10:00:00.000Z",
      hasSearchQuery: false,
    })).toBe(true);
    expect(isHiddenConversationVisible({
      hiddenAt: "2026-08-04T10:00:00.000Z",
      lastMessageAt: "not-a-date",
      hasSearchQuery: false,
    })).toBe(true);
  });

  it("normalizes legacy and invalid persisted filter values", () => {
    expect(normalizeInboxTypeFilter("club")).toBe("groups");
    expect(normalizeInboxTypeFilter("league")).toBe("groups");
    expect(normalizeInboxTypeFilter("teams")).toBe("teams");
    expect(normalizeInboxTypeFilter("unexpected")).toBe("all");
  });

  it("maps each conversation type to the existing user-facing filter buckets", () => {
    const rows = [
      conversation("team", "team"),
      conversation("league", "league"),
      conversation("group", "group"),
      conversation("club", "club"),
      conversation("admin", "admin_group"),
      conversation("dm", "dm"),
      conversation("broadcast", "broadcast"),
      conversation("support", "support"),
    ];

    expect(filterInboxConversations(rows, "teams").map((row) => row.key)).toEqual([
      "team", "league", "support",
    ]);
    expect(filterInboxConversations(rows, "groups").map((row) => row.key)).toEqual([
      "group", "club", "admin", "support",
    ]);
    expect(filterInboxConversations(rows, "dms").map((row) => row.key)).toEqual([
      "dm", "support",
    ]);
  });

  it("partitions unread and recent rows and orders each newest-first without mutating input", () => {
    const rows = [
      conversation("recent-old", "team", { lastActivity: "2026-08-01T10:00:00.000Z" }),
      conversation("unread-new", "club", { unreadCount: 2, lastActivity: "2026-08-04T11:00:00.000Z" }),
      conversation("recent-new", "dm", { lastActivity: "2026-08-03T10:00:00.000Z" }),
      conversation("unread-no-date", "group", { unreadCount: 1, lastActivity: "" }),
    ];
    const originalOrder = rows.map((row) => row.key);

    const result = partitionInboxByReadState(rows);

    expect(result.unread.map((row) => row.key)).toEqual(["unread-new", "unread-no-date"]);
    expect(result.recent.map((row) => row.key)).toEqual(["recent-new", "recent-old"]);
    expect(rows.map((row) => row.key)).toEqual(originalOrder);
  });

  it("collapses only the stale operational long tail and keeps the first two visible", () => {
    const staleGroups = Array.from({ length: 7 }, (_, index) =>
      conversation(`stale-${index}`, index % 2 ? "league" : "group", {
        lastActivity: "2026-06-01T00:00:00.000Z",
      }),
    );
    const ordinary = conversation("ordinary-dm", "dm", { lastActivity: "2026-05-01T00:00:00.000Z" });
    const recent = conversation("recent-group", "group", { lastActivity: "2026-08-03T00:00:00.000Z" });
    const draft = conversation("draft-group", "group", {
      lastActivity: "2026-05-01T00:00:00.000Z",
      draftText: "unsent",
    });

    const result = resolveOperationalConversationDisclosure(
      [...staleGroups, ordinary, recent, draft],
      { now: NOW, showAll: false, typeFilter: "all", hasSearchQuery: false },
    );

    expect(result.hiddenOps.map((row) => row.key)).toEqual([
      "stale-2", "stale-3", "stale-4", "stale-5", "stale-6",
    ]);
    expect(result.visibleRecent.map((row) => row.key)).toEqual([
      "stale-0", "stale-1", "ordinary-dm", "recent-group", "draft-group",
    ]);
  });

  it("does not collapse at the threshold or while disclosure is explicitly requested", () => {
    const stale = Array.from({ length: 7 }, (_, index) =>
      conversation(`stale-${index}`, "group", { lastActivity: "" }),
    );
    const six = stale.slice(0, 6);

    expect(resolveOperationalConversationDisclosure(six, {
      now: NOW, showAll: false, typeFilter: "all", hasSearchQuery: false,
    }).hiddenOps).toEqual([]);
    expect(resolveOperationalConversationDisclosure(stale, {
      now: NOW, showAll: true, typeFilter: "all", hasSearchQuery: false,
    }).hiddenOps).toEqual([]);
    expect(resolveOperationalConversationDisclosure(stale, {
      now: NOW, showAll: false, typeFilter: "groups", hasSearchQuery: false,
    }).hiddenOps).toEqual([]);
    expect(resolveOperationalConversationDisclosure(stale, {
      now: NOW, showAll: false, typeFilter: "all", hasSearchQuery: true,
    }).hiddenOps).toEqual([]);
  });
});
