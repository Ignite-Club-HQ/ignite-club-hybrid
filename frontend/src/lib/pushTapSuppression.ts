/**
 * Short-lived suppression of unread badge counts for a chat scope the user
 * just tapped from a push notification.
 *
 * Why: when a user taps a push, the following race causes an off-putting
 * flash on the bottom-nav Messages badge:
 *   1. cold mount seeds unread counts as 0 → badge hidden
 *   2. RPC returns the real count (incl. the just-arrived message) → badge
 *      flashes the number
 *   3. chat page mounts and marks that message read → count drops → badge
 *      vanishes
 *
 * The user was about to read that scope anyway. We flag it as "suppressed"
 * the moment the push tap is handled, so any badge consumer that opts in
 * skips that scope's contribution for a short window. Once the read-receipt
 * clears the count naturally, or the window elapses, suppression drops off.
 *
 * Scoped to (kind, targetId) so other chats (e.g. Team B with 3 unread,
 * Club with 2) continue to render their badges normally.
 */

import { useSyncExternalStore } from "react";

export type SuppressedChatKind =
  | "team"
  | "club"
  | "club_admin"
  | "group"
  | "dm"
  | "broadcast";

export interface SuppressedChatScope {
  kind: SuppressedChatKind;
  targetId: string | null;
  expiresAt: number;
}

const DEFAULT_WINDOW_MS = 1500;

let scopes: SuppressedChatScope[] = [];
const listeners = new Set<() => void>();
let sweepTimer: ReturnType<typeof setTimeout> | null = null;

const emit = () => {
  // Copy-on-write so useSyncExternalStore's shallow-compare snapshot changes.
  scopes = [...scopes];
  listeners.forEach((l) => l());
};

const scheduleSweep = () => {
  if (sweepTimer) clearTimeout(sweepTimer);
  const soonest = scopes.reduce(
    (min, s) => Math.min(min, s.expiresAt),
    Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(soonest)) return;
  const delay = Math.max(0, soonest - Date.now());
  sweepTimer = setTimeout(() => {
    sweepTimer = null;
    const now = Date.now();
    const before = scopes.length;
    scopes = scopes.filter((s) => s.expiresAt > now);
    if (scopes.length !== before) emit();
    scheduleSweep();
  }, delay + 20);
};

const sameScope = (a: SuppressedChatScope, kind: SuppressedChatKind, targetId: string | null) =>
  a.kind === kind && (a.targetId ?? null) === (targetId ?? null);

/**
 * Mark a chat scope as suppressed for `durationMs`. Called when a push
 * notification tap is being handled and the user is about to navigate
 * into that chat.
 */
export function suppressChatScope(
  kind: SuppressedChatKind,
  targetId: string | null,
  durationMs: number = DEFAULT_WINDOW_MS,
): void {
  const expiresAt = Date.now() + Math.max(250, durationMs);
  const existing = scopes.find((s) => sameScope(s, kind, targetId));
  if (existing) {
    if (expiresAt > existing.expiresAt) existing.expiresAt = expiresAt;
  } else {
    scopes.push({ kind, targetId, expiresAt });
  }
  emit();
  scheduleSweep();
}

/** Manually clear suppression for a scope (e.g. after a real read-receipt lands). */
export function clearSuppressedChatScope(kind: SuppressedChatKind, targetId: string | null): void {
  const before = scopes.length;
  scopes = scopes.filter((s) => !sameScope(s, kind, targetId));
  if (scopes.length !== before) emit();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

const getSnapshot = () => scopes;
const getServerSnapshot = () => scopes;

/** Live list of currently-suppressed scopes. Re-renders when the set changes. */
export function useSuppressedChatScopes(): SuppressedChatScope[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
