/**
 * Regression suite for the account-switch session-cache privacy defect.
 *
 * Historically `clearUserScopedCaches()` only swept `localStorage` and a
 * handful of in-memory caches. Push-navigation and pending chat-jump state
 * were persisted in `sessionStorage` (and mirrored in module-level
 * variables), so after User A signed out and User B signed in on the same
 * tab, User B could be redirected into User A's chat thread or see stale
 * "opened from notification" hints on unrelated chats.
 *
 * These tests pin the following invariants:
 *   1. Every in-memory cache clearer is invoked exactly once.
 *   2. A throwing clearer must not abort later cleanup.
 *   3. All user-scoped `ignite_*` entries are removed from both storages.
 *   4. Unrelated third-party storage keys survive.
 *   5. Module-level pending navigation state is also cleared (not just SS).
 *   6. Repeated calls are safe.
 *   7. Missing storage APIs do not throw.
 *   8. Pending web-push, native-push, chat-jump and from-notification keys
 *      are all covered by the sweep.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---- In-memory cache module mocks --------------------------------------

const clearMediaCache = vi.fn();
const clearProfileCache = vi.fn();
const clearRolesCache = vi.fn();
const clearClubTeamCache = vi.fn();
const clearMessagesPageCache = vi.fn();

vi.mock("./mediaCache", () => ({ clearMediaCache: (...a: any[]) => clearMediaCache(...a) }));
vi.mock("./profileCache", () => ({ clearProfileCache: (...a: any[]) => clearProfileCache(...a) }));
vi.mock("./rolesCache", () => ({ clearRolesCache: (...a: any[]) => clearRolesCache(...a) }));
vi.mock("./clubTeamCache", () => ({ clearClubTeamCache: (...a: any[]) => clearClubTeamCache(...a) }));
vi.mock("./messagesPageCache", () => ({ clearMessagesPageCache: (...a: any[]) => clearMessagesPageCache(...a) }));

// ---- Pending navigation module mocks -----------------------------------

const clearPendingNotificationLaunchState = vi.fn();
const clearPendingWebPushNav = vi.fn();
const clearPendingChatJumpState = vi.fn();
const clearAllFromNotificationFlags = vi.fn();

vi.mock("./notificationLaunchHandler", () => ({
  clearPendingNotificationLaunchState: (...a: any[]) => clearPendingNotificationLaunchState(...a),
}));
vi.mock("./webNotificationLaunchHandler", () => ({
  clearPendingWebPushNav: (...a: any[]) => clearPendingWebPushNav(...a),
}));
vi.mock("./pendingChatJump", () => ({
  clearPendingChatJumpState: (...a: any[]) => clearPendingChatJumpState(...a),
}));
vi.mock("./notificationPreload", () => ({
  clearAllFromNotificationFlags: (...a: any[]) => clearAllFromNotificationFlags(...a),
}));

import { clearUserScopedCaches } from "./clearUserScopedCaches";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("clearUserScopedCaches — in-memory cache clearers", () => {
  it("invokes every in-memory cache clearer exactly once", () => {
    clearUserScopedCaches();
    expect(clearMediaCache).toHaveBeenCalledTimes(1);
    expect(clearProfileCache).toHaveBeenCalledTimes(1);
    expect(clearRolesCache).toHaveBeenCalledTimes(1);
    expect(clearClubTeamCache).toHaveBeenCalledTimes(1);
    expect(clearMessagesPageCache).toHaveBeenCalledTimes(1);
  });

  it("continues cleanup when one in-memory clearer throws", () => {
    clearProfileCache.mockImplementationOnce(() => { throw new Error("boom"); });
    localStorage.setItem("ignite_media_cache_v1", "stale");
    sessionStorage.setItem("ignite_pending_chat_jump_v1", "stale");

    expect(() => clearUserScopedCaches()).not.toThrow();

    // Later in-memory clearers still fired.
    expect(clearRolesCache).toHaveBeenCalledTimes(1);
    expect(clearMessagesPageCache).toHaveBeenCalledTimes(1);
    // Later storage sweep still ran.
    expect(localStorage.getItem("ignite_media_cache_v1")).toBeNull();
    expect(sessionStorage.getItem("ignite_pending_chat_jump_v1")).toBeNull();
    // Module-level pending state clearers still ran.
    expect(clearPendingNotificationLaunchState).toHaveBeenCalledTimes(1);
    expect(clearPendingWebPushNav).toHaveBeenCalledTimes(1);
    expect(clearPendingChatJumpState).toHaveBeenCalledTimes(1);
  });
});

describe("clearUserScopedCaches — localStorage sweep", () => {
  it("removes every ignite_* localStorage entry", () => {
    localStorage.setItem("ignite_media_cache_v1", "a");
    localStorage.setItem("ignite_profile_cache_user_1", "b");
    localStorage.setItem("ignite_roster_cache_team_9", "c");
    clearUserScopedCaches();
    expect(localStorage.getItem("ignite_media_cache_v1")).toBeNull();
    expect(localStorage.getItem("ignite_profile_cache_user_1")).toBeNull();
    expect(localStorage.getItem("ignite_roster_cache_team_9")).toBeNull();
  });

  it("preserves unrelated (non-ignite_) localStorage entries", () => {
    localStorage.setItem("sb-abc-auth-token", "keep-me");
    localStorage.setItem("theme", "dark");
    localStorage.setItem("ignite_media_cache_v1", "drop-me");
    clearUserScopedCaches();
    expect(localStorage.getItem("sb-abc-auth-token")).toBe("keep-me");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(localStorage.getItem("ignite_media_cache_v1")).toBeNull();
  });
});

describe("clearUserScopedCaches — sessionStorage sweep (the account-switch privacy fix)", () => {
  it("must clear pending chat and notification navigation from sessionStorage", () => {
    // The exact keys called out in the defect report.
    sessionStorage.setItem("ignite_pending_chat_jump_v1", JSON.stringify({ kind: "dm", messageId: "m1" }));
    sessionStorage.setItem("ignite_pending_web_push_nav", "/messages/dm/user-a");
    sessionStorage.setItem("ignite_from_notification_dm_user-a", String(Date.now()));
    sessionStorage.setItem("ignite_from_notification_team_t1", String(Date.now()));
    // Non-prefixed but user-scoped native pending nav key.
    sessionStorage.setItem("pendingPushNavigationUrl", "/messages/dm/user-a");

    clearUserScopedCaches();

    expect(sessionStorage.getItem("ignite_pending_chat_jump_v1")).toBeNull();
    expect(sessionStorage.getItem("ignite_pending_web_push_nav")).toBeNull();
    expect(sessionStorage.getItem("ignite_from_notification_dm_user-a")).toBeNull();
    expect(sessionStorage.getItem("ignite_from_notification_team_t1")).toBeNull();
    expect(sessionStorage.getItem("pendingPushNavigationUrl")).toBeNull();
  });

  it("preserves unrelated sessionStorage entries (auth/device/in-flight OAuth)", () => {
    sessionStorage.setItem("googleDriveOAuthCode", "code-xyz");
    sessionStorage.setItem("googleDriveAccessToken", "tok");
    sessionStorage.setItem("driveLinkPending", "{}");
    sessionStorage.setItem("autoJoinAfterAuth", "true");
    sessionStorage.setItem("authDefaultTab", "signup");
    sessionStorage.setItem("redirectAfterAuth", "/somewhere");
    sessionStorage.setItem("push_correlation_id", "abc");
    sessionStorage.setItem("push_just_reset", "true");
    sessionStorage.setItem("paymentDeepLinkResult", "success");
    // Also stash something we do expect to clear so the sweep clearly ran.
    sessionStorage.setItem("ignite_pending_web_push_nav", "/messages/dm/user-a");

    clearUserScopedCaches();

    expect(sessionStorage.getItem("googleDriveOAuthCode")).toBe("code-xyz");
    expect(sessionStorage.getItem("googleDriveAccessToken")).toBe("tok");
    expect(sessionStorage.getItem("driveLinkPending")).toBe("{}");
    expect(sessionStorage.getItem("autoJoinAfterAuth")).toBe("true");
    expect(sessionStorage.getItem("authDefaultTab")).toBe("signup");
    expect(sessionStorage.getItem("redirectAfterAuth")).toBe("/somewhere");
    expect(sessionStorage.getItem("push_correlation_id")).toBe("abc");
    expect(sessionStorage.getItem("push_just_reset")).toBe("true");
    expect(sessionStorage.getItem("paymentDeepLinkResult")).toBe("success");
    // But the user-scoped entry is gone.
    expect(sessionStorage.getItem("ignite_pending_web_push_nav")).toBeNull();
  });
});

describe("clearUserScopedCaches — module-level pending state", () => {
  it("clears module-level pending navigation and chat-jump state (not just sessionStorage)", () => {
    // Deleting the sessionStorage key alone is insufficient: readers can
    // still return the module-level variable value, sending User B into
    // User A's pending route. The dedicated module clearers must run.
    clearUserScopedCaches();
    expect(clearPendingNotificationLaunchState).toHaveBeenCalledTimes(1);
    expect(clearPendingWebPushNav).toHaveBeenCalledTimes(1);
    expect(clearPendingChatJumpState).toHaveBeenCalledTimes(1);
    expect(clearAllFromNotificationFlags).toHaveBeenCalledTimes(1);
  });

  it("continues cleanup when a module-level clearer throws", () => {
    clearPendingWebPushNav.mockImplementationOnce(() => { throw new Error("boom"); });
    sessionStorage.setItem("ignite_pending_chat_jump_v1", "x");
    sessionStorage.setItem("pendingPushNavigationUrl", "/nope");

    expect(() => clearUserScopedCaches()).not.toThrow();

    expect(clearPendingChatJumpState).toHaveBeenCalledTimes(1);
    expect(clearAllFromNotificationFlags).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("ignite_pending_chat_jump_v1")).toBeNull();
    expect(sessionStorage.getItem("pendingPushNavigationUrl")).toBeNull();
  });
});

describe("clearUserScopedCaches — resilience", () => {
  it("is idempotent — repeated calls remain safe and leave storage empty", () => {
    localStorage.setItem("ignite_media_cache_v1", "a");
    sessionStorage.setItem("ignite_pending_web_push_nav", "/x");
    clearUserScopedCaches();
    clearUserScopedCaches();
    clearUserScopedCaches();
    expect(localStorage.getItem("ignite_media_cache_v1")).toBeNull();
    expect(sessionStorage.getItem("ignite_pending_web_push_nav")).toBeNull();
    expect(clearMediaCache).toHaveBeenCalledTimes(3);
  });

  it("does not throw when a storage backend throws on iteration/access", () => {
    // Simulate a storage API where removeItem throws (e.g. Safari private
    // mode edge-cases). Cleanup should still complete for the rest.
    const originalRemove = Storage.prototype.removeItem;
    const spy = vi.spyOn(Storage.prototype, "removeItem")
      .mockImplementationOnce(() => { throw new Error("storage full"); });
    sessionStorage.setItem("ignite_pending_web_push_nav", "/x");
    sessionStorage.setItem("ignite_from_notification_dm_1", "1");

    expect(() => clearUserScopedCaches()).not.toThrow();

    spy.mockRestore();
    Storage.prototype.removeItem = originalRemove;
  });

  it("prevents User B from consuming User A's pending push route after account switch", () => {
    // Simulate User A's session: pending native push route stashed.
    sessionStorage.setItem("pendingPushNavigationUrl", "/messages/dm/user-a-chat");
    sessionStorage.setItem("ignite_pending_web_push_nav", "/messages/dm/user-a-chat");
    sessionStorage.setItem("ignite_pending_chat_jump_v1", JSON.stringify({
      kind: "dm", targetId: "user-a-chat", messageId: "msg-a", ts: Date.now(),
    }));

    // Cross-user sign-in triggers the sweep.
    clearUserScopedCaches();

    // User B's tab must see nothing pending.
    expect(sessionStorage.getItem("pendingPushNavigationUrl")).toBeNull();
    expect(sessionStorage.getItem("ignite_pending_web_push_nav")).toBeNull();
    expect(sessionStorage.getItem("ignite_pending_chat_jump_v1")).toBeNull();
    // AND the module-level mirrors were told to reset.
    expect(clearPendingNotificationLaunchState).toHaveBeenCalled();
    expect(clearPendingWebPushNav).toHaveBeenCalled();
    expect(clearPendingChatJumpState).toHaveBeenCalled();
  });
});
