import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Global Realtime presence tracker.
 *
 * A single shared Supabase Realtime channel ("app-presence") tracks which
 * users currently have the app open. Every consumer reads from the same
 * in-memory set so we only ever maintain one channel per tab.
 *
 * Resilience:
 *  - Re-tracks on every SUBSCRIBED (handles reconnect after token refresh,
 *    network blips, mobile background → foreground transitions).
 *  - Heartbeats every 25s so stale presences are refreshed and the server
 *    keeps the entry alive.
 *  - Re-syncs on window focus / `online` event so foregrounding the app
 *    immediately re-broadcasts our presence.
 *  - On CHANNEL_ERROR / TIMED_OUT / CLOSED we tear down and re-subscribe
 *    after a short delay.
 *
 * Usage:
 *   const isOnline = useIsUserOnline(otherUserId);
 */

type Listener = (online: Set<string>) => void;

const PRESENCE_CHANNEL = "app-presence";
const HEARTBEAT_MS = 25_000;
const RECONNECT_DELAY_MS = 2_000;

let channel: ReturnType<typeof supabase.channel> | null = null;
let onlineUsers: Set<string> = new Set();
const listeners = new Set<Listener>();
let currentUserId: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityHandlerAttached = false;

function notify() {
  const snapshot = new Set(onlineUsers);
  onlineUsers = snapshot;
  for (const l of listeners) l(snapshot);
}

function rebuildFromState(state: Record<string, Array<{ user_id?: string }>>) {
  const next = new Set<string>();
  for (const key of Object.keys(state)) {
    const presences = state[key] || [];
    for (const p of presences) {
      if (p?.user_id) next.add(p.user_id);
    }
  }
  onlineUsers = next;
  notify();
}

function clearTimers() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

type PresenceChannel = ReturnType<typeof supabase.channel>;

/**
 * Ownership guard: a callback (subscription status, heartbeat tick, reconnect
 * timer) may only act if the channel instance AND user that installed it are
 * still the active ones. Delayed callbacks from replaced/obsolete channels are
 * ignored completely.
 */
function isCurrentChannel(
  expectedChannel: PresenceChannel | null,
  expectedUserId: string | null,
): boolean {
  return (
    !!expectedChannel &&
    !!expectedUserId &&
    channel === expectedChannel &&
    currentUserId === expectedUserId
  );
}

/**
 * Track presence for an explicitly-owned channel/user pair. Re-checks
 * ownership after each await, because a user switch or channel replacement
 * could have happened while we were suspended.
 */
async function trackPresence(
  expectedChannel: PresenceChannel | null,
  expectedUserId: string | null,
) {
  if (!isCurrentChannel(expectedChannel, expectedUserId)) return;
  try {
    await expectedChannel!.track({
      user_id: expectedUserId,
      online_at: new Date().toISOString(),
    });
  } catch {
    /* ignore — will retry on next heartbeat or reconnect */
  }
  if (!isCurrentChannel(expectedChannel, expectedUserId)) return;
  // Persist heartbeat to DB so admins can see who is online server-side.
  try {
    const platform =
      typeof window !== "undefined" && (window as any).Capacitor?.getPlatform
        ? (window as any).Capacitor.getPlatform()
        : "web";
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : null;
    await supabase.rpc("heartbeat_presence" as any, {
      _platform: platform,
      _user_agent: ua,
    });
  } catch {
    /* ignore — heartbeat is best-effort */
  }
}

/** Track presence for whatever channel/user is currently active. */
async function trackSelf() {
  await trackPresence(channel, currentUserId);
}

function scheduleReconnect(userId: string, expectedChannel?: PresenceChannel | null) {
  if (reconnectTimer) return;
  // Reconnect timers retain their expected identity: if ownership changed
  // before the timer fires, it becomes a harmless no-op.
  const ownedChannel = expectedChannel === undefined ? channel : expectedChannel;
  const ownsChannel = expectedChannel !== undefined;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (currentUserId !== userId) return;
    if (ownsChannel && ownedChannel && channel !== ownedChannel) return;
    // Force tear-down then re-init
    if (channel) {
      try {
        supabase.removeChannel(channel);
      } catch {
        /* ignore */
      }
      channel = null;
    }
    currentUserId = null; // force ensureChannel to fully re-init
    ensureChannel(userId).catch(() => {
      // Try again later
      scheduleReconnect(userId);
    });
  }, RECONNECT_DELAY_MS);
}


function attachVisibilityHandlers() {
  if (visibilityHandlerAttached || typeof window === "undefined") return;
  visibilityHandlerAttached = true;

  // One physical Android resume can fire visibilitychange + appStateChange +
  // resume + focus within the same tick. Coalesce them so we emit exactly one
  // presence heartbeat per foreground transition instead of four.
  let foregroundTimer: ReturnType<typeof setTimeout> | null = null;
  const onForeground = () => {
    if (!currentUserId) return;
    if (foregroundTimer) return;
    foregroundTimer = setTimeout(() => {
      foregroundTimer = null;
      if (!currentUserId) return;
      // Re-broadcast presence on foreground / network recovery.
      trackSelf();
    }, 250);
  };

  window.addEventListener("focus", onForeground);
  window.addEventListener("online", onForeground);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") onForeground();
  });


  // Native (Capacitor) lifecycle: websockets drop when an iOS/Android app
  // is backgrounded, so we must explicitly re-track on foreground.
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.()) {
    import("@capacitor/app")
      .then(({ App }) => {
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) onForeground();
        });
        App.addListener("resume", () => onForeground());
      })
      .catch(() => {
        /* plugin not available — fall back to web events */
      });
  }
}

async function ensureChannel(userId: string) {
  if (channel && currentUserId === userId) return;

  // Tear down any previous channel (sign-out / user switch).
  if (channel) {
    try {
      await supabase.removeChannel(channel);
    } catch {
      /* ignore */
    }
    channel = null;
    onlineUsers = new Set();
    notify();
  }

  clearTimers();
  currentUserId = userId;
  attachVisibilityHandlers();

  const ch = supabase.channel(PRESENCE_CHANNEL, {
    config: { presence: { key: userId } },
  });

  ch.on("presence", { event: "sync" }, () => {
    rebuildFromState(ch.presenceState() as any);
  });
  ch.on("presence", { event: "join" }, () => {
    rebuildFromState(ch.presenceState() as any);
  });
  ch.on("presence", { event: "leave" }, () => {
    rebuildFromState(ch.presenceState() as any);
  });

  // Publish ownership BEFORE subscribing so a synchronous status callback
  // recognises itself as the active channel.
  channel = ch;

  // Bind subscription work to the exact channel instance + user that created
  // this callback. Delayed callbacks from obsolete channels are ignored.
  const expectedChannel = ch;
  const expectedUserId = userId;

  ch.subscribe(async (status) => {
    if (!isCurrentChannel(expectedChannel, expectedUserId)) {
      // Obsolete/replaced channel: never track, never touch heartbeats,
      // never schedule reconnects, never remove the healthy channel.
      return;
    }

    if (status === "SUBSCRIBED") {
      // Always (re)track on SUBSCRIBED — this fires on initial connect AND
      // after auto-reconnects.
      await trackPresence(expectedChannel, expectedUserId);
      if (!isCurrentChannel(expectedChannel, expectedUserId)) return;

      // Exactly one active heartbeat timer, owned by this channel/user.
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (!isCurrentChannel(expectedChannel, expectedUserId)) {
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
          }
          return;
        }
        trackPresence(expectedChannel, expectedUserId);
      }, HEARTBEAT_MS);
    } else if (
      status === "CHANNEL_ERROR" ||
      status === "TIMED_OUT" ||
      status === "CLOSED"
    ) {
      // Genuine error on the ACTIVE channel — stop the heartbeat but keep any
      // already-pending reconnect so repeated errors coalesce into one timer.
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      scheduleReconnect(expectedUserId, expectedChannel);
    }
  });
}


async function teardown() {
  clearTimers();
  if (!channel) return;
  try {
    await channel.untrack();
    await supabase.removeChannel(channel);
  } catch {
    /* ignore */
  }
  channel = null;
  currentUserId = null;
  onlineUsers = new Set();
  notify();
}

/**
 * Subscribe the current user to the global presence channel.
 * Safe to call from many components — only one channel will be created.
 */
export function useTrackPresence(userId: string | null | undefined) {
  useEffect(() => {
    if (!userId) {
      teardown();
      return;
    }
    ensureChannel(userId).catch(() => {
      // Schedule a retry — ensureChannel itself doesn't, but the SUBSCRIBE
      // status handler will if the subscription fails.
      scheduleReconnect(userId);
    });
    return () => {
      // Don't tear down on unmount — other components may still be listening.
      // The channel is torn down when the user changes or signs out.
    };
  }, [userId]);
}

/** Reactive: returns true if the given user is currently online. */
export function useIsUserOnline(userId: string | null | undefined): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    userId ? onlineUsers.has(userId) : false,
  );

  useEffect(() => {
    if (!userId) {
      setOnline(false);
      return;
    }
    const handler: Listener = (set) => setOnline(set.has(userId));
    listeners.add(handler);
    setOnline(onlineUsers.has(userId));
    return () => {
      listeners.delete(handler);
    };
  }, [userId]);

  return online;
}

/**
 * Reactive: returns how many of the given user IDs are currently online.
 * Pass the current user's ID via `excludeUserId` to omit "me" from the count.
 */
export function useOnlineCount(
  userIds: string[] | null | undefined,
  excludeUserId?: string | null,
): number {
  // Count unique people, not occurrences. Ignore null/empty/malformed IDs and
  // never mutate the caller's array. Exclusion is applied before counting, so
  // the result is order-independent.
  const uniqueIds: string[] = [];
  {
    const seen = new Set<string>();
    for (const id of userIds || []) {
      if (typeof id !== "string") continue;
      const trimmed = id.trim();
      if (!trimmed) continue;
      if (excludeUserId && trimmed === excludeUserId) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      uniqueIds.push(trimmed);
    }
  }

  // Stable key: same unique IDs in any order produce the same key.
  const key = [...uniqueIds].sort().join(",") + "|" + (excludeUserId || "");

  const compute = (set: Set<string>): number => {
    let n = 0;
    for (const id of uniqueIds) {
      if (set.has(id)) n++;
    }
    return n;
  };


  const [count, setCount] = useState<number>(() => compute(onlineUsers));

  useEffect(() => {
    const handler: Listener = (set) => setCount(compute(set));
    listeners.add(handler);
    setCount(compute(onlineUsers));
    return () => {
      listeners.delete(handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return count;
}

/**
 * Reactive: returns the subset of the given user IDs that are currently online
 * according to the realtime presence channel.
 */
export function useOnlineSet(userIds: string[] | null | undefined): Set<string> {
  const key = (userIds || []).join(",");

  const compute = (set: Set<string>): Set<string> => {
    const out = new Set<string>();
    if (!userIds?.length) return out;
    for (const id of userIds) {
      if (set.has(id)) out.add(id);
    }
    return out;
  };

  const [result, setResult] = useState<Set<string>>(() => compute(onlineUsers));

  useEffect(() => {
    const handler: Listener = (set) => setResult(compute(set));
    listeners.add(handler);
    setResult(compute(onlineUsers));
    return () => {
      listeners.delete(handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return result;
}
