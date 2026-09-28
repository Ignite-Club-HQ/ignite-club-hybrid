import { useRef } from "react";

/**
 * One-way latch for a chat page's "show the loading skeleton" flag.
 *
 * The raw flag is derived from `localMessages` + React Query state, and both
 * can regress for a frame or two after content has already painted:
 *
 *  - the `localMessages` reset effect re-seeds from the cache store on a plain
 *    `useEffect` (post-paint) and can transiently produce a sub-threshold list;
 *  - a realtime INSERT invalidates the messages query, so `isLoading` /
 *    `messagesData` can be in-flight at that same instant.
 *
 * The combination re-raises the skeleton over a thread the user is already
 * reading — the reported "messages load, flash blank, skeleton, then appear
 * again", most often right after a new message arrives.
 *
 * Once a given thread has rendered its messages, the skeleton must never come
 * back for that thread. Switching threads (new id) resets the latch.
 */
export function useChatLoadingLatch(
  showLoading: boolean,
  threadId: string | null | undefined,
): boolean {
  const shownThreadRef = useRef<string | null>(null);
  const key = threadId ?? null;

  if (shownThreadRef.current !== null && shownThreadRef.current !== key) {
    shownThreadRef.current = null;
  }

  if (!showLoading) {
    if (key !== null) shownThreadRef.current = key;
    return false;
  }

  // Already painted this thread — keep the content mounted.
  if (key !== null && shownThreadRef.current === key) return false;

  return true;
}
