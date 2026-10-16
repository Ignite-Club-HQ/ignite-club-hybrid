/**
 * Chat photos upload in the background: the composer hands the page a local
 * preview URL immediately, and the send path swaps it for the stored URL just
 * before writing the message. The optimistic bubble renders the local copy, so
 * the photo appears instantly in both the composer and the thread.
 */
const pending = new Map<string, Promise<string>>();

export function registerPendingChatUpload(localUrl: string, upload: Promise<string>): void {
  pending.set(localUrl, upload);
  // Keep the entry until resolved; failures surface at send time.
  upload.catch(() => undefined);
}

export function isPendingChatUpload(url: string | null | undefined): boolean {
  return Boolean(url && pending.has(url));
}

/** Returns the stored URL for a local preview URL (waits for the upload). */
export async function resolveChatUploadUrl<T extends string | null | undefined>(url: T): Promise<T | string> {
  if (!url) return url;
  const job = pending.get(url);
  if (!job) return url;
  const stored = await job;
  return stored;
}

export function forgetPendingChatUpload(url: string | null | undefined): void {
  if (url) pending.delete(url);
}
