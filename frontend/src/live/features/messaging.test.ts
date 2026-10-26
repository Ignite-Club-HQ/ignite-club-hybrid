import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get_mini_league_chat: vi.fn(),
  can_dm_user: vi.fn(),
  dm_attachments_disabled: vi.fn(),
  get_group_metadata: vi.fn(),
  my_unread_counts: vi.fn(),
  send_message: vi.fn(),
  submit_content_report: vi.fn(),
  read_conversation_club: vi.fn(),
  get_direct_conversation: vi.fn(),
  get_message_window: vi.fn(),
  list_conversation_online_users: vi.fn(),
  list_broadcast_message_readers: vi.fn(),
}));

vi.mock("../domains", () => ({
  connectLiveMessagingDomain: vi.fn(async () => ({
    actor: {
      get_mini_league_chat: mocks.get_mini_league_chat,
      can_dm_user: mocks.can_dm_user,
      dm_attachments_disabled: mocks.dm_attachments_disabled,
      get_group_metadata: mocks.get_group_metadata,
      my_unread_counts: mocks.my_unread_counts,
      send_message: mocks.send_message,
      submit_content_report: mocks.submit_content_report,
      read_conversation_club: mocks.read_conversation_club,
      get_direct_conversation: mocks.get_direct_conversation,
      get_message_window: mocks.get_message_window,
      list_conversation_online_users: mocks.list_conversation_online_users,
      list_broadcast_message_readers: mocks.list_broadcast_message_readers,
    },
  })),
}));

import {
  getLiveMiniLeagueChat,
  canLiveDmUser,
  isLiveDmAttachmentsDisabled,
  getLiveGroupMetadata,
  myLiveUnreadCounts,
  sendLiveMessage,
  submitLiveContentReport,
  isLiveConversationAbsent,
  getLiveDirectConversation,
  getLiveMessageWindow,
  listLiveConversationOnlineUsers,
  listLiveBroadcastMessageReaders,
} from "./messaging";

const ctx = { target: {}, identity: {} } as never;
const other = { toText: () => "aaaaa-aa" } as never;
describe("exact private messaging reads", () => {
  it('reads the exact displayed broadcast messages with bounded selectors and no client ordering inference', async () => {
    const identity = { getPrincipal: () => ({ toText: () => 'viewer' }) };
    const owner = { target: {}, identity } as never;
    mocks.list_broadcast_message_readers.mockResolvedValue({ Ok: [{ conversation_id: 'broadcast', message_id: 'older', user: other, read: true }] });
    expect(await listLiveBroadcastMessageReaders(owner, ['older', 'older'])).toEqual([{ conversationId: 'broadcast', messageId: 'older', user: other, read: true }]);
    expect(mocks.list_broadcast_message_readers).toHaveBeenLastCalledWith(['older']);
    await expect(listLiveBroadcastMessageReaders(owner, Array.from({ length: 101 }, (_, i) => String(i)))).rejects.toThrow('bounded');
  });
  it('refuses wrong-message reader responses and held account drift', async () => {
    const identity = { getPrincipal: () => ({ toText: () => 'viewer' }) };
    const owner = { target: {}, identity };
    mocks.list_broadcast_message_readers.mockResolvedValueOnce({ Ok: [{ conversation_id: 'broadcast', message_id: 'foreign', user: other, read: true }] });
    await expect(listLiveBroadcastMessageReaders(owner as never, ['older'])).rejects.toThrow('mismatch');
    mocks.list_broadcast_message_readers.mockImplementationOnce(async () => { owner.identity = { ...identity }; return { Ok: [] }; });
    await expect(listLiveBroadcastMessageReaders(owner as never, ['older'])).rejects.toThrow('account changed');
  });
  it("reads empty DM participants with the exact caller identity", async () => {
    const self = { toText: () => "self" };
    const peer = { toText: () => "peer" };
    mocks.get_direct_conversation.mockResolvedValue({ Ok: { id: "dm-1", participants: [self, peer] } });
    const context = { identity: { getPrincipal: () => self }, target: {} } as never;
    expect(await getLiveDirectConversation(context, "dm-1")).toEqual({ id: "dm-1", participant_1: "self", participant_2: "peer" });
    mocks.get_direct_conversation.mockResolvedValue({ Ok: { id: "dm-1", participants: [peer, peer] } });
    await expect(getLiveDirectConversation(context, "dm-1")).rejects.toThrow("identity mismatch");
  });
  it("rejects a message window from a different conversation", async () => {
    mocks.get_message_window.mockResolvedValue({ Ok: { messages: [{ id: "target", conversation_id: "foreign" }] } });
    await expect(getLiveMessageWindow(ctx, "group-1", "target")).rejects.toThrow("identity mismatch");
    mocks.get_message_window.mockResolvedValue({ Ok: { messages: [{ id: "target", conversation_id: "group-1" }] } });
    expect((await getLiveMessageWindow(ctx, "group-1", "target")).messages).toHaveLength(1);
  });
  it("uses only the authorized conversation presence API and preserves refusals", async () => {
    mocks.list_conversation_online_users.mockResolvedValue({ Ok: [other] });
    expect(await listLiveConversationOnlineUsers(ctx, "group-1")).toEqual(["aaaaa-aa"]);
    expect(mocks.list_conversation_online_users).toHaveBeenCalledWith("group-1");
    mocks.list_conversation_online_users.mockResolvedValue({ Err: "Conversation access forbidden" });
    await expect(listLiveConversationOnlineUsers(ctx, "group-1")).rejects.toThrow("access forbidden");
  });
});

describe('conversation absence evidence', () => {
  it('accepts only a successful empty owner option', async () => {
    mocks.read_conversation_club.mockResolvedValueOnce({ Ok: [] });
    expect(await isLiveConversationAbsent(ctx, 'missing-team')).toBe(true);
    expect(mocks.read_conversation_club).toHaveBeenCalledWith('missing-team');
    mocks.read_conversation_club.mockResolvedValueOnce({ Ok: ['club-a'] });
    expect(await isLiveConversationAbsent(ctx, 'existing-team')).toBe(false);
  });
  it('preserves forbidden and transport failures', async () => {
    mocks.read_conversation_club.mockResolvedValueOnce({ Err: 'Forbidden' });
    await expect(isLiveConversationAbsent(ctx, 'private')).rejects.toThrow('Forbidden');
    mocks.read_conversation_club.mockRejectedValueOnce(new Error('Remote call failed'));
    await expect(isLiveConversationAbsent(ctx, 'unknown')).rejects.toThrow('Remote call failed');
  });
});

describe("canLiveDmUser", () => {
  it("passes through the canister boolean unchanged", async () => {
    mocks.can_dm_user.mockResolvedValueOnce(false);
    await expect(canLiveDmUser(ctx, other)).resolves.toBe(false);
    expect(mocks.can_dm_user).toHaveBeenCalledWith(other);
  });

  it("propagates a rejection so DirectMessagePage's catch can fail open", async () => {
    // DirectMessagePage wraps this call in try/catch and returns `true`
    // (same as the Supabase RPC-error branch) when it rejects — this wrapper
    // itself must not swallow the error, or that fail-open path would never
    // trigger.
    mocks.can_dm_user.mockRejectedValueOnce(new Error("agent unreachable"));
    await expect(canLiveDmUser(ctx, other)).rejects.toThrow("agent unreachable");
  });
});

describe("isLiveDmAttachmentsDisabled", () => {
  it("passes through the canister boolean unchanged", async () => {
    mocks.dm_attachments_disabled.mockResolvedValueOnce(true);
    await expect(isLiveDmAttachmentsDisabled(ctx, other)).resolves.toBe(true);
    expect(mocks.dm_attachments_disabled).toHaveBeenCalledWith(other);
  });

  it("propagates a rejection so callers' catch-and-default(false) still runs", async () => {
    mocks.dm_attachments_disabled.mockRejectedValueOnce(new Error("boom"));
    await expect(isLiveDmAttachmentsDisabled(ctx, other)).rejects.toThrow("boom");
  });
});

describe("getLiveGroupMetadata", () => {
  it("maps optional candid fields to null", async () => {
    mocks.get_group_metadata.mockResolvedValueOnce({
      Ok: {
        conversation_id: "conv-1",
        kind: "team",
        name: "U12s",
        team_id: ["team-1"],
        club_id: [],
        members: [other],
        created_at_ms: 1_000n,
      },
    });
    const result = await getLiveGroupMetadata(ctx, "conv-1");
    expect(result).toEqual({
      conversationId: "conv-1",
      kind: "team",
      name: "U12s",
      teamId: "team-1",
      clubId: null,
      members: [other],
      createdAtMs: 1000,
      description: null,
      avatar: null,
      adminOnlyPosting: false,
    });
  });

  it("rejects when the conversation has no canister row yet (caller falls back to null)", async () => {
    // GroupChatPage wraps this call in try/catch and returns `null` on
    // rejection ("not yet created on the canister"); this wrapper must keep
    // surfacing the Err as a rejection rather than swallowing it itself.
    mocks.get_group_metadata.mockResolvedValueOnce({ Err: "not_found" });
    await expect(getLiveGroupMetadata(ctx, "missing")).rejects.toThrow(
      "Get group metadata failed: not_found",
    );
  });
});

describe("myLiveUnreadCounts", () => {
  it("maps conversation kinds and coerces bigint counts to numbers", async () => {
    mocks.my_unread_counts.mockResolvedValueOnce([
      { conversation_id: "dm-1", kind: "dm", count: 2n },
      { conversation_id: "team-1", kind: "team", count: 0n },
    ]);
    const result = await myLiveUnreadCounts(ctx);
    expect(result).toEqual([
      { conversationId: "dm-1", kind: "dm", count: 2 },
      { conversationId: "team-1", kind: "team", count: 0 },
    ]);
  });

  it("returns an empty list when the caller has no unread conversations", async () => {
    mocks.my_unread_counts.mockResolvedValueOnce([]);
    await expect(myLiveUnreadCounts(ctx)).resolves.toEqual([]);
  });
});

describe("sendLiveMessage image attachment", () => {
  it("sends the blob URL as an image attachment for team and competition chat readers", async () => {
    mocks.send_message.mockResolvedValueOnce({ Ok: { id: "message-1" } });
    await sendLiveMessage(ctx, "conversation-1", "Match photo", "message-key", {
      kind: "image",
      refId: "clubs/club-1/teams/team-1/chat/photo.jpg",
      url: "https://blob.example/photo.jpg",
    });

    expect(mocks.send_message).toHaveBeenCalledWith(
      "conversation-1",
      "Match photo",
      "message-key",
      [{
        kind: "image",
        ref_id: "clubs/club-1/teams/team-1/chat/photo.jpg",
        url: ["https://blob.example/photo.jpg"],
      }],
      [],
    );
  });
});

describe("submitLiveContentReport", () => {
  it("submits a report and maps the response", async () => {
    const reportDate = 1700000000000n;
    mocks.submit_content_report.mockResolvedValueOnce({
      Ok: {
        id: "report-1",
        reporter: other,
        subject_kind: "message",
        subject_id: "msg-123",
        conversation_id: ["conv-456"],
        reason: "Spam",
        details: ["extra info"],
        created_at_ms: reportDate,
        status: "pending",
      },
    });

    const result = await submitLiveContentReport(
      ctx,
      "message",
      "msg-123",
      "conv-456",
      "Spam",
      "extra info"
    );

    expect(result).toEqual({
      id: "report-1",
      reporter: "aaaaa-aa",
      subject_kind: "message",
      subject_id: "msg-123",
      conversation_id: "conv-456",
      reason: "Spam",
      details: "extra info",
      created_at_ms: Number(reportDate),
      status: "pending",
    });
    expect(mocks.submit_content_report).toHaveBeenCalledWith(
      "message",
      "msg-123",
      ["conv-456"],
      "Spam",
      ["extra info"]
    );
  });
});

describe('private league chat lookup', () => {
  it('unwraps the authorized conversation instead of returning a fabricated missing chat', async () => {
    mocks.get_mini_league_chat.mockResolvedValue({ Ok: [{ conversation_id: 'chat-a' }] });
    expect(await getLiveMiniLeagueChat(ctx, 'club-a', 'league-a')).toEqual({ id: 'chat-a' });
  });
  it('preserves denial from the private chat lookup', async () => {
    mocks.get_mini_league_chat.mockResolvedValue({ Err: 'Forbidden' });
    await expect(getLiveMiniLeagueChat(ctx, 'club-a', 'league-a')).rejects.toThrow('Forbidden');
  });
});
