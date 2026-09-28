/**
 * Notification-driven active-club switching.
 *
 * Problem: when the app is filtered to Club A and the user taps a push for a
 * message in Club B, navigation opens the correct Club B thread but the global
 * club filter (header, home, inbox, media, schedule) stays on Club A. The user
 * ends up in a chat that "doesn't exist" according to every other surface.
 *
 * This module resolves the club that OWNS the tapped notification target and
 * stashes it as a pending switch. A consumer inside `ClubThemeProvider`
 * (`useNotificationClubSwitch`) verifies membership and applies it via
 * `setActiveClubTheme`.
 *
 * IMPORTANT — this does NOT violate the "chat pages must never mutate the
 * active club filter" rule (see `useSyncActiveClubToChat`). That rule targets
 * *rendering* a chat page. Here the mutation is caused by an explicit user
 * gesture (tapping a notification for another club), exactly like
 * `seedClubFilterFromInvite`. Nothing switches clubs on its own.
 */

import { supabase } from "@/integrations/supabase/client";
import { getJumpTarget, type ChatJumpKind } from "@/lib/pendingChatJump";
import { resolveRouteClubScope } from "@/lib/routeClubScope";
import { lookupRouteClubId } from "@/lib/clubScopeLookup";


const SS_KEY = "ignite_pending_notification_club_switch";
const APPLIED_KEY = "ignite_notification_club_switch_applied";
/**
 * Short-TTL "switch in flight" marker. `APPLIED_KEY` is only written after
 * membership verification (up to 4 round trips), but navigation happens
 * immediately — so `useClubScopeGuard` could bounce a legitimate cross-club
 * notification target home before the switch landed. This marker closes that
 * window.
 */
const INFLIGHT_KEY = "ignite_notification_club_switch_inflight";
const EVENT = "ignite:notification-club-switch";
/** Stale pending switches must never hijack a later, unrelated session. */
const TTL_MS = 120_000;
const INFLIGHT_TTL_MS = 30_000;

interface PendingSwitch {
  clubId: string | null;
  ts: number;
  /**
   * The raw notification payload + url, kept so an unresolved switch can be
   * resolved LATER by `useNotificationClubSwitch` once auth is guaranteed
   * ready. Tap-time resolution races the Supabase session restore on cold
   * start (RLS denies the `teams` lookup with an anon/refreshing session) and
   * a null result was previously dropped with no retry — the chat opened via
   * url navigation while the filter stayed on the old club.
   */
  data?: unknown;
  url?: string | null;
}

/** Only payload fields resolution depends on — keeps sessionStorage tiny. */
function trimNotificationData(data: any): Record<string, unknown> | undefined {
  if (!data || typeof data !== "object") return undefined;
  const KEYS = [
    "club_id", "clubId", "team_id", "teamId", "message_id", "messageId",
    "related_id", "relatedId", "group_id", "groupId", "conversation_id",
    "chat_group_id", "context_id", "contextId", "type", "notificationType",
  ];
  const out: Record<string, unknown> = {};
  for (const k of KEYS) if (data[k] != null) out[k] = data[k];
  return out;
}

export function clearPendingNotificationClubSwitch(): void {
  try { sessionStorage.removeItem(SS_KEY); } catch { /* noop */ }
}

function markNotificationClubSwitchInFlight(clubId: string): void {
  try {
    sessionStorage.setItem(INFLIGHT_KEY, JSON.stringify({ clubId, ts: Date.now() } satisfies PendingSwitch));
  } catch { /* noop */ }
}

export function clearNotificationClubSwitchInFlight(): void {
  try { sessionStorage.removeItem(INFLIGHT_KEY); } catch { /* noop */ }
}

/**
 * True when a notification-driven switch to `clubId` was requested and has not
 * finished reconciling yet. Consumed by `useClubScopeGuard` so it never bounces
 * a route whose club is about to become active.
 */
export function isNotificationClubSwitchInFlight(clubId: string | null | undefined): boolean {
  if (!clubId) return false;
  try {
    const raw = sessionStorage.getItem(INFLIGHT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PendingSwitch;
      if (parsed?.clubId) {
        if (Date.now() - parsed.ts > INFLIGHT_TTL_MS) {
          clearNotificationClubSwitchInFlight();
        } else if (parsed.clubId === clubId) {
          return true;
        }
      }
    }
    // Stand down while a RAW switch request is still unresolved: the tap-time
    // lookup may have raced auth, so we cannot name the club yet — but the
    // user already tapped into that content and the hook is resolving it.
    const req = peekPendingNotificationClubSwitchRequest();
    if (req && !req.clubId && Date.now() - req.ts < INFLIGHT_TTL_MS) return true;
    return false;
  } catch {
    return false;
  }
}


/**
 * Records that a notification-driven club switch has been APPLIED.
 *
 * `useClubTheme` re-asserts `activeClubTheme` from localStorage / the profile
 * row during its async bootstrap. On a cold-start notification tap that
 * bootstrap can finish *after* the switch, silently dragging the filter back to
 * the previously selected club (the reported bug: Bridgewater thread open, app
 * still filtered to Basket Range). The provider consults this marker and treats
 * it as authoritative for its TTL instead of clobbering the switch.
 */
export function markNotificationClubSwitchApplied(clubId: string): void {
  try {
    sessionStorage.setItem(APPLIED_KEY, JSON.stringify({ clubId, ts: Date.now() } satisfies PendingSwitch));
  } catch { /* noop */ }
}

/** The club id of a recently applied notification switch, or null. */
export function getAppliedNotificationClubSwitch(): string | null {
  try {
    const raw = sessionStorage.getItem(APPLIED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSwitch;
    if (!parsed?.clubId) return null;
    if (Date.now() - parsed.ts > TTL_MS) {
      clearAppliedNotificationClubSwitch();
      return null;
    }
    return parsed.clubId;
  } catch {
    return null;
  }
}

export function clearAppliedNotificationClubSwitch(): void {
  try { sessionStorage.removeItem(APPLIED_KEY); } catch { /* noop */ }
}

/**
 * The full pending switch request, including the raw payload/url when the
 * club has not been resolved yet. TTL-guarded like the resolved form.
 */
export function peekPendingNotificationClubSwitchRequest(): PendingSwitch | null {
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSwitch;
    if (!parsed || typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > TTL_MS) {
      clearPendingNotificationClubSwitch();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function peekPendingNotificationClubSwitch(): string | null {
  return peekPendingNotificationClubSwitchRequest()?.clubId ?? null;
}

/** Reads and clears the pending switch (resolved or still-raw). */
export function consumePendingNotificationClubSwitch(): string | null {
  const req = peekPendingNotificationClubSwitchRequest();
  if (req) clearPendingNotificationClubSwitch();
  return req?.clubId ?? null;
}

function stash(clubId: string, data?: unknown, url?: string | null) {
  const payload: PendingSwitch = {
    clubId,
    ts: Date.now(),
    data: trimNotificationData(data),
    url: url ?? null,
  };
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(payload)); } catch { /* noop */ }
  // Guard the route immediately: the club is not active yet (membership check
  // still pending) but the user is already navigating into its content.
  markNotificationClubSwitchInFlight(clubId);
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: payload }));
  } catch { /* noop */ }
}

/**
 * Stash the RAW tap request before the owning club is known. Synchronous and
 * synchronous-safe: it must run even when the tap-time DB lookups race auth
 * restore on a cold start, so `useNotificationClubSwitch` can resolve it once
 * the session is guaranteed ready.
 */
function stashRequest(data?: unknown, url?: string | null): void {
  if (typeof window === "undefined") return;
  const payload: PendingSwitch = {
    clubId: null,
    ts: Date.now(),
    data: trimNotificationData(data),
    url: url ?? null,
  };
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(payload)); } catch { /* noop */ }
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: payload }));
  } catch { /* noop */ }
}

/**
 * Overwrites a raw pending request with its resolved club. Called by
 * `useNotificationClubSwitch` after deferred (post-auth) resolution.
 */
export function stashResolvedNotificationClubSwitch(
  clubId: string,
  data?: unknown,
  url?: string | null,
): void {
  stash(clubId, data, url);
}

/**
 * True when the notification can never carry a club (DMs, broadcast) and has
 * no explicit club/team id on the payload. Those are never stashed — there is
 * nothing to switch to and nothing to resolve later.
 */
export function isDefinitelyNotClubScoped(data: any, url: string | null | undefined): boolean {
  if (data?.club_id || data?.clubId || data?.team_id || data?.teamId) return false;
  const type = data?.notificationType || data?.type;
  if (type === "direct_message" || type === "broadcast_message") return true;
  const target = url || data ? getJumpTarget(data, url) : null;
  if (target?.kind === "dm" || target?.kind === "broadcast") return true;
  if (url) {
    try {
      const { pathname } = new URL(url, "https://reference.invalid");
      if (pathname.startsWith("/messages/dm/") || pathname.startsWith("/messages/broadcast")) return true;
    } catch { /* noop */ }
  }
  return false;
}


export function subscribeNotificationClubSwitch(handler: (clubId: string | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<PendingSwitch>).detail;
    if (detail) handler(detail.clubId ?? null);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/**
 * Resolves the owning club for a NON-chat notification url (`/events/:id`,
 * `/teams/:id`, `/clubs/:id`, `/mini-leagues/:id`, `/media?photo=…`, …).
 *
 * Push senders overwhelmingly omit `club_id` from the payload for these types,
 * and `getJumpTarget` only understands chat urls — so without this the filter
 * stayed on the previously selected club and `useClubScopeGuard` bounced the
 * user home. Resolution mirrors `useClubScopeGuard` exactly (same tables, same
 * fail-open behaviour) so the two can never disagree.
 */
async function resolveClubIdFromUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  let pathname = url;
  let search = "";
  try {
    const parsed = new URL(url, "https://reference.invalid");
    pathname = parsed.pathname;
    search = parsed.search;
  } catch {
    const qIdx = url.indexOf("?");
    if (qIdx >= 0) {
      pathname = url.slice(0, qIdx);
      search = url.slice(qIdx);
    }
  }

  // /media?photo=<id> — resolve through the photo row (club or its team).
  if (pathname.startsWith("/media")) {
    const photoId = new URLSearchParams(search).get("photo");
    if (!photoId) return null;
    return await lookupRouteClubId("photos", photoId);
  }

  const scope = resolveRouteClubScope(pathname);
  if (scope.kind === "direct") return scope.clubId;
  if (scope.kind === "lookup") {
    // Team-owned rows (team events, team photos, team groups) carry a NULL
    // club_id — `lookupRouteClubId` recovers the club via their team.
    return await lookupRouteClubId(scope.table, scope.id);
  }

  return null;
}

/**
 * Resolves the owning club id for a tapped notification.
 *
 * Order of trust:
 *  1. Explicit `club_id` on the push payload (set by the senders).
 *  2. The chat jump target (team / group / club-admin conversation) resolved
 *     through an RLS-scoped lookup.
 *  3. The notification url itself (events, teams, clubs, media, …).
 *
 * Returns `null` when the club can't be determined — callers must then leave
 * the current filter untouched rather than guess.
 */
export async function resolveNotificationClubId(
  data: any,
  url: string | null | undefined,
): Promise<string | null> {
  try {
    const explicit = data?.club_id || data?.clubId;
    if (explicit && typeof explicit === "string") return explicit;

    const target = getJumpTarget(data, url);
    const kind: ChatJumpKind | null = target?.kind ?? null;
    const targetId = target?.targetId ?? null;

    if (kind === "club" && targetId) return targetId;

    if (kind === "team") {
      const teamId = targetId || data?.team_id || data?.teamId;
      if (!teamId) return null;
      const { data: team } = await supabase
        .from("teams").select("club_id").eq("id", teamId).maybeSingle();
      return (team as any)?.club_id ?? null;
    }

    if (kind === "group") {
      const groupId = targetId || data?.group_id || data?.groupId;
      if (!groupId) return null;
      const { data: group } = await supabase
        .from("chat_groups").select("club_id").eq("id", groupId).maybeSingle();
      return (group as any)?.club_id ?? null;
    }

    if (kind === "club_admin" && targetId) {
      const { data: convo } = await supabase
        .from("club_admin_conversations").select("club_id").eq("id", targetId).maybeSingle();
      return (convo as any)?.club_id ?? null;
    }

    // dm / broadcast are not club-scoped — but a DM url never reaches here with
    // a club-scoped path, so the url fallback is safe for everything else.
    if (kind === "dm" || kind === "broadcast") return null;

    // Non-chat notifications (events, media, teams, clubs, rewards, invites …).
    const fromUrl = await resolveClubIdFromUrl(url);
    if (fromUrl) return fromUrl;

    // Last resort: a team id on the payload.
    const payloadTeamId = data?.team_id || data?.teamId;
    if (payloadTeamId && typeof payloadTeamId === "string") {
      const { data: team } = await supabase
        .from("teams").select("club_id").eq("id", payloadTeamId).maybeSingle();
      return (team as any)?.club_id ?? null;
    }

    return null;
  } catch (err) {
    console.warn("[NotificationClubSwitch] resolve failed", err);
    return null;
  }
}

/**
 * Entry point for push handlers: stash the raw request SYNCHRONOUSLY (so it
 * survives cold start), then resolve the notification's club and upgrade the
 * stash. Fire-and-forget — never blocks navigation.
 *
 * The raw stash matters: tap-time resolution races the Supabase session
 * restore on cold start, and a failed lookup used to silently drop the switch
 * (chat opened, filter stayed on the old club). `useNotificationClubSwitch`
 * re-resolves unresolved stashes once auth is guaranteed ready.
 */
export function requestClubSwitchForNotification(data: any, url: string | null | undefined): void {
  if (typeof window === "undefined") return;
  if (!isDefinitelyNotClubScoped(data, url)) stashRequest(data, url);
  void resolveNotificationClubId(data, url).then((clubId) => {
    if (clubId) stash(clubId, data, url);
  });
}

/**
 * In-app (bell) tap entry point for a notification whose owning club is already
 * known or resolvable from its url. Bounded so navigation is never delayed for
 * long; a slow lookup still stashes and is drained by
 * `useNotificationClubSwitch`.
 */
export async function requestClubSwitchForNotificationUrl(
  data: any,
  url: string | null | undefined,
  timeoutMs = 600,
): Promise<void> {
  if (typeof window === "undefined") return;
  if (!isDefinitelyNotClubScoped(data, url)) stashRequest(data, url);
  const resolving = resolveNotificationClubId(data, url).then((clubId) => {
    if (clubId) stash(clubId, data, url);
  });
  await Promise.race([
    resolving,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}


/**
 * Resolve the owning club for an already-resolved chat target (in-app
 * notification bell taps, where we have kind + targetId rather than a raw push
 * payload). DM/broadcast are not club-scoped and resolve to `null`.
 */
export async function resolveClubIdForChatTarget(
  kind: ChatJumpKind,
  targetId: string | null,
): Promise<string | null> {
  try {
    if (!targetId) return null;
    if (kind === "club") return targetId;
    if (kind === "team") {
      const { data } = await supabase.from("teams").select("club_id").eq("id", targetId).maybeSingle();
      return (data as any)?.club_id ?? null;
    }
    if (kind === "group") {
      const { data } = await supabase.from("chat_groups").select("club_id").eq("id", targetId).maybeSingle();
      return (data as any)?.club_id ?? null;
    }
    if (kind === "club_admin") {
      const { data } = await supabase
        .from("club_admin_conversations").select("club_id").eq("id", targetId).maybeSingle();
      return (data as any)?.club_id ?? null;
    }
    return null;
  } catch (err) {
    console.warn("[NotificationClubSwitch] target resolve failed", err);
    return null;
  }
}

/**
 * Bell-tap entry point: stash the pending club switch BEFORE navigating where
 * practical, so the destination thread does not render under the wrong club
 * context. Bounded by `timeoutMs` — navigation is never blocked for long, and a
 * slow lookup still stashes (and is drained by `useNotificationClubSwitch`)
 * once it resolves.
 */
/** Synthesizes the chat url for a known kind + targetId (bell taps). */
function chatTargetUrlFor(kind: ChatJumpKind, targetId: string | null): string | null {
  if (!targetId) return null;
  switch (kind) {
    case "team": return `/messages/${targetId}`;
    case "club": return `/messages/club/${targetId}`;
    case "group": return `/groups/${targetId}`;
    case "club_admin": return `/messages/club-admin/${targetId}`;
    default: return null;
  }
}

export async function requestClubSwitchForChatTarget(
  kind: ChatJumpKind,
  targetId: string | null,
  timeoutMs = 600,
): Promise<void> {
  if (typeof window === "undefined") return;
  const url = chatTargetUrlFor(kind, targetId);
  if (url && !isDefinitelyNotClubScoped(undefined, url)) stashRequest(undefined, url);
  const resolving = resolveClubIdForChatTarget(kind, targetId).then((clubId) => {
    if (clubId) stash(clubId, undefined, url);
  });
  await Promise.race([
    resolving,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
