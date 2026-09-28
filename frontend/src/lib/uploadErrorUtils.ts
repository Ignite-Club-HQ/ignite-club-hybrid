export const getReadableUploadError = (error: unknown): string => {
  if (error instanceof Error) {
    if (error.message) return error.message;

    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause !== undefined) {
      const causeMessage = getReadableUploadError(cause);
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

export const isCancelledSelectionError = (error: unknown): boolean => {
  const message = getReadableUploadError(error).toLowerCase();
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
