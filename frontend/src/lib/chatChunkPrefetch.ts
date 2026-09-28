/**
 * Fire-and-forget dynamic imports for chat page chunks so that a notification
 * tap can warm up the JS bundle WHILE auth/profile bootstrap is still running.
 * By the time AppLayout's loading gate resolves, the chat page module is
 * already in the module cache and React can mount it without a network wait.
 *
 * Called from the notification launch handlers (web + native) the moment a
 * pending push URL is captured. Safe to invoke any number of times — the
 * dynamic import is cached by the module loader.
 */

const prefetched = new Set<string>();

function once(key: string, fn: () => Promise<unknown>) {
  if (prefetched.has(key)) return;
  prefetched.add(key);
  // Ignore errors — this is purely a perf optimisation.
  void fn().catch(() => {});
}

export function prefetchChatChunkForUrl(rawUrl: string | null | undefined): void {
  if (!rawUrl) return;
  let path = rawUrl;
  try {
    if (rawUrl.startsWith("http")) {
      const u = new URL(rawUrl);
      path = u.pathname;
    }
  } catch {
    // ignore — use rawUrl as-is
  }

  if (path.startsWith("/groups/")) {
    once("groups", () => import("@/pages/GroupChatPage"));
  } else if (path.startsWith("/teams/")) {
    // Team chat is mounted from TeamDetailPage; warm both common entry points.
    once("team-chat", () => import("@/pages/TeamChatPage"));
    once("team-detail", () => import("@/pages/TeamDetailPage"));
  } else if (path.startsWith("/clubs/") && path.includes("/admin-chat")) {
    once("club-admin-chat", () => import("@/pages/ClubAdminChatPage"));
  } else if (path.startsWith("/clubs/")) {
    once("club-chat", () => import("@/pages/ClubChatPage"));
  } else if (path.startsWith("/messages/broadcast") || path.startsWith("/broadcast")) {
    once("broadcast", () => import("@/pages/BroadcastChatPage"));
  } else if (path.startsWith("/messages/club-admin/")) {
    once("club-admin-chat", () => import("@/pages/ClubAdminChatPage"));
  } else if (path.startsWith("/messages/club/")) {
    once("club-chat", () => import("@/pages/ClubChatPage"));
  } else if (path.startsWith("/messages/dm/") || path.startsWith("/dm/")) {
    once("dm", () => import("@/pages/DirectMessagePage"));
  } else if (path === "/messages" || path === "/messages/") {
    once("messages", () => import("@/pages/MessagesPage"));
  } else if (path.startsWith("/messages/")) {
    // /messages/:teamId → TeamChatPage (most common notification target)
    once("team-chat", () => import("@/pages/TeamChatPage"));
  }
}
