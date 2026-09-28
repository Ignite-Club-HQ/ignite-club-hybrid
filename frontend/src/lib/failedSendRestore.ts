/**
 * Shared failed-send recovery helpers for every chat surface.
 *
 * Chat composers clear immediately on Send (optimistic UX). When the online
 * insert genuinely fails we must:
 *  - remove ONLY that mutation's optimistic row (never a whole-cache snapshot
 *    rollback, which would discard concurrent sends / realtime rows), and
 *  - restore the unsent text / attachment / reply target / pending poll ONLY
 *    when the user has not entered newer content since pressing Send.
 *
 * Offline-queued sends are NOT failures and must never be restored.
 */

export interface FailedSendContext<TReply = unknown> {
  /** Collision-resistant, mutation-specific optimistic row id. */
  tempId: string;
  /** Text exactly as submitted, with any poll markup already stripped. */
  sentText: string;
  sentImageUrl: string | null;
  previousReplyTarget: TReply | null;
  /** Poll attached to the failed send (surfaces that support polls). */
  pendingPollId: string | null;
  /**
   * `Date.now()` captured once in `onMutate`, i.e. when this send attempt
   * started. Used to bound the authoritative-match window so an OLDER message
   * with identical text can never confirm a new send.
   */
  sentAtMs: number;
}

/** Mutation-specific temp id — `Date.now()` alone collides on rapid sends. */
export function createSendTempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const POLL_MARKUP_RE = /\s*\[poll:([^\]]+)\]\s*/;

/**
 * Splits `"caption [poll:abc]"` into its composer parts so a failed poll send
 * restores the poll chip instead of leaking `[poll:...]` as ordinary text.
 */
export function splitPollMarkup(text: string): { baseText: string; pollId: string | null } {
  const match = text.match(POLL_MARKUP_RE);
  if (!match) return { baseText: text, pollId: null };
  return {
    baseText: text.replace(POLL_MARKUP_RE, " ").trim(),
    pollId: match[1] || null,
  };
}

export interface RestoreComposerOptions<TReply> {
  context: FailedSendContext<TReply> | undefined | null;
  setText: (updater: (current: string) => string) => void;
  setImage?: (updater: (current: string | null) => string | null) => void;
  setReply?: (updater: (current: TReply | null) => TReply | null) => void;
  setPoll?: (updater: (current: string | null) => string | null) => void;
}

/**
 * Conditionally restores composer state after a failed send. Every field uses
 * a functional setter and only fills a still-empty slot, so newer user input
 * (typed text, a newer attachment/reply/poll selection) is never overwritten.
 */
export function restoreFailedSendComposer<TReply>({
  context,
  setText,
  setImage,
  setReply,
  setPoll,
}: RestoreComposerOptions<TReply>): void {
  if (!context) return;

  if (context.sentText) {
    setText((current) => (current.trim().length === 0 ? context.sentText : current));
  }
  if (context.sentImageUrl && setImage) {
    setImage((current) => current ?? context.sentImageUrl);
  }
  if (context.previousReplyTarget && setReply) {
    setReply((current) => current ?? context.previousReplyTarget);
  }
  if (context.pendingPollId && setPoll) {
    setPoll((current) => current ?? context.pendingPollId);
  }
}

/**
 * How far before the mutation start an authoritative row's `created_at` may
 * sit and still be considered "this send". Covers server/client clock skew
 * only — deliberately small so an older identical message never matches.
 */
export const AUTHORITATIVE_MATCH_SKEW_MS = 10_000;

/** Upper bound: a row created long after the attempt is a different send. */
export const AUTHORITATIVE_MATCH_FORWARD_MS = 120_000;

export interface AuthoritativeMatchArgs {
  authorId?: string | null;
  /** Exact text as submitted to the database (poll markup included). */
  text: string;
  imageUrl?: string | null;
  replyToId?: string | null;
  /** `FailedSendContext.sentAtMs`. Missing/invalid ⇒ no match (fail safe). */
  sentAtMs?: number | null;
}

function sameOptionalId(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null);
}

/**
 * True when an authoritative (non-temp) message plausibly corresponding to
 * THIS send attempt already exists — i.e. the insert actually landed and
 * arrived via Realtime despite the request reporting an error.
 *
 * Matching requires every immutable send attribute to agree (author, exact
 * text, attachment URL, reply target) AND a `created_at` inside a bounded
 * window around the mutation start. Text alone is never sufficient: a user
 * re-sending identical text must not be confirmed by their older message.
 */
export function authoritativeMessageExists(
  messages:
    | Array<{
        id: string;
        author_id?: string | null;
        text?: string | null;
        image_url?: string | null;
        reply_to_id?: string | null;
        created_at?: string | null;
      }>
    | null
    | undefined,
  args: AuthoritativeMatchArgs,
): boolean {
  if (!messages?.length) return false;

  const sentAtMs = args.sentAtMs;
  if (typeof sentAtMs !== "number" || !Number.isFinite(sentAtMs)) return false;

  const lowerBound = sentAtMs - AUTHORITATIVE_MATCH_SKEW_MS;
  const upperBound = sentAtMs + AUTHORITATIVE_MATCH_FORWARD_MS;

  return messages.some((m) => {
    if (!m?.id || m.id.startsWith("temp-") || m.id.startsWith("queued-")) return false;
    if (args.authorId && m.author_id !== args.authorId) return false;
    if ((m.text ?? "") !== args.text) return false;
    if (!sameOptionalId(m.image_url, args.imageUrl)) return false;
    if (!sameOptionalId(m.reply_to_id, args.replyToId)) return false;

    const createdMs = m.created_at ? Date.parse(m.created_at) : NaN;
    if (!Number.isFinite(createdMs)) return false;
    return createdMs >= lowerBound && createdMs <= upperBound;
  });
}

/* ------------------------------------------------------------------ *
 * Concurrent-send isolation
 *
 * Replacing an optimistic row with its authoritative counterpart (in a
 * mutation's `onSuccess` or in the Realtime INSERT handler) must remove ONLY
 * the temp row that corresponds to THAT payload. Blanket `!id.startsWith("temp-")`
 * filters — or "first temp row by the same author" lookups — silently discard a
 * second, still-pending optimistic send made moments earlier.
 * ------------------------------------------------------------------ */

export interface OptimisticRowLike {
  id: string;
  author_id?: string | null;
  text?: string | null;
  image_url?: string | null;
  reply_to_id?: string | null;
}

/** Payload of the authoritative row that just landed (insert result / Realtime). */
export interface AuthoritativeRowLike {
  author_id?: string | null;
  text?: string | null;
  image_url?: string | null;
  reply_to_id?: string | null;
}

function optimisticRowMatches(row: OptimisticRowLike, authoritative: AuthoritativeRowLike): boolean {
  if (!row?.id || !row.id.startsWith("temp-")) return false;
  if ((row.author_id ?? null) !== (authoritative.author_id ?? null)) return false;
  if ((row.text ?? "") !== (authoritative.text ?? "")) return false;
  if (!sameOptionalId(row.image_url, authoritative.image_url)) return false;
  if (!sameOptionalId(row.reply_to_id, authoritative.reply_to_id)) return false;
  return true;
}

/**
 * Index of the single optimistic row superseded by `authoritative`, or -1.
 * Matches on every immutable send attribute so a concurrent optimistic send
 * with different content (or a different reply target) is never consumed.
 */
export function findSupersededOptimisticIndex<T extends OptimisticRowLike>(
  rows: T[] | null | undefined,
  authoritative: AuthoritativeRowLike,
): number {
  if (!rows?.length) return -1;
  return rows.findIndex((row) => optimisticRowMatches(row, authoritative));
}

/**
 * Removes exactly one superseded optimistic row (the first payload-identical
 * match). All other temp rows — concurrent in-flight sends — survive.
 */
export function dropSupersededOptimisticRow<T extends OptimisticRowLike>(
  rows: T[] | null | undefined,
  authoritative: AuthoritativeRowLike,
): T[] {
  if (!rows?.length) return rows ? [...rows] : [];
  const index = findSupersededOptimisticIndex(rows, authoritative);
  if (index === -1) return [...rows];
  return [...rows.slice(0, index), ...rows.slice(index + 1)];
}
