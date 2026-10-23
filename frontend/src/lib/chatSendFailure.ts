/** Translate recognized send refusals without displaying raw transport payloads. */
export function chatSendFailureReason(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  if (/Account admission denied or unavailable/i.test(message)) return "Your account access could not be verified.";
  if (/Account removal fenced|operation capacity reached/i.test(message)) return "Your account is temporarily unable to send.";
  if (/Conversation access forbidden|Conversation authorization changed|Club chat authorization changed/i.test(message)) return "Your access to this chat could not be verified.";
  if (/Conversation not found/i.test(message)) return "This chat could not be found.";
  if (/Only group admins can post|Competition chat admin required|App admin required/i.test(message)) return "Only this chat’s administrators can send messages.";
  if (/Direct message blocked/i.test(message)) return "Messaging between these accounts is blocked.";
  if (/Invalid message|Invalid attachment/i.test(message)) return "The message or attachment was not accepted.";
  if (/delegation.*expired|identity.*expired|signature.*expired/i.test(message)) return "Your sign-in has expired. Sign in again.";
  if (/fetch|network|timeout|timed out|IC0406|IC0503/i.test(message)) return "The message could not be confirmed. Check your connection and chat before sending again.";
  return undefined;
}