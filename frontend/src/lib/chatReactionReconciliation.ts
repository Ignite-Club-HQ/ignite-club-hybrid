/**
 * Single source of truth for reconciling realtime `message_reactions`
 * mutations across BOTH stores a chat page keeps:
 *
 *   1. the React Query cache (`["team-messages", teamId]` and friends)
 *   2. the rendered `localMessages` state
 *
 * Why this exists
 * ---------------
 * Every chat page used to apply reaction INSERT/UPDATE/DELETE events to the
 * React Query cache only. When a message was rendered from `localMessages`
 * (the common case for realtime arrivals, cached cold starts and jump
 * windows), a reaction that landed straight after its message silently never
 * appeared: the two stores disagreed and nothing forced them back together.
 *
 * On top of that, a query response that was already in flight when the
 * reaction arrived would resolve *after* it and overwrite the fresh reaction
 * with a pre-reaction snapshot. So, exactly like message edits/soft-deletes
 * (see `chatMessageReconciliation`), we keep a short-lived delta registry per
 * chat scope and re-apply it to every list that flows into rendering.
 *
 * The registry is not a third source of truth: it only holds deltas from
 * realtime reaction events and is applied on top of whatever the cache or a
 * fetch produced. All operations are pure and idempotent — replaying the same
 * event any number of times yields the same list.
 */

export type ReconcilableReaction = {
  id: string;
  user_id: string;
  reaction_type: string;
};

type ReactionCarrier = {
  id: string;
  reactions?: ReconcilableReaction[] | null;
};

type Delta =
  | { kind: "upsert"; reaction: ReconcilableReaction; at: number }
  | { kind: "delete"; at: number };

const REGISTRY_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_MESSAGES_PER_SCOPE = 500;

/** scopeKey -> messageId -> reactionId -> delta */
const registry = new Map<string, Map<string, Map<string, Delta>>>();

const now = () => Date.now();

const isTemp = (id: string) => id.startsWith("temp-");

/* ------------------------------------------------------------------ */
/* Pure list operations                                                */
/* ------------------------------------------------------------------ */

/**
 * Insert or update a persisted reaction on one message.
 *
 * - Dedupes by reaction id, so repeated realtime deliveries are no-ops.
 * - Replaces a matching optimistic `temp-` reaction from the same user
 *   instead of leaving a duplicate behind.
 * - Never touches reactions belonging to other users.
 * - Returns the same array identity when nothing changed.
 */
export function upsertReactionInMessages<T extends ReactionCarrier>(
  messages: T[],
  messageId: string,
  reaction: ReconcilableReaction,
): T[] {
  let changed = false;
  const next = messages.map((message) => {
    if (message.id !== messageId) return message;
    const current = message.reactions ?? [];

    const existingIdx = current.findIndex((r) => r.id === reaction.id);
    if (existingIdx !== -1) {
      const existing = current[existingIdx];
      if (
        existing.user_id === reaction.user_id &&
        existing.reaction_type === reaction.reaction_type
      ) {
        return message;
      }
      const reactions = [...current];
      reactions[existingIdx] = reaction;
      changed = true;
      return { ...message, reactions } as T;
    }

    // Drop this user's optimistic placeholder(s) and any earlier reaction row
    // of theirs (one reaction per user per message), keep everyone else's.
    const retained = current.filter(
      (r) => !(r.user_id === reaction.user_id && (isTemp(r.id) || !isTemp(reaction.id))),
    );
    changed = true;
    return { ...message, reactions: [...retained, reaction] } as T;
  });
  return changed ? next : messages;
}

/**
 * Remove a reaction by id from whichever message carries it.
 * Idempotent — returns the same array identity when absent.
 */
export function removeReactionFromMessages<T extends ReactionCarrier>(
  messages: T[],
  reactionId: string,
): T[] {
  let changed = false;
  const next = messages.map((message) => {
    const current = message.reactions ?? [];
    if (!current.some((r) => r.id === reactionId)) return message;
    changed = true;
    return { ...message, reactions: current.filter((r) => r.id !== reactionId) } as T;
  });
  return changed ? next : messages;
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

const scopeMap = (scopeKey: string) => {
  let m = registry.get(scopeKey);
  if (!m) {
    m = new Map();
    registry.set(scopeKey, m);
  }
  return m;
};

const prune = (m: Map<string, Map<string, Delta>>) => {
  const cutoff = now() - REGISTRY_TTL_MS;
  for (const [messageId, deltas] of m) {
    for (const [reactionId, delta] of deltas) {
      if (delta.at < cutoff) deltas.delete(reactionId);
    }
    if (deltas.size === 0) m.delete(messageId);
  }
  while (m.size > MAX_MESSAGES_PER_SCOPE) {
    const oldest = m.keys().next();
    if (oldest.done) break;
    m.delete(oldest.value);
  }
};

/** Record a realtime reaction INSERT/UPDATE for later re-application. */
export function recordRealtimeReaction(
  scopeKey: string,
  messageId: string,
  reaction: ReconcilableReaction,
) {
  if (!messageId || !reaction?.id || isTemp(reaction.id)) return;
  const m = scopeMap(scopeKey);
  let deltas = m.get(messageId);
  if (!deltas) {
    deltas = new Map();
    m.set(messageId, deltas);
  }
  // A delete always wins over a later-arriving upsert for the same row: the
  // row no longer exists server-side, so re-adding it would be a ghost.
  if (deltas.get(reaction.id)?.kind === "delete") return;
  deltas.set(reaction.id, { kind: "upsert", reaction, at: now() });
  prune(m);
}

/**
 * Record a realtime reaction DELETE. `messageId` may be unknown (Postgres
 * DELETE payloads only carry the replica identity), in which case the
 * tombstone is recorded scope-wide.
 */
export function recordRealtimeReactionDelete(
  scopeKey: string,
  messageId: string | null | undefined,
  reactionId: string,
) {
  if (!reactionId || isTemp(reactionId)) return;
  const m = scopeMap(scopeKey);
  const key = messageId || "*";
  let deltas = m.get(key);
  if (!deltas) {
    deltas = new Map();
    m.set(key, deltas);
  }
  deltas.set(reactionId, { kind: "delete", at: now() });
  prune(m);
}

/**
 * Re-apply every recorded reaction delta on top of a message list, so a query
 * response that resolves after the realtime event cannot overwrite it.
 */
export function reconcileReactions<T extends ReactionCarrier>(
  scopeKey: string,
  messages: T[] | undefined,
): T[] | undefined {
  if (!messages || messages.length === 0) return messages;
  const m = registry.get(scopeKey);
  if (!m || m.size === 0) return messages;

  let result = messages;

  // Scope-wide tombstones first (DELETE payloads without a message id).
  const wildcard = m.get("*");
  if (wildcard) {
    for (const [reactionId, delta] of wildcard) {
      if (delta.kind === "delete") result = removeReactionFromMessages(result, reactionId);
    }
  }

  for (const [messageId, deltas] of m) {
    if (messageId === "*") continue;
    for (const [reactionId, delta] of deltas) {
      result =
        delta.kind === "delete"
          ? removeReactionFromMessages(result, reactionId)
          : upsertReactionInMessages(result, messageId, delta.reaction);
    }
  }

  return result;
}

/** Drop a scope's reaction deltas (chat unmount / thread switch). */
export function clearReactionReconciliationScope(scopeKey: string) {
  registry.delete(scopeKey);
}

/** Test helper. */
export function _resetReactionReconciliationRegistry() {
  registry.clear();
}

/**
 * Group/operational chats keep a FLAT top-level reactions array in their query
 * payload (rather than embedding reactions on each message). Re-apply the same
 * recorded deltas to that shape so a late query response can't drop a newer
 * realtime reaction there either.
 */
export function reconcileFlatReactions<
  T extends ReconcilableReaction & Record<string, unknown>,
>(
  scopeKey: string,
  flat: T[],
  getMessageId: (reaction: T) => string | null | undefined,
  buildRow: (messageId: string, reaction: ReconcilableReaction) => T,
): T[] {
  const m = registry.get(scopeKey);
  if (!m || m.size === 0) return flat;

  let result = flat;
  let changed = false;

  const drop = (reactionId: string) => {
    if (!result.some((r) => r.id === reactionId)) return;
    result = result.filter((r) => r.id !== reactionId);
    changed = true;
  };

  for (const [messageId, deltas] of m) {
    for (const [reactionId, delta] of deltas) {
      if (delta.kind === "delete") {
        drop(reactionId);
        continue;
      }
      if (messageId === "*") continue;
      const existing = result.find((r) => r.id === reactionId);
      if (
        existing &&
        existing.user_id === delta.reaction.user_id &&
        existing.reaction_type === delta.reaction.reaction_type
      ) {
        continue;
      }
      // One reaction per user per message: replace the user's stale row.
      result = result.filter(
        (r) =>
          r.id !== reactionId &&
          !(r.user_id === delta.reaction.user_id && getMessageId(r) === messageId),
      );
      result = [...result, buildRow(messageId, delta.reaction)];
      changed = true;
    }
  }

  return changed ? result : flat;
}
