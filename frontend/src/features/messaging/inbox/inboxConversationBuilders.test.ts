import { describe, expect, it } from "vitest";
import {
  buildBroadcastInboxConversation,
  buildClubAdminInboxConversation,
  buildClubInboxConversation,
  buildDirectMessageInboxConversation,
  buildGroupInboxConversation,
  buildSupportInboxConversation,
  buildTeamInboxConversation,
} from "./inboxConversationBuilders";

const PREVIEW = {
  text: "Latest update",
  author: "Alex",
  created_at: "2026-08-04T10:00:00.000Z",
  image_url: null,
};

describe("messaging inbox conversation builders", () => {
  it("builds broadcast previews and preserves the no-message fallback", () => {
    expect(buildBroadcastInboxConversation({
      message: {
        text: "Club update",
        created_at: "2026-08-04T10:00:00.000Z",
        image_url: "notice.jpg",
        profiles: { display_name: "Admin" },
      },
      unreadCount: 2,
    })).toMatchObject({
      type: "broadcast",
      id: "broadcast",
      key: "broadcast",
      link: "/messages/broadcast",
      name: "Announcements",
      lastActivity: "2026-08-04T10:00:00.000Z",
      lastMessage: { text: "Club update", author: "Admin", image_url: "notice.jpg" },
      unreadCount: 2,
      isMuted: false,
    });

    expect(buildBroadcastInboxConversation({ message: null, unreadCount: 0 })).toMatchObject({
      lastActivity: "",
      lastMessage: undefined,
    });
  });

  it("preserves normalized club previews and only locks a definitive non-Pro club", () => {
    const club = { id: "club-1", name: "Riverside FC", logo_url: "club.png" };
    const pending = buildClubInboxConversation({
      club, lastMessage: PREVIEW, unreadCount: 3, isMuted: true,
      proStatusKnown: false, hasProAccess: true,
    });
    const locked = buildClubInboxConversation({
      club, lastMessage: PREVIEW, unreadCount: 3, isMuted: true,
      proStatusKnown: true, hasProAccess: false,
    });

    expect(pending).toMatchObject({
      key: "club-club-1", link: "/messages/club/club-1", name: "Riverside FC",
      avatarUrl: "club.png", lastMessage: PREVIEW, unreadCount: 3,
      isMuted: true, isLocked: false,
    });
    expect(pending.lastMessage).toBe(PREVIEW);
    expect(locked.isLocked).toBe(true);
  });

  it("uses the team logo before the club fallback logo", () => {
    expect(buildTeamInboxConversation({
      team: { id: "team-1", name: "Blue", logo_url: "team.png", clubs: { logo_url: "club.png" } },
      lastMessage: PREVIEW, unreadCount: 0, isMuted: false,
    }).avatarUrl).toBe("team.png");
    expect(buildTeamInboxConversation({
      team: { id: "team-2", name: "Red", logo_url: null, clubs: { logo_url: "club.png" } },
      lastMessage: undefined, unreadCount: 1, isMuted: true,
    })).toMatchObject({
      key: "team-team-2", avatarUrl: "club.png", lastActivity: "",
      lastMessage: undefined, unreadCount: 1, isMuted: true,
    });
  });

  it("keeps league and group identity distinct and applies only explicit locked routes", () => {
    const league = buildGroupInboxConversation({
      type: "league",
      group: { id: "league-1", name: "Mini League" },
      avatarUrl: null,
      lastMessage: PREVIEW,
      unreadCount: 4,
      isMuted: false,
    });
    const group = buildGroupInboxConversation({
      type: "group",
      group: { id: "group-1", name: "Coaches", category: "Operations" },
      lastMessage: PREVIEW,
      unreadCount: 0,
      isMuted: true,
      isLocked: true,
      lockedLink: "/clubs/club-1/upgrade",
      canHide: false,
    });

    expect(league).toMatchObject({
      key: "league-league-1", link: "/groups/league-1", lastMessage: PREVIEW,
    });
    expect(league).not.toHaveProperty("isLocked");
    expect(group).toMatchObject({
      key: "group-group-1", link: "/clubs/club-1/upgrade",
      category: "Operations", canHide: false, isLocked: true,
    });
    expect(group).not.toHaveProperty("avatarUrl");
  });

  it("preserves authorized club, group and league rows when preview enrichment is absent", () => {
    const club = buildClubInboxConversation({
      club: { id: "club-empty", name: "Club without preview" },
      lastMessage: undefined,
      unreadCount: 0,
      isMuted: false,
      proStatusKnown: false,
      hasProAccess: true,
    });
    const group = buildGroupInboxConversation({
      type: "group",
      group: { id: "group-empty", name: "Group without preview" },
      lastMessage: undefined,
      unreadCount: 0,
      isMuted: false,
    });
    const league = buildGroupInboxConversation({
      type: "league",
      group: { id: "league-empty", name: "League without preview" },
      lastMessage: undefined,
      unreadCount: 0,
      isMuted: false,
    });

    expect([club, group, league].map((row) => ({
      key: row.key,
      lastActivity: row.lastActivity,
      lastMessage: row.lastMessage,
    }))).toEqual([
      { key: "club-club-empty", lastActivity: "", lastMessage: undefined },
      { key: "group-group-empty", lastActivity: "", lastMessage: undefined },
      { key: "league-league-empty", lastActivity: "", lastMessage: undefined },
    ]);
  });

  it("normalizes DM identity, support naming, author and missing-profile fallbacks", () => {
    const sent = {
      id: "dm-1",
      updated_at: "2026-08-04T09:00:00.000Z",
      other_user: { id: "other", display_name: "Jordan", avatar_url: "jordan.png" },
      last_message: {
        text: "Hello", created_at: "2026-08-04T10:00:00.000Z",
        author_id: "me", image_url: null,
      },
    };
    const mine = buildDirectMessageInboxConversation({
      conversation: sent, currentUserId: "me", unreadCount: 5, isSupport: false,
    });
    expect(mine).toMatchObject({
      key: "dm-dm-1", name: "Jordan", lastActivity: "2026-08-04T10:00:00.000Z",
      lastMessage: { author: "You" }, unreadCount: 5, canHide: true,
    });
    expect(mine.dmData).toBe(sent);

    expect(buildDirectMessageInboxConversation({
      conversation: { id: "dm-2", updated_at: "2026-08-03T00:00:00.000Z", other_user: null },
      currentUserId: "me", unreadCount: 0, isSupport: true,
    })).toMatchObject({
      name: "Ignite Support", lastActivity: "2026-08-03T00:00:00.000Z",
      lastMessage: undefined, canHide: false,
    });
  });

  it("normalizes club-admin author and empty-text/image previews", () => {
    const base = {
      id: "admin-1",
      updated_at: "2026-08-03T00:00:00.000Z",
      member_name: "Taylor",
      member_avatar: null,
      last_text: null,
      last_image: "photo.jpg",
      last_created_at: "2026-08-04T10:00:00.000Z",
      last_author_id: "me",
    };
    expect(buildClubAdminInboxConversation({ conversation: base, currentUserId: "me" })).toMatchObject({
      key: "admin-group-admin-1", name: "Taylor", category: "Admin Groups",
      lastMessage: { text: "", author: "You", image_url: "photo.jpg" },
      unreadCount: 0, isMuted: false,
    });
    expect(buildClubAdminInboxConversation({
      conversation: { ...base, last_created_at: null }, currentUserId: "me",
    })).toMatchObject({
      lastActivity: "2026-08-03T00:00:00.000Z", lastMessage: undefined,
    });
  });

  it("preserves the existing support preview truncation contract", () => {
    const sixty = "x".repeat(60);
    expect(buildSupportInboxConversation({
      text: `${sixty}ignored`, created_at: "2026-08-04T10:00:00.000Z",
    })).toMatchObject({
      id: "ignite-support", key: "ignite-support", link: "/messages/welcome",
      name: "Ignite Support", lastMessage: { text: `${sixty}...`, author: "" },
      unreadCount: 0, isMuted: false,
    });
  });
});
