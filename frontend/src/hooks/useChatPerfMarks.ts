import { useEffect } from "react";
import { mark as coldMark } from "@/lib/coldStartMarks";

/**
 * Emits `chat_mount` once when a chat page mounts, `chat_fetch` the first
 * time its messages queryFn actually executes, and `chat_query_return` the
 * first time that query resolves. Together these attribute cold-start
 * latency between route landing → RPC send → RPC return → first paint.
 *
 * Call `markChatFetch()` as the first line of the messages queryFn.
 */
export function useChatPerfMarks(messagesData: unknown): void {
  useEffect(() => {
    coldMark("chat_mount");
  }, []);

  useEffect(() => {
    if (messagesData !== undefined && messagesData !== null) {
      coldMark("chat_query_return");
    }
  }, [messagesData]);
}

/**
 * Mark the moment the messages queryFn began running. First-write wins, so
 * subsequent invalidations don't overwrite the initial cold-start value.
 */
export function markChatFetch(): void {
  coldMark("chat_fetch");
}

