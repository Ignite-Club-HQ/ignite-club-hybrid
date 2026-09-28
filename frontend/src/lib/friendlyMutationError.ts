/**
 * Detects the "notification dispatch broke a mutation" class of errors
 * (e.g. http_request_queue NULL URL, send_push_notification trigger fault)
 * and returns a user-friendly toast payload. Falls back to a generic message.
 */
export function friendlyMutationError(
  error: unknown,
  fallback: { title?: string; description: string },
): { title: string; description: string; variant: "destructive" } {
  const raw = String(
    (error as any)?.message ||
      (error as any)?.details ||
      (error as any)?.hint ||
      error ||
      "",
  );
  const isNotifyQueueIssue =
    /http_request_queue/i.test(raw) ||
    /null value in column "url"/i.test(raw) ||
    /compute_push_notification_url/i.test(raw) ||
    /send_push_notification/i.test(raw);

  if (isNotifyQueueIssue) {
    return {
      title: "We couldn't send notifications",
      description:
        "Your change couldn't be saved because the notification system is temporarily unavailable. Please try again in a moment — if it keeps happening, let an admin know.",
      variant: "destructive",
    };
  }

  return {
    title: fallback.title ?? "Error",
    description: fallback.description,
    variant: "destructive",
  };
}
