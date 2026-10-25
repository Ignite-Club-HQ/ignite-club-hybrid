const PREFIX = "ignite-feedback-v2:";
/** Version the field interpretation without rewriting ambiguous legacy rows. */
export function encodeFeedbackMessage(description: string) {
  return PREFIX + JSON.stringify({ description: description.trim() || null });
}
export function decodeFeedbackFields(title: string | undefined, message: string) {
  if (message.startsWith(PREFIX)) {
    try {
      const value: unknown = JSON.parse(message.slice(PREFIX.length));
      if (value && typeof value === "object" && "description" in value) {
        const description = value.description;
        if (description === null || typeof description === "string") return { title: title ?? "Feedback", description };
      }
    } catch { /* preserve unrecognized content */ }
  }
  // The previous ICP producer stored entered title in message and description in title.
  return { title: message, description: title ?? null };
}