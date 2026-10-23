const FRIENDLY_NETWORK_MESSAGE =
  "Couldn't reach the server — check your internet connection and try again.";

// Raw connectivity errors from fetch / Android WebView / OkHttp that should
// never be shown to users verbatim (e.g. "Unable to resolve host ...").
const NETWORK_ERROR_PATTERNS = [
  /unable to resolve host/i,
  /failed to fetch/i,
  /network ?error/i,
  /network request failed/i,
  /err_internet_disconnected/i,
  /err_network_changed/i,
  /err_name_not_resolved/i,
  /err_address_unreachable/i,
  /dns/i,
  /no address associated with hostname/i,
  /connection (refused|reset|aborted|timed out)/i,
  /socket (closed|timeout)/i,
  /timeout/i,
  /offline/i,
];

const toFriendlyIfNetworkError = (message: string): string => {
  if (!message) return message;
  return NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(message))
    ? FRIENDLY_NETWORK_MESSAGE
    : message;
};

const extractRawMessage = (error: unknown): string => {
  if (error instanceof Error) {
    if (error.message) return error.message;

    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause !== undefined) {
      const causeMessage = extractRawMessage(cause);
      if (causeMessage) return causeMessage;
    }

    return error.name || "";
  }

  if (typeof error === "string") return error;

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const preferredKeys = ["message", "errorMessage", "localizedDescription", "reason", "details", "code"];

    const parts = preferredKeys
      .map((key) => {
        const value = record[key];
        if (typeof value === "string") return `${key}: ${value}`;
        if (typeof value === "number" || typeof value === "boolean") return `${key}: ${String(value)}`;
        return null;
      })
      .filter(Boolean) as string[];

    if (parts.length > 0) return parts.join(" | ");

    try {
      const serialized = JSON.stringify(record);
      if (serialized && serialized !== "{}") {
        return serialized.length > 220 ? `${serialized.slice(0, 220)}…` : serialized;
      }
    } catch {
      // no-op
    }
  }

  return "";
};

export const getReadableUploadError = (error: unknown): string =>
  toFriendlyIfNetworkError(extractRawMessage(error));

export const isCancelledSelectionError = (error: unknown): boolean => {
  // Use the raw message so the network rewrite can't mask cancellation text.
  const message = extractRawMessage(error).toLowerCase();
  return (
    message.includes("cancel") ||
    message.includes("cancelled") ||
    message.includes("canceled") ||
    message.includes("user denied") ||
    message.includes("user rejected") ||
    message.includes("dismissed") ||
    message.includes("photos app") ||
    message.includes("picker was cancelled") ||
    message.includes("no image selected")
  );
};
