import { describe, expect, it } from "vitest";
import { buildUnifiedInboxConversations } from "./inboxUnifiedComposition";

const base = {
  showBroadcast: true,
  latestBroadcast: null,
  clubs: [{ id: "club", name: "Club" }],
  teams: [{ id: "team", name: "Team" }],
  leagueChats: [{ id: "league", name: "League" }],
  chatGroups: [{ id: "group", name: "Group" }],
  directMessages: [{ id: "dm", other_user: { id: "peer", display_name: "Peer" }, last_message: { text: "Hi", created_at: "2026-08-01", author_id: "peer" } }],
  adminConversations: [{ id: "admin", updated_at: "2026-08-01", member_name: "Member", club_name: "Club" }],
  unreadCounts: { broadcast: 1, clubs: { club: 2 }, teams: { team: 3 }, groups: { league: 4, group: 5 }, dms: { dm: 6 } },
  realtimeGroupUnread: {},
  muted: { clubs: new Set<string>(), teams: new Set<string>(), groups: new Set<string>() },
  clubProStatuses: { club: true },
  isClubProLoading: false,
  isClubProFetching: false,
  isAppAdmin: false,
  query: "",
  currentUserId: "me",
  showSupport: false,
  systemMessage: null,
  drafts: {},
  isSupportUser: (id?: string | null) => id === "support",
};

describe("buildUnifiedInboxConversations", () => {
  it("preserves the explicit cross-surface row order and unread counts", () => {
    const rows = buildUnifiedInboxConversations(base);
    expect(rows.map((row) => [row.type, row.id, row.unreadCount])).toEqual([
      ["broadcast", "broadcast", 1], ["club", "club", 2], ["team", "team", 3],
      ["league", "league", 4], ["group", "group", 5], ["dm", "dm", 6],
      ["admin_group", "admin", 0],
    ]);
  });

  it("prefers realtime group unread counts and preserves mute scopes", () => {
    const rows = buildUnifiedInboxConversations({
      ...base,
      realtimeGroupUnread: { group: 9 },
      muted: { clubs: new Set(["club"]), teams: new Set(["team"]), groups: new Set(["group"]) },
    });
    expect(rows.find((row) => row.key === "group-group")).toMatchObject({ unreadCount: 9, isMuted: true });
    expect(rows.find((row) => row.key === "club-club")?.isMuted).toBe(true);
    expect(rows.find((row) => row.key === "team-team")?.isMuted).toBe(true);
  });

  it("locks a definitive non-Pro club-role group but not a personal group or app admin", () => {
    const roleGroup = { id: "role", name: "Coaches", club_id: "club", allowed_roles: ["coach"] };
    const personal = { id: "personal", name: "Friends" };
    const locked = buildUnifiedInboxConversations({ ...base, chatGroups: [roleGroup, personal], clubProStatuses: { club: false } });
    expect(locked.find((row) => row.id === "role")).toMatchObject({ isLocked: true, link: "/clubs/club/upgrade", canHide: false });
    expect(locked.find((row) => row.id === "personal")).toMatchObject({ isLocked: false, canHide: true });
    const admin = buildUnifiedInboxConversations({ ...base, chatGroups: [roleGroup], clubProStatuses: { club: false }, isAppAdmin: true });
    expect(admin.find((row) => row.id === "role")?.isLocked).toBe(false);
  });

  it("filters club-admin rows by member, club or preview text", () => {
    const conversations = [
      { id: "member", updated_at: "1", member_name: "Alex", club_name: "North", last_text: "Hello" },
      { id: "club", updated_at: "1", member_name: "Blake", club_name: "Riverside", last_text: "Update" },
      { id: "text", updated_at: "1", member_name: "Casey", club_name: "South", last_text: "Grounds closed" },
    ];
    for (const [query, id] of [["alex", "member"], ["river", "club"], ["grounds", "text"]]) {
      const rows = buildUnifiedInboxConversations({ ...base, showBroadcast: false, clubs: [], teams: [], leagueChats: [], chatGroups: [], directMessages: [], adminConversations: conversations, query });
      expect(rows.map((row) => row.id)).toEqual([id]);
    }
  });

  it("does not duplicate Ignite Support when its DM already exists", () => {
    const systemMessage = { text: "Welcome", created_at: "2026-08-01" };
    const withoutDm = buildUnifiedInboxConversations({ ...base, showBroadcast: false, clubs: [], teams: [], leagueChats: [], chatGroups: [], directMessages: [], adminConversations: [], showSupport: true, systemMessage });
    expect(withoutDm.map((row) => row.type)).toEqual(["support"]);
    const withDm = buildUnifiedInboxConversations({ ...base, showBroadcast: false, clubs: [], teams: [], leagueChats: [], chatGroups: [], directMessages: [{ id: "support-dm", other_user: { id: "support", display_name: "System" } }], adminConversations: [], showSupport: true, systemMessage });
    expect(withDm.map((row) => row.type)).toEqual(["dm"]);
    expect(withDm[0].name).toBe("Ignite Support");
  });

  it("attaches drafts after every scope has been composed", () => {
    const rows = buildUnifiedInboxConversations({ ...base, drafts: { team: { text: "Unsent", updatedAt: "2099-01-01" } } });
    expect(rows.find((row) => row.id === "team")).toMatchObject({ draftText: "Unsent", lastActivity: "2099-01-01" });
  });

  it("normalizes realtime preview records before they reach inbox rendering", () => {
    const rows = buildUnifiedInboxConversations({
      ...base,
      showBroadcast: false,
      teams: [],
      leagueChats: [],
      chatGroups: [],
      directMessages: [],
      adminConversations: [],
      latestClubMessages: {
        club: { text: "Latest update", created_at: "2026-09-19", image_url: "preview.jpg" },
      },
    });

    expect(rows[0]?.lastMessage).toEqual({
      text: "Latest update",
      author: "",
      created_at: "2026-09-19",
      image_url: "preview.jpg",
    });
  });
});
