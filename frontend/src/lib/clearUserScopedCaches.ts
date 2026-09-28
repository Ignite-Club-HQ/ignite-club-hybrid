// Centralised purge of every per-user cache that lives outside React Query.
//
// Why this exists:
//   React Query's queryClient.clear() is called on SIGNED_OUT and on a
//   cross-user SIGNED_IN, but several modules maintain their own caches
//   (in-memory + localStorage + sessionStorage) keyed only by team / club
//   / thread — NOT by user. On a shared device or in the same browser tab
//   after an account switch, those caches survived logout and the new user
//   was served the previous user's data on first paint (e.g. reviewer
//   seeing Bridgewater gallery photos cached by another account, or User B
//   being navigated to User A's tapped chat thread because a pending push
//   route was still stashed in sessionStorage / module-level state).
//
// This helper wipes:
//   * All `ignite_*` localStorage entries (covers mediaCache, profileCache,
//     rolesCache, clubTeamCache, messageCache, messagesPageCache,
//     rosterCache, scheduleCache, myTeamsCarouselCache and any future
//     namespaced caches that follow the same convention).
//   * All `ignite_*` sessionStorage entries (chat drafts, pending push nav,
//     pending chat jump, `from_notification_*` hints, row-height cache).
//   * The exact-key non-`ignite_`-prefixed pending-nav slot used by the
//     native notification launch handler (`pendingPushNavigationUrl`).
//   * The in-memory mirrors exposed by modules that maintain them (media,
//     profile, roles, clubTeam, messagesPage caches PLUS the native /
//     web push launch handlers and the pending chat-jump helper), so the
//     next render sees an empty cache rather than the stale Map/module
//     values.
//
// Deliberately preserves unrelated third-party sessionStorage values
// (Google Drive OAuth codes, driveLink*, googleDrive*, autoJoinAfterAuth,
// authDefaultTab, redirectAfterAuth, push_correlation_id, push_just_reset,
// push subscription lock, paymentDeepLinkResult, googleDriveOAuthError,
// etc.). Those are either device-level, in-flight auth-flow state, or
// non-user-scoped, and destroying them would break the very sign-in flow
// that triggers this sweep.

import { clearMediaCache } from "./mediaCache";
import { clearProfileCache } from "./profileCache";
import { clearRolesCache } from "./rolesCache";
import { clearClubTeamCache } from "./clubTeamCache";
import { clearMessagesPageCache } from "./messagesPageCache";
import { clearPendingNotificationLaunchState } from "./notificationLaunchHandler";
import { clearPendingWebPushNav } from "./webNotificationLaunchHandler";
import { clearPendingChatJumpState } from "./pendingChatJump";
import { clearAllFromNotificationFlags } from "./notificationPreload";

const IGNITE_PREFIX = "ignite_";

// Historical hyphenated namespace. Pitch-board state, club theme data, EOI
// drafts, schedule and photo scaffolding all use `ignite-` (hyphen), which the
// underscore sweep silently missed — on a shared device the next user could be
// force-navigated into the previous coach's pitch board (open flag + open path
// survived) and hydrate their lineup/live clock. Swept as user-scoped data.
const LEGACY_LOCAL_PREFIXES = [
  "ignite-",
  // Pitch board timer state: `pitch-board-timer-state` and the per-team
  // variants. Carry lineup/clock state for one coach's team.
  "pitch-board-timer-state",
  // Which notification opened the board for the previous user.
  "pitch-board-open-source",
  // Per-user dismissal of the live-game widget.
  "pitch-widget-dismissed",
  // Inbox scaffolding for the previous user (all versions of the key).
  "messages-page-cache",
];

// Auth / session / device-identity keys that MUST survive a user switch.
// Anything else under the `ignite_` prefix (in either storage) is treated
// as user-scoped data.
const PRESERVE_LOCAL_KEYS = new Set<string>([
  // add explicit allow-list entries here if a future cache legitimately
  // needs to outlive a user switch (e.g. an install-id).
]);

// Prefix allow-list: keys that are already keyed BY user id and represent a
// permanent "seen once" record. Sweeping them re-shows one-shot coach-marks
// after every sign-out, which reads as a bug (the user dismissed it already).
const PRESERVE_LOCAL_PREFIXES = [
  "ignite_club_switcher_hint_",
];

const PRESERVE_SESSION_KEYS = new Set<string>([
  // add explicit allow-list entries here if a future `ignite_*` session
  // key is genuinely device-level and should survive a user switch.
]);

// sessionStorage keys that don't carry the `ignite_` prefix but ARE
// user-scoped and must be swept on account switch. Kept as an explicit
// list so we don't accidentally destroy unrelated third-party session
// state (Google Drive OAuth flow, autoJoinAfterAuth, redirectAfterAuth,
// push_correlation_id, etc.).
const EXPLICIT_SESSION_KEYS = [
  // Native notification launch handler stashes the pending SPA route here
  // (see src/lib/notificationLaunchHandler.ts). Non-prefixed for historical
  // reasons; still strictly user-scoped.
  "pendingPushNavigationUrl",
];

function sweepStorage(
  storage: Storage | undefined | null,
  preserve: Set<string>,
  extraPrefixes: string[] = [],
  preservePrefixes: string[] = [],
): void {
  if (!storage) return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key) continue;
      const matches =
        key.startsWith(IGNITE_PREFIX) ||
        extraPrefixes.some((prefix) => key.startsWith(prefix));
      if (!matches) continue;
      if (preserve.has(key)) continue;
      if (preservePrefixes.some((prefix) => key.startsWith(prefix))) continue;
      toRemove.push(key);
    }
    for (const key of toRemove) {
      try { storage.removeItem(key); } catch { /* noop */ }
    }
  } catch {
    /* storage unavailable (Safari private mode etc.) — nothing to do */
  }
}

function runSafe(fn: () => void): void {
  try { fn(); } catch { /* one throwing clearer must not stop later cleanup */ }
}

export function clearUserScopedCaches(): void {
  // 1. In-memory mirrors held by individual cache modules. Each call is
  //    wrapped so a single throw doesn't abort the rest of the sweep —
  //    that's important because this runs during sign-out and a partial
  //    cleanup is worse than a slightly-slower complete cleanup.
  runSafe(clearMediaCache);
  runSafe(clearProfileCache);
  runSafe(clearRolesCache);
  runSafe(clearClubTeamCache);
  runSafe(clearMessagesPageCache);

  // 2. Module-level pending navigation / jump / notification state that
  //    mirrors sessionStorage in JS variables. Deleting the session key
  //    alone is not enough — a getter can still return the module value
  //    after the account switch (User B is then routed into User A's
  //    pending chat).
  runSafe(clearPendingNotificationLaunchState);
  runSafe(clearPendingWebPushNav);
  runSafe(clearPendingChatJumpState);
  runSafe(clearAllFromNotificationFlags);

  // 3. Sweep namespaced localStorage entries (the historical behaviour).
  sweepStorage(
    typeof localStorage !== "undefined" ? localStorage : null,
    PRESERVE_LOCAL_KEYS,
    LEGACY_LOCAL_PREFIXES,
    PRESERVE_LOCAL_PREFIXES,
  );

  // 4. Sweep namespaced sessionStorage entries — same rule as localStorage.
  //    Chat drafts, pending web push nav, pending chat jump, from-notification
  //    flags and row-height cache all live here under `ignite_*` prefixes.
  sweepStorage(
    typeof sessionStorage !== "undefined" ? sessionStorage : null,
    PRESERVE_SESSION_KEYS,
  );

  // 5. Explicit non-prefixed user-scoped session keys.
  if (typeof sessionStorage !== "undefined") {
    for (const key of EXPLICIT_SESSION_KEYS) {
      try { sessionStorage.removeItem(key); } catch { /* noop */ }
    }
  }
}
