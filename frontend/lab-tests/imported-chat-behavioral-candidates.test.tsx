import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VirtualizedChatMessageListHandle } from "../src/components/chat/VirtualizedChatMessageList";
import {
  CHAT_SCOPE_ADAPTERS,
  buildChatScopeFilter,
} from "../src/features/messaging/scopes/chatScopeAdapters";
import { extractChatQueryMessages } from "../src/features/messaging/thread/chatThreadQueryData";
import { useChatComposerController } from "../src/hooks/useChatComposerController";
import {
  buildChatMessageEdit,
} from "../src/lib/chatComposerEdit";
import {
  _resetReconciliationRegistry,
  recordRealtimeMutation,
  reconcileMessages,
} from "../src/lib/chatMessageReconciliation";
import {
  recordRealtimeReaction,
  recordRealtimeReactionDelete,
} from "../src/lib/chatReactionReconciliation";
import { jumpToMessageInVirtualizedChat } from "../src/lib/jumpToMessage";
import {
  clearPendingChatJumpState,
  consumePendingChatJump,
  getJumpTarget,
  getLastConsumedPendingChatJumpTs,
  setPendingChatJump,
  subscribePendingChatJump,
  withChatJumpNonce,
} from "../src/lib/pendingChatJump";
import {
  buildChatScheduleTarget,
  resetChatComposerAfterSchedule,
} from "../src/lib/chatScheduleIntent";
import {
  getQueuedMessagesForTarget,
  queueMessage,
} from "../src/lib/messageQueue";
import { orderChatMessagesChronologically } from "../src/lab/chatMessageOrdering";

const CHAT_SURFACES = [
  {
    kind: "team",
    scopeId: "team-fixture",
    route: "/messages/team-fixture",
    queueType: "team",
  },
  {
    kind: "club",
    scopeId: "club-fixture",
    route: "/messages/club/club-fixture",
    queueType: "club",
  },
  {
    kind: "group",
    scopeId: "group-fixture",
    route: "/groups/group-fixture",
    queueType: "group",
  },
  {
    kind: "direct",
    scopeId: "direct-fixture",
    route: "/messages/dm/direct-fixture",
    queueType: "dm",
  },
  {
    kind: "club_admin",
    scopeId: "club-admin-fixture",
    route: "/messages/club-admin/club-admin-fixture",
    queueType: "club_admin",
  },
  {
    kind: "broadcast",
    scopeId: null,
    route: "/messages/broadcast",
    queueType: "broadcast",
  },
] as const;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearPendingChatJumpState();
  _resetReconciliationRegistry();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("src/test/chatPageOrchestration.characterization.test.ts", () => {
  it.each(CHAT_SURFACES)(
    "keeps $kind history ordering, scope isolation, and offline drafts local",
    ({ kind, scopeId, route, queueType }) => {
      const adapter = CHAT_SCOPE_ADAPTERS[kind];
      const ordered = orderChatMessagesChronologically([
        { id: "later", created_at: "2026-09-17T10:01:00.000Z" },
        { id: "earlier", created_at: "2026-09-17T10:00:00.000Z" },
      ]);

      expect(ordered.map(({ id }) => id)).toEqual(["earlier", "later"]);
      expect(adapter.route(scopeId ?? undefined)).toBe(route);
      expect(buildChatScopeFilter(adapter, scopeId ?? undefined)).toEqual(
        adapter.scopeColumn ? { [adapter.scopeColumn]: scopeId } : {},
      );

      queueMessage({
        type: queueType,
        targetId: scopeId ?? "broadcast-fixture",
        authorId: "synthetic-author",
        text: "queued reply",
        imageUrl: null,
        replyToId: "original-message",
        createdAt: "2026-09-17T10:02:00.000Z",
      });

      expect(
        getQueuedMessagesForTarget(queueType, scopeId ?? "broadcast-fixture"),
      ).toEqual([
        expect.objectContaining({
          type: queueType,
          text: "queued reply",
          replyToId: "original-message",
        }),
      ]);
    },
  );

  it("uses the shared virtualized jump engine to load an exact historical message", async () => {
    vi.useFakeTimers();
    const messages: Array<{ id: string }> = [{ id: "already-loaded" }];
    const handle: VirtualizedChatMessageListHandle = {
      scrollToBottom: vi.fn(),
      scrollToIndex: vi.fn(),
      scrollToMessageId: vi.fn(() => false),
      isAtBottom: vi.fn(() => true),
      isNearBottom: vi.fn(() => true),
    };
    const tryLoadOlder = vi.fn(() => messages.push({ id: "target-message" }));
    const setHighlightedMessageId = vi.fn();

    const cancel = jumpToMessageInVirtualizedChat(
      "target-message",
      () => messages,
      () => handle,
      setHighlightedMessageId,
      { intervalMs: 10, maxAttempts: 5, tryLoadOlder },
    );
    await vi.advanceTimersByTimeAsync(100);
    cancel();

    expect(tryLoadOlder).toHaveBeenCalled();
    expect(handle.scrollToIndex).toHaveBeenCalledWith(1, "end");
    expect(setHighlightedMessageId).toHaveBeenCalledWith("target-message");
  });

  it("retains the surface-specific capability and authorization boundaries", () => {
    expect(CHAT_SCOPE_ADAPTERS.team.capabilities.clubAnnouncements).toBe("supported");
    expect(CHAT_SCOPE_ADAPTERS.group.capabilities.forwarding).toBe("conditional");
    expect(CHAT_SCOPE_ADAPTERS.direct.capabilities.attachments).toBe("conditional");
    expect(CHAT_SCOPE_ADAPTERS.broadcast.sendBoundary).toBe("app_admin");
  });
});

describe("src/test/chatSurfaceNavigationParity.characterization.test.ts", () => {
  it.each(CHAT_SURFACES)(
    "preserves an exact $kind notification target through URL and persisted jumps",
    ({ kind, scopeId, route }) => {
      const messageId = `${kind}-message`;
      const jumpKind = kind === "direct" ? "dm" : kind;
      const received = vi.fn();
      const unsubscribe = subscribePendingChatJump(received);

      setPendingChatJump(jumpKind, scopeId, messageId);

      expect(received).toHaveBeenCalledWith(expect.objectContaining({ messageId }));
      expect(consumePendingChatJump(jumpKind, scopeId)).toBe(messageId);
      expect(getLastConsumedPendingChatJumpTs(messageId)).toEqual(expect.any(Number));
      expect(
        getJumpTarget(
          { message_id: messageId },
          `${route}?message=stale-message`,
        ),
      ).toEqual({ kind: jumpKind, targetId: scopeId, messageId });
      expect(withChatJumpNonce(`${route}?message=${messageId}`, 17)).toContain("jump=17");
      unsubscribe();
    },
  );

  it("keeps pinning explicit only where the local scope contract supports it", () => {
    for (const kind of ["team", "club", "group", "direct"] as const) {
      expect(CHAT_SCOPE_ADAPTERS[kind].capabilities.pinning).not.toBe("unsupported");
    }
    expect(CHAT_SCOPE_ADAPTERS.broadcast.capabilities.pinning).toBe("unsupported");
    expect(CHAT_SCOPE_ADAPTERS.club_admin.capabilities.pinning).toBe("unsupported");
  });
});

describe("src/lib/chatComposerEdit.characterization.test.ts", () => {
  it("uses controller edit transitions and the immutable message id for every chat surface", () => {
    for (const { kind } of CHAT_SURFACES) {
      const { result, unmount } = renderHook(() =>
        useChatComposerController(`${kind}-edit-fixture`, {
          clearReplyOnEdit: kind !== "group",
        }),
      );
      const reply = { id: "reply-message", text: "parent", authorName: "Synthetic" };

      act(() => {
        result.current.setReplyingTo(reply);
        result.current.beginEdit({ id: "edited-message", text: "original text" });
      });

      expect(result.current.editingMessage).toEqual({
        id: "edited-message",
        text: "original text",
      });
      expect(result.current.text).toBe("original text");
      expect(result.current.replyingTo).toEqual(kind === "group" ? reply : null);
      expect(buildChatMessageEdit(result.current.editingMessage, " revised ")).toEqual({
        messageId: "edited-message",
        text: "revised",
      });

      act(() => result.current.cancelEdit());
      expect(result.current.editingMessage).toBeNull();
      expect(result.current.text).toBe("");
      unmount();
    }
  });
});

describe("src/lib/chatComposerIntent.characterization.test.ts", () => {
  it.each(CHAT_SURFACES)(
    "derives $kind send eligibility and poll text from the current controller",
    ({ kind }) => {
      const { result, unmount } = renderHook(() =>
        useChatComposerController(`${kind}-intent-fixture`),
      );

      expect(result.current.canSend).toBe(false);
      act(() => result.current.setText("   "));
      expect(result.current.canSend).toBe(false);
      act(() => result.current.setPendingPollId("poll-fixture"));
      expect(result.current.canSend).toBe(true);
      expect(result.current.buildSubmission()).toMatchObject({
        text: "[poll:poll-fixture]",
        replyToId: null,
      });
      act(() => {
        result.current.setPendingPollId(null);
        result.current.setImageUrl("synthetic-image");
      });
      expect(result.current.canSend).toBe(true);
      unmount();
    },
  );

  it("retains direct messages as a participant-gated local surface", () => {
    expect(CHAT_SCOPE_ADAPTERS.direct.sendBoundary).toBe("conversation_participant");
    expect(CHAT_SCOPE_ADAPTERS.direct.capabilities.polls).toBe("unsupported");
  });
});

describe("src/lib/chatMessageReconciliation.characterization.test.ts", () => {
  it.each(CHAT_SURFACES)(
    "applies $kind edits and soft deletes to query and rendered message stores",
    ({ kind, scopeId }) => {
      const scope = `${kind}:${scopeId ?? "global"}`;
      const staleMessages = [
        {
          id: "edited-message",
          text: "before",
          created_at: "2026-09-17T10:00:00.000Z",
          reactions: [{ id: "temp-reaction", user_id: "synthetic-author", reaction_type: "like" }],
        },
        { id: "deleted-message", text: "remove", created_at: "2026-09-17T10:01:00.000Z" },
      ];
      const queryEnvelope = { messages: staleMessages };

      expect(
        recordRealtimeMutation(scope, {
          id: "edited-message",
          text: "after",
          updated_at: "2026-09-17T10:02:00.000Z",
        }),
      ).toBe("updated");
      expect(
        recordRealtimeMutation(scope, {
          id: "deleted-message",
          deleted_at: "2026-09-17T10:03:00.000Z",
        }),
      ).toBe("deleted");
      recordRealtimeReaction(scope, "edited-message", {
        id: "persisted-reaction",
        user_id: "synthetic-author",
        reaction_type: "like",
      });

      const queryMessages = reconcileMessages(
        scope,
        extractChatQueryMessages(queryEnvelope),
      );
      const localMessages = reconcileMessages(scope, [...staleMessages]);

      expect(queryMessages).toEqual([
        expect.objectContaining({
          id: "edited-message",
          text: "after",
          reactions: [{
            id: "persisted-reaction",
            user_id: "synthetic-author",
            reaction_type: "like",
          }],
        }),
      ]);
      expect(localMessages).toEqual(queryMessages);

      recordRealtimeReactionDelete(scope, "edited-message", "persisted-reaction");
      expect(reconcileMessages(scope, queryMessages)).toEqual([
        expect.objectContaining({ id: "edited-message", text: "after", reactions: [] }),
      ]);
    },
  );
});

describe("src/lib/chatScheduleIntent.characterization.test.ts", () => {
  it("builds each exact local schedule target and clears only scheduled composer fields", () => {
    expect(buildChatScheduleTarget("team", "team-fixture")).toEqual({
      chat_type: "team",
      team_id: "team-fixture",
    });
    expect(buildChatScheduleTarget("club", "club-fixture")).toEqual({
      chat_type: "club",
      club_id: "club-fixture",
    });
    expect(buildChatScheduleTarget("group", "group-fixture")).toEqual({
      chat_type: "group",
      group_id: "group-fixture",
    });
    expect(buildChatScheduleTarget("direct", "direct-fixture")).toEqual({
      chat_type: "direct",
      conversation_id: "direct-fixture",
    });
    expect(buildChatScheduleTarget("club_admin", "club-admin-fixture")).toEqual({
      chat_type: "club_admin",
      conversation_id: "club-admin-fixture",
    });
    expect(buildChatScheduleTarget("broadcast")).toEqual({ chat_type: "broadcast" });

    const calls: string[] = [];
    resetChatComposerAfterSchedule({
      setComposerText: (value) => calls.push(`text:${value}`),
      setImageUrl: (value) => calls.push(`image:${value}`),
      clearDraft: () => calls.push("draft"),
    });
    expect(calls).toEqual(["text:", "image:null", "draft"]);
  });

  it("preserves failed team sends through the current controller without weakening direct attachments", () => {
    const { result } = renderHook(() => useChatComposerController("team-restore-fixture"));
    const context = {
      tempId: "temp-team-message",
      sentText: "failed attachment message",
      sentImageUrl: "synthetic-image",
      previousReplyTarget: { id: "parent", text: "parent message", authorName: "Synthetic" },
      pendingPollId: null,
      sentAtMs: Date.now(),
    };

    act(() => result.current.restoreAfterFailedSend(context));

    expect(result.current.buildSubmission()).toEqual({
      text: "failed attachment message",
      imageUrl: "synthetic-image",
      replyToId: "parent",
    });
    expect(CHAT_SCOPE_ADAPTERS.direct.capabilities.attachments).toBe("conditional");
  });
});
