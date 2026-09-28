/**
 * Single source of truth for reconciling realtime message mutations
 * (edits + soft-deletes) across BOTH stores a chat page keeps:
 *
 *   1. the React Query cache (`["team-messages", teamId]` and friends)
 *   2. the rendered `localMessages` state
 *
 * Why a registry?
 * ---------------
 * A realtime UPDATE can land while an older fetch (initial load, background
 * refetch, older-history pagination, notification preload) is still in
 * flight. When that older response resolves it overwrites the cache with a
 * pre-edit snapshot — the edit visibly reverts, or a soft-deleted row comes
 * back. Applying the mutation to the stores alone therefore isn't enough:
 * we keep a short-lived tombstone/patch registry per chat scope and re-apply
 * it to EVERY message list that flows into rendering, so a stale fetch can
 * never resurrect stale content.
 *
 * The registry is intentionally NOT a third source of message truth: it only
 * holds the deltas from realtime mutations and is applied on top of whatever
 * the cache/fetch produced.
 */

import {
  clearReactionReconciliationScope,
  reconcileReactions,
} from "./chatReactionReconciliation";

export type ReconcilableMessage = { id: string };

/** Fields a realtime UPDATE payload may carry that we reconcile. */
const RECONCILED_FIELDS = [
  "text",
  "image_url",
  "is_club_announcement",
  "club_announcement_name",
  "is_system_message",
  "forwarded_from_user_id",
  "forwarded_at",
  "forwarded_source_label",
  "reply_to_id",
  "edited_at",
  "updated_at",
] as const;

type Entry =
  | { kind: "deleted"; at: number; version: number }
  | { kind: "patch"; patch: Record<string, unknown>; at: number; version: number };

const REGISTRY_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ENTRIES_PER_SCOPE = 500;

const registry = new Map<string, Map<string, Entry>>();

const now = () => Date.now();

/**
 * Server-authoritative ordering when available (`updated_at`/`edited_at`),
 * otherwise fall back to browser receipt time. Never trust receipt order
 * alone when a reliable server timestamp exists.
 */
const versionOf = (row: Record<string, unknown>): number => {
  const candidates = [row.deleted_at, row.updated_at, row.edited_at];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const t = Date.parse(candidate);
      if (!Number.isNaN(t)) return t;
    }
  }
  return now();
};

const scopeMap = (scopeKey: string) => {
  let m = registry.get(scopeKey);
  if (!m) {
    m = new Map();
    registry.set(scopeKey, m);
  }
  return m;
};

const prune = (m: Map<string, Entry>) => {
  const cutoff = now() - REGISTRY_TTL_MS;
  for (const [id, entry] of m) {
    if (entry.at < cutoff) m.delete(id);
  }
  while (m.size > MAX_ENTRIES_PER_SCOPE) {
    const oldest = m.keys().next();
    if (oldest.done) break;
    m.delete(oldest.value);
  }
};

/* ------------------------------------------------------------------ */
/* Pure list operations                                                */
/* ------------------------------------------------------------------ */

/**
 * Apply a realtime UPDATE payload to an existing list. Preserves any field
 * not present in the payload (profiles, reactions, reply_to, ...) and never
 * inserts a message that isn't already loaded. Idempotent.
 */
export function applyMessageUpdate<T extends ReconcilableMessage>(
  messages: T[],
  updated: Record<string, unknown> & { id: string },
): T[] {
  let changed = false;
  const next = messages.map((message) => {
    if (message.id !== updated.id) return message;
    const patch = extractPatch(updated);
    if (Object.keys(patch).length === 0) return message;
    const merged = { ...message, ...patch } as T;
    const isSame = Object.keys(patch).every(
      (key) => (message as Record<string, unknown>)[key] === patch[key],
    );
    if (isSame) return message;
    changed = true;
    return merged;
  });
  return changed ? next : messages;
}

/** Remove a message by id. Idempotent — returns the same array when absent. */
export function removeMessage<T extends ReconcilableMessage>(
  messages: T[],
  messageId: string,
): T[] {
  if (!messages.some((m) => m.id === messageId)) return messages;
  return messages.filter((m) => m.id !== messageId);
}

type ChatQueryEnvelope<T extends ReconcilableMessage> = {
  messages?: T[];
  [key: string]: unknown;
};

export function removeMessageFromQueryEnvelope<T extends ReconcilableMessage>(
  envelope: ChatQueryEnvelope<T> | undefined,
  messageId: string,
): ChatQueryEnvelope<T> & { messages: T[] } {
  return {
    ...(envelope ?? {}),
    messages: removeMessage(envelope?.messages ?? [], messageId),
  };
}

export function applyMessageUpdateToQueryEnvelope<T extends ReconcilableMessage>(
  envelope: ChatQueryEnvelope<T> | undefined,
  updated: Record<string, unknown> & { id: string },
): ChatQueryEnvelope<T> & { messages: T[] } {
  return {
    ...(envelope ?? {}),
    messages: applyMessageUpdate(envelope?.messages ?? [], updated),
  };
}

function extractPatch(row: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of RECONCILED_FIELDS) {
    if (row[field] !== undefined) patch[field] = row[field];
  }
  return patch;
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

/**
 * Record a realtime UPDATE for a chat scope so any later (stale) fetch can be
 * reconciled. Returns `"deleted"` when the row is soft-deleted.
 */
export function recordRealtimeMutation(
  scopeKey: string,
  updated: Record<string, unknown> & { id: string },
): "deleted" | "updated" {
  const m = scopeMap(scopeKey);
  const version = versionOf(updated);
  const existing = m.get(updated.id);

  // A tombstone always wins over a later-arriving edit for the same row.
  if (existing?.kind === "deleted") {
    if (!updated.deleted_at) return "deleted";
  }

  if (updated.deleted_at) {
    m.set(updated.id, { kind: "deleted", at: now(), version });
    prune(m);
    return "deleted";
  }

  if (existing && existing.kind === "patch" && existing.version > version) {
    return "updated"; // older event, ignore
  }

  const patch = extractPatch(updated);
  const mergedPatch =
    existing && existing.kind === "patch" ? { ...existing.patch, ...patch } : patch;
  m.set(updated.id, { kind: "patch", patch: mergedPatch, at: now(), version });
  prune(m);
  return "updated";
}

/** True when the row has been soft-deleted in this scope. */
export function isTombstoned(scopeKey: string, messageId: string): boolean {
  return registry.get(scopeKey)?.get(messageId)?.kind === "deleted";
}

/**
 * Re-apply every recorded realtime mutation on top of a message list. Called
 * for anything that reaches rendering (query results, older-history pages,
 * jump windows) so a stale in-flight fetch cannot restore old text or
 * resurrect a deleted row.
 */
export function reconcileMessages<T extends ReconcilableMessage>(
  scopeKey: string,
  messages: T[] | undefined,
): T[] | undefined {
  if (!messages || messages.length === 0) return messages;
  // Reaction deltas are reconciled on the same path so every list that reaches
  // rendering carries the newest realtime reactions too.
  messages = reconcileReactions(scopeKey, messages as never) as T[];
  const m = registry.get(scopeKey);
  if (!m || m.size === 0) return messages;

  let changed = false;
  const next: T[] = [];
  for (const message of messages) {
    const entry = m.get(message.id);
    if (!entry) {
      next.push(message);
      continue;
    }
    if (entry.kind === "deleted") {
      changed = true;
      continue;
    }
    const patched = { ...message, ...entry.patch } as T;
    const isSame = Object.keys(entry.patch).every(
      (key) => (message as Record<string, unknown>)[key] === entry.patch[key],
    );
    if (isSame) {
      next.push(message);
    } else {
      changed = true;
      next.push(patched);
    }
  }
  return changed ? next : messages;
}

/** Drop a scope's registry (chat unmount / thread switch). */
export function clearReconciliationScope(scopeKey: string) {
  registry.delete(scopeKey);
  clearReactionReconciliationScope(scopeKey);
}

/** Test helper. */
export function _resetReconciliationRegistry() {
  registry.clear();
}
