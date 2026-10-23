/** Turn a raw poll save error into something a person can act on. */
export function pollErrorMessage(error: unknown, fallback: string): string {
  const msg = (error as { message?: string } | null)?.message || "";
  const code = (error as { code?: string } | null)?.code;
  if (code === "42501" || /row-level security|permission denied/i.test(msg)) {
    return "You don't have permission to do this in this chat.";
  }
  if (/failed to fetch|network/i.test(msg)) return "No connection — please try again.";
  return msg || fallback;
}
