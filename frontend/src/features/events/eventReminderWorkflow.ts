import {
  applyReminderCooldown,
  normalizeRecipientIds,
  resolveReminderRecipients,
} from "./reminderRecipients";
import { resolveEventRecipients, type EventRecipientContext } from "./eventRecipientPolicy";

const reminderRows = (eventId: string, title: string, recipientIds: string[]) =>
  recipientIds.map((userId) => ({
    user_id: userId,
    type: "event_reminder",
    message: `Reminder: Please RSVP for "${title}"`,
    related_id: eventId,
  }));

export async function sendBulkEventReminders(
  client: any,
  input: {
    eventId: string;
    title: string;
    recipientContext: EventRecipientContext;
    cooldownSince: string;
  },
): Promise<number> {
  const { data: existingRsvps, error: rsvpError } = await client
    .from("rsvps").select("user_id").eq("event_id", input.eventId);
  if (rsvpError) throw rsvpError;

  const responded = new Set(normalizeRecipientIds((existingRsvps ?? []).map((row: any) => row.user_id)));
  const eligible = await resolveEventRecipients(client, input.recipientContext);
  const nonResponders = eligible.filter((userId) => !responded.has(userId));
  if (nonResponders.length === 0) throw new Error("Everyone has already RSVPed!");

  const { data: existingNotifications, error: cooldownError } = await client
    .from("notifications")
    .select("user_id")
    .eq("type", "event_reminder")
    .eq("related_id", input.eventId)
    .in("user_id", nonResponders)
    .gte("created_at", input.cooldownSince);
  if (cooldownError) throw cooldownError;

  const afterCooldown = applyReminderCooldown({
    recipientIds: nonResponders,
    recentlyRemindedRows: existingNotifications,
  });
  const recipients = afterCooldown.status === "ok" ? afterCooldown.recipientIds : [];
  if (recipients.length === 0) {
    throw new Error("All non-responders were already reminded in the last 24 hours");
  }

  const { error } = await client.from("notifications").insert(reminderRows(input.eventId, input.title, recipients));
  if (error) throw error;
  return recipients.length;
}

export async function sendIndividualEventReminder(
  client: any,
  input: {
    eventId: string;
    title: string;
    displayName: string;
    cooldownSince: string;
    userId?: string;
    childId?: string;
  },
) {
  let recipientIds = normalizeRecipientIds([input.userId]);
  if (input.childId) {
    const [guardiansRes, childRes] = await Promise.all([
      client.from("child_guardians").select("guardian_id").eq("child_id", input.childId),
      client.from("children").select("parent_id").eq("id", input.childId).maybeSingle(),
    ]);
    const resolved = resolveReminderRecipients({
      userId: input.userId,
      guardians: guardiansRes.data,
      guardiansError: guardiansRes.error,
      child: childRes.data,
      childError: childRes.error,
    });
    if (resolved.status === "error") throw new Error(resolved.message);
    recipientIds = resolved.recipientIds;
  }

  if (recipientIds.length === 0) {
    throw new Error(`${input.displayName} has no linked parents to remind`);
  }

  const { data: existing, error: cooldownError } = await client
    .from("notifications")
    .select("user_id")
    .eq("type", "event_reminder")
    .eq("related_id", input.eventId)
    .in("user_id", recipientIds)
    .gte("created_at", input.cooldownSince);
  const afterCooldown = applyReminderCooldown({
    recipientIds,
    recentlyRemindedRows: existing,
    cooldownError,
  });
  if (afterCooldown.status === "error") throw new Error(afterCooldown.message);
  if (afterCooldown.recipientIds.length === 0) {
    throw new Error(`${input.displayName}${recipientIds.length > 1 ? "'s parents have" : " has"} been reminded in the last 24 hours`);
  }

  const { error } = await client.from("notifications").insert(
    reminderRows(input.eventId, input.title, afterCooldown.recipientIds),
  );
  if (error) throw error;
  return {
    displayName: input.displayName,
    count: afterCooldown.recipientIds.length,
    isChild: !!input.childId,
    recipientKey: input.userId || input.childId || input.displayName,
  };
}
