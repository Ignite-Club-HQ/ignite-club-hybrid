import { useEffect, useCallback, useMemo, useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds, selectCachedProfileById } from "@/lib/profileCache";

type MessageType = "team" | "club" | "group" | "broadcast" | "dm" | "club_admin";

export interface ReaderInfo {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

const getMessageIdField = (type: MessageType) => {
  switch (type) {
    case "team": return "team_message_id";
    case "club": return "club_message_id";
    case "group": return "group_message_id";
    case "broadcast": return "broadcast_message_id";
    case "dm": return "direct_message_id";
    case "club_admin": return "club_admin_message_id";
  }
};

// Debounce delay in ms
const DEBOUNCE_DELAY = 1000;

// Session-level cache for messages already marked as read by current user.
// Key format: `${userId}:${messageType}:${msgId}` so a second user on the
// same device (or after sign-in switch) does not inherit the previous user's
// skip-set and silently fail to write their own read row.
const markedAsReadCache = new Set<string>();

// Clear the in-memory skip-set whenever the auth user changes so reads
// always get written for the freshly signed-in user.
let _authListenerInstalled = false;
function ensureAuthListener() {
  if (_authListenerInstalled) return;
  _authListenerInstalled = true;
  try {
    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" || event === "SIGNED_IN" || event === "USER_UPDATED") {
        markedAsReadCache.clear();
      }
    });
  } catch {}
}

// Local storage cache for read counts
const READ_COUNTS_CACHE_KEY = "message_read_counts";
const READ_COUNTS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getReadCountsFromCache(contextId: string): Record<string, number> | null {
  try {
    const cached = localStorage.getItem(`${READ_COUNTS_CACHE_KEY}_${contextId}`);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > READ_COUNTS_CACHE_TTL) {
      localStorage.removeItem(`${READ_COUNTS_CACHE_KEY}_${contextId}`);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function setReadCountsToCache(contextId: string, counts: Record<string, number>) {
  try {
    localStorage.setItem(
      `${READ_COUNTS_CACHE_KEY}_${contextId}`,
      JSON.stringify({ data: counts, timestamp: Date.now() })
    );
  } catch {}
}

/**
 * Compute read frontier: for each reader, find the latest message they've read
 * (based on message order in the messageIds array).
 * Returns a map: messageId -> array of readers whose frontier is that message.
 */
function computeReadFrontier(
  readersByMessage: Record<string, ReaderInfo[]>,
  messageIds: string[],
  currentUserId?: string
): Record<string, ReaderInfo[]> {
  const messageIndexMap = new Map<string, number>();
  messageIds.forEach((id, idx) => messageIndexMap.set(id, idx));

  const readerFrontier = new Map<string, { messageId: string; index: number; info: ReaderInfo }>();

  for (const [msgId, readers] of Object.entries(readersByMessage)) {
    const msgIndex = messageIndexMap.get(msgId);
    if (msgIndex === undefined) continue;

    for (const reader of readers) {
      if (reader.user_id === currentUserId) continue;

      const existing = readerFrontier.get(reader.user_id);
      if (!existing || msgIndex > existing.index) {
        readerFrontier.set(reader.user_id, { messageId: msgId, index: msgIndex, info: reader });
      }
    }
  }

  const frontier: Record<string, ReaderInfo[]> = {};
  for (const { messageId, info } of readerFrontier.values()) {
    if (!frontier[messageId]) frontier[messageId] = [];
    frontier[messageId].push(info);
  }

  return frontier;
}

export function useMessageReads(
  messageType: MessageType,
  contextId: string,
  messageIds: string[],
  currentUserId?: string
) {
  const messageIdField = getMessageIdField(messageType);

  useEffect(() => {
    ensureAuthListener();
  }, []);

  const [readCounts, setReadCounts] = useState<Record<string, number>>(() =>
    getReadCountsFromCache(contextId) || {}
  );

  const [readersByMessage, setReadersByMessage] = useState<Record<string, ReaderInfo[]>>({});

  const readFrontier = useMemo(
    () => computeReadFrontier(readersByMessage, messageIds, currentUserId),
    [readersByMessage, messageIds, currentUserId]
  );

  const pendingReadsRef = useRef<Set<string>>(new Set());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageIdsSetRef = useRef<Set<string>>(new Set());
  const messageIdsRef = useRef<string[]>([]);

  useEffect(() => {
    messageIdsSetRef.current = new Set(messageIds);
    messageIdsRef.current = messageIds;
  }, [messageIds]);

  const messageIdsKey = useMemo(() => {
    if (messageIds.length === 0) return "";
    return `${messageIds.length}:${messageIds[0]}:${messageIds[messageIds.length - 1]}`;
  }, [messageIds]);

  // Reconcile: full refetch of the visible window. Overwrites the cache
  // rather than merging so dropped realtime events and stale entries are
  // healed instead of accumulating.
  const reconcileRef = useRef<() => Promise<void>>(async () => {});
  reconcileRef.current = async () => {
    const ids = messageIdsRef.current;
    if (ids.length === 0) return;

    const { data, error } = await (supabase
      .from("message_reads")
      .select(`${messageIdField}, user_id`) as any)
      .in(messageIdField, ids);

    if (error) {
      console.error("Error fetching message reads:", error);
      return;
    }

    const userIds = new Set<string>();
    const readsData: Array<{ msgId: string; userId: string }> = [];

    for (const read of data || []) {
      const msgId = (read as any)[messageIdField] as string | null;
      const userId = (read as any).user_id as string;
      if (!msgId) continue;
      readsData.push({ msgId, userId });
      userIds.add(userId);

      if (currentUserId && userId === currentUserId) {
        markedAsReadCache.add(`${currentUserId}:${messageType}:${msgId}`);
      }
    }

    const profileMap = new Map<string, { display_name: string | null; avatar_url: string | null }>();
    if (userIds.size > 0) {
      const { data: profiles } = await selectCachedProfilesByIds(Array.from(userIds));
      for (const p of profiles || []) {
        profileMap.set(p.id, { display_name: p.display_name, avatar_url: p.avatar_url });
      }
    }

    const readers: Record<string, Map<string, ReaderInfo>> = {};
    for (const { msgId, userId } of readsData) {
      if (!readers[msgId]) readers[msgId] = new Map();
      const profile = profileMap.get(userId);
      readers[msgId].set(userId, {
        user_id: userId,
        display_name: profile?.display_name || null,
        avatar_url: profile?.avatar_url || null,
      });
    }

    const counts: Record<string, number> = {};
    const readersMap: Record<string, ReaderInfo[]> = {};
    for (const [msgId, readerMap] of Object.entries(readers)) {
      counts[msgId] = readerMap.size;
      readersMap[msgId] = Array.from(readerMap.values());
    }

    // Overwrite (not merge) so removed/zeroed entries are healed.
    setReadCounts(counts);
    setReadCountsToCache(contextId, counts);
    setReadersByMessage(readersMap);
  };

  // Fetch initial read counts when the visible window changes.
  useEffect(() => {
    if (messageIds.length === 0) return;
    const cached = getReadCountsFromCache(contextId);
    if (cached) {
      setReadCounts(prev => ({ ...prev, ...cached }));
    }
    reconcileRef.current();
  }, [messageIdsKey, messageIdField, contextId, currentUserId, messageType]);

  // Mark messages as read (batched)
  const markAsReadMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!currentUserId || ids.length === 0) return;

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) return;

      const { error } = await (supabase as any).rpc("mark_message_reads", {
        _message_type: messageType,
        _message_ids: ids,
      });

      if (error && error.code !== "23505" && !error.message?.includes("duplicate")) {
        console.error("Error marking messages as read:", error);
      }
    },
    onMutate: (ids: string[]) => {
      if (!currentUserId) return;
      // In-memory optimistic bump only. We deliberately do NOT write the
      // optimistic count to the shared localStorage cache because that
      // cache is keyed by contextId (not user) and would leak the current
      // user's optimistic +1 to the next user on the same device.
      setReadCounts((prev) => {
        const updated = { ...prev };
        for (const id of ids) {
          updated[id] = (updated[id] || 0) + 1;
        }
        return updated;
      });
    },
  });

  const flushPendingReads = useCallback(() => {
    if (pendingReadsRef.current.size === 0 || !currentUserId) return;
    const idsToMark = Array.from(pendingReadsRef.current);
    pendingReadsRef.current.clear();
    markAsReadMutation.mutate(idsToMark);
  }, [currentUserId, markAsReadMutation]);

  const markMessagesAsRead = useCallback(
    (visibleMessageIds: string[]) => {
      if (!currentUserId || visibleMessageIds.length === 0) return;
      const newIds = visibleMessageIds.filter(
        id => !markedAsReadCache.has(`${currentUserId}:${messageType}:${id}`)
      );
      if (newIds.length === 0) return;

      for (const id of newIds) {
        pendingReadsRef.current.add(id);
        markedAsReadCache.add(`${currentUserId}:${messageType}:${id}`);
      }

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(flushPendingReads, DEBOUNCE_DELAY);
    },
    [currentUserId, messageType, flushPendingReads]
  );

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        if (pendingReadsRef.current.size > 0 && currentUserId) {
          flushPendingReads();
        }
      }
    };
  }, [currentUserId, flushPendingReads]);

  // Realtime: subscribe ONCE per (messageType, contextId). The previous
  // implementation added messageIdsKey to the dep array, which rebuilt the
  // channel every time the visible window changed and silently dropped any
  // INSERTs that arrived mid-rebuild. On every (re)subscribe we run a full
  // reconciliation fetch so any missed reads are healed.
  useEffect(() => {
    if (!contextId) return;

    const scopeKey = messageType === "broadcast" ? "broadcast" : contextId;

    const channel = supabase
      .channel(`message-reads-${messageType}-${contextId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reads",
          filter: `scope_key=eq.${scopeKey}`,
        },
        async (payload) => {
          const newRead = payload.new as Record<string, any>;
          const msgId = newRead[messageIdField] as string | null;
          const userId = newRead.user_id as string;
          if (!msgId || !messageIdsSetRef.current.has(msgId)) return;

          setReadCounts((prev) => {
            const updated = { ...prev, [msgId]: (prev[msgId] || 0) + 1 };
            setReadCountsToCache(contextId, updated);
            return updated;
          });

          if (userId !== currentUserId) {
            const { data: profile } = await selectCachedProfileById(userId);

            setReadersByMessage((prev) => {
              const existing = prev[msgId] || [];
              if (existing.some(r => r.user_id === userId)) return prev;
              return {
                ...prev,
                [msgId]: [...existing, {
                  user_id: userId,
                  display_name: profile?.display_name || null,
                  avatar_url: profile?.avatar_url || null,
                }],
              };
            });
          }
        }
      )
      .subscribe((status) => {
        // On initial subscribe AND every reconnect, reconcile the window so
        // any reads we missed while the channel was down are picked up.
        if (status === "SUBSCRIBED") {
          reconcileRef.current();
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [messageType, contextId, messageIdField, currentUserId]);


  return {
    readCounts,
    readFrontier,
    markMessagesAsRead,
  };
}
