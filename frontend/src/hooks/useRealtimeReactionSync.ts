import { useCallback, useMemo, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  recordRealtimeReaction,
  recordRealtimeReactionDelete,
  removeReactionFromMessages,
  upsertReactionInMessages,
  type ReconcilableReaction,
} from "@/lib/chatReactionReconciliation";

type ReactionCarrier = { id: string; reactions?: ReconcilableReaction[] | null };

/**
 * Applies realtime `message_reactions` events to EVERY active message store of
 * a chat page (React Query cache + rendered `localMessages`) using the same
 * pure, idempotent helpers, and records the delta so a query response already
 * in flight cannot overwrite the newer reaction when it lands.
 *
 * Every chat type that keeps the dual-store pattern must route its reaction
 * INSERT/UPDATE/DELETE handlers through this hook — updating only the query
 * cache makes reactions invisible whenever the list renders from
 * `localMessages`.
 */
export function useRealtimeReactionSync<T extends ReactionCarrier>(opts: {
  scopeKey: string;
  queryKey: readonly unknown[];
  setLocalMessages: Dispatch<SetStateAction<T[] | undefined>>;
  /** Read the message array out of the cached query payload. */
  readMessages?: (old: any) => T[];
  /** Write the message array back into the cached query payload. */
  writeMessages?: (old: any, next: T[]) => any;
  /**
   * Reads the currently rendered messages (typically a `localMessagesRef`).
   * Supplying this enables scope enforcement: Postgres changes cannot filter
   * `message_reactions` by chat scope, so EVERY reaction in the platform
   * reaches every open chat page. Reactions whose parent message is not loaded
   * in this chat's stores are dropped instead of being recorded into this
   * scope's reconciliation registry / caches.
   */
  getLocalMessages?: () => T[] | undefined;
}) {
  const { scopeKey, queryKey, setLocalMessages, readMessages, writeMessages, getLocalMessages } = opts;
  const queryClient = useQueryClient();

  const keyToken = useMemo(() => JSON.stringify(queryKey), [queryKey]);
  const read = readMessages ?? ((old: any) => (old?.messages || []) as T[]);
  const write = writeMessages ?? ((old: any, next: T[]) => ({ ...(old || {}), messages: next }));

  // Callers commonly pass inline arrow functions (`() => localMessagesRef.current`,
  // inline `readMessages`/`writeMessages`). Those change identity on EVERY render,
  // which would churn the returned callbacks and — because chat pages list them in
  // their realtime effect dependency arrays — tear down and recreate the Postgres
  // channel on ordinary renders (observed as a chat stuck on its loading spinner
  // while the same thread request repeats). Latch them into refs so the returned
  // callbacks are referentially stable while still invoking the latest closures.
  const readRef = useRef(read);
  readRef.current = read;
  const writeRef = useRef(write);
  writeRef.current = write;
  const getLocalMessagesRef = useRef(getLocalMessages);
  getLocalMessagesRef.current = getLocalMessages;
  const setLocalMessagesRef = useRef(setLocalMessages);
  setLocalMessagesRef.current = setLocalMessages;

  // Whether scope enforcement is active is a structural decision of the caller,
  // not a per-render value; latch it once so it cannot flip callback identity.
  const scopeEnforcedRef = useRef(Boolean(getLocalMessages));
  if (getLocalMessages) scopeEnforcedRef.current = true;

  const mutateStores = useCallback(
    (mutator: (messages: T[]) => T[]) => {
      const key = JSON.parse(keyToken) as unknown[];
      queryClient.setQueryData(key, (old: any) => {
        if (!old) return old;
        return writeRef.current(old, mutator(readRef.current(old)));
      });
      setLocalMessagesRef.current((prev) => (prev ? mutator(prev) : prev));
    },
    [queryClient, keyToken],

  );

  const isKnownMessage = useCallback(
    (messageId: string) => {
      if (!messageId) return false;
      const key = JSON.parse(keyToken) as unknown[];
      const cached = queryClient.getQueryData(key);
      if (cached && readRef.current(cached).some((m) => m.id === messageId)) return true;
      return Boolean(getLocalMessagesRef.current?.()?.some((m) => m.id === messageId));
    },
    [queryClient, keyToken],
  );

  const applyRealtimeReaction = useCallback(
    (messageId: string, raw: { id: string; user_id: string; reaction_type: string }) => {
      if (!messageId || !raw?.id) return;
      if (scopeEnforcedRef.current && !isKnownMessage(messageId)) return;
      const reaction: ReconcilableReaction = {
        id: raw.id,
        user_id: raw.user_id,
        reaction_type: raw.reaction_type,
      };
      recordRealtimeReaction(scopeKey, messageId, reaction);
      mutateStores((messages) => upsertReactionInMessages(messages, messageId, reaction));
    },
    [scopeKey, mutateStores, isKnownMessage],
  );

  const applyRealtimeReactionDelete = useCallback(
    (messageId: string | null | undefined, reactionId: string) => {
      if (!reactionId) return;
      if (scopeEnforcedRef.current && messageId && !isKnownMessage(messageId)) return;
      recordRealtimeReactionDelete(scopeKey, messageId, reactionId);
      mutateStores((messages) => removeReactionFromMessages(messages, reactionId));
    },
    [scopeKey, mutateStores, isKnownMessage],
  );


  return { applyRealtimeReaction, applyRealtimeReactionDelete };
}
