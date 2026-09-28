import { resolveEventRecipients, type EventRecipientContext } from "./eventRecipientPolicy";
import { normalizeRecipientIds } from "./reminderRecipients";

export async function persistResentEventInvites(
  client: any,
  input: {
    eventId: string;
    title: string;
    creatorId?: string | null;
    recipientContext: EventRecipientContext;
  },
): Promise<string[]> {
  const resolved = await resolveEventRecipients(client, input.recipientContext);
  const eligible = normalizeRecipientIds(resolved).filter((userId) => userId !== input.creatorId);

  const { data: existingNotifications, error: existingError } = await client
    .from("notifications")
    .select("user_id")
    .eq("type", "event_invite")
    .eq("related_id", input.eventId)
    .in("user_id", eligible.length > 0 ? eligible : ["no-match"]);
  if (existingError) throw existingError;

  const alreadyNotified = new Set(
    normalizeRecipientIds((existingNotifications ?? []).map((row: any) => row.user_id)),
  );
  const recipients = eligible.filter((userId) => !alreadyNotified.has(userId));
  if (recipients.length === 0) {
    throw new Error("All members have already been notified about this event!");
  }

  const { error: insertError } = await client.from("notifications").insert(
    recipients.map((userId) => ({
      user_id: userId,
      type: "event_invite",
      message: `You've been invited to: ${input.title}`,
      related_id: input.eventId,
      skip_push: true,
    })),
  );
  if (insertError) throw insertError;
  return recipients;
}
