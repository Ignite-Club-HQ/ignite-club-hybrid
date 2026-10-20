import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get_mini_league_chat: vi.fn(),
  can_dm_user: vi.fn(),
  dm_attachments_disabled: vi.fn(),
  get_group_metadata: vi.fn(),
  my_unread_counts: vi.fn(),
  send_message: vi.fn(),
  submit_content_report: vi.fn(),
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
} from "./messaging";

const ctx = { target: {}, identity: {} } as never;
const other = { toText: () => "aaaaa-aa" } as never;

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
