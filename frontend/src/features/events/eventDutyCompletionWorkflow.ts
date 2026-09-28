export class DutyNotificationPartialError extends Error {
  dutyCommitted = true as const;
  constructor(public underlying: string) {
    super(underlying);
    this.name = "DutyNotificationPartialError";
  }
}

export async function completeEventDuty(
  client: any,
  input: {
    dutyId: string;
    eventId: string;
    completedAt: string;
    actorId?: string | null;
    memberName: string;
    dutyName?: string | null;
    eventTitle?: string | null;
    teamId?: string | null;
    clubId?: string | null;
  },
): Promise<{ outcome: "completed" | "noop" }> {
  const { data: updatedDuty, error } = await client
    .from("duties")
    .update({ status: "completed", completed_at: input.completedAt })
    .eq("id", input.dutyId)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!updatedDuty) return { outcome: "noop" };

  if (!input.dutyName || !input.eventTitle) return { outcome: "completed" };

  const roleQuery = input.teamId
    ? client.from("user_roles").select("user_id").eq("team_id", input.teamId)
        .in("role", ["team_admin", "coach", "club_admin", "committee_member"])
    : client.from("user_roles").select("user_id").eq("club_id", input.clubId)
        .in("role", ["club_admin", "committee_member"]);
  const { data: admins, error: adminsError } = await roleQuery;
  if (adminsError) throw new DutyNotificationPartialError(adminsError.message);

  const recipientIds = Array.from(new Set(
    (admins ?? []).map((row: any) => row.user_id)
      .filter((userId: any): userId is string => !!userId && userId !== input.actorId),
  ));
  if (recipientIds.length === 0) return { outcome: "completed" };

  const message = `${input.memberName} completed ${input.dutyName} for ${input.eventTitle}`;
  const { error: notificationError } = await client.from("notifications").insert(
    recipientIds.map((userId) => ({
      user_id: userId,
      type: "duty_completed",
      message,
      related_id: input.eventId,
    })),
  );
  if (notificationError && notificationError.code !== "23505") {
    throw new DutyNotificationPartialError(notificationError.message);
  }
  return { outcome: "completed" };
}
