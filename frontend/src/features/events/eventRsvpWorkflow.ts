export type RsvpStatus = "going" | "maybe" | "not_going";

export type PersonalRsvpInput = {
  eventId: string;
  userId: string;
  status: RsvpStatus;
  notes: string | null;
  existingRsvpId: string | null;
  online: boolean;
};

export type ChildRsvpInput = {
  eventId: string;
  guardianUserId: string;
  childId: string;
  status: RsvpStatus;
  existingRsvpId: string | null;
};

export type RsvpWriteResult = { queued: boolean; rsvpId: string | null };

export async function savePersonalRsvp(
  client: any,
  input: PersonalRsvpInput,
  enqueue: (entry: {
    eventId: string;
    userId: string;
    status: RsvpStatus;
    notes: string | null;
    existingRsvpId: string | null;
  }) => void,
): Promise<RsvpWriteResult> {
  if (!input.online) {
    enqueue({
      eventId: input.eventId,
      userId: input.userId,
      status: input.status,
      notes: input.notes,
      existingRsvpId: input.existingRsvpId,
    });
    return { queued: true, rsvpId: input.existingRsvpId };
  }

  if (input.existingRsvpId) {
    const { error } = await client.from("rsvps").update({
      status: input.status,
      notes: input.notes,
      source: "user",
    }).eq("id", input.existingRsvpId);
    if (error) throw error;
    return { queued: false, rsvpId: input.existingRsvpId };
  }

  const { data, error } = await client.from("rsvps").insert({
    event_id: input.eventId,
    user_id: input.userId,
    status: input.status,
    notes: input.notes,
    source: "user",
  }).select("id").single();
  if (error) throw error;
  return { queued: false, rsvpId: data?.id ?? null };
}

export async function saveGuardianChildRsvp(
  client: any,
  input: ChildRsvpInput,
): Promise<RsvpWriteResult> {
  if (input.existingRsvpId) {
    const { error } = await client.from("rsvps").update({
      status: input.status,
      source: "user",
    }).eq("id", input.existingRsvpId);
    if (error) throw error;
    return { queued: false, rsvpId: input.existingRsvpId };
  }

  const { data, error } = await client.from("rsvps").insert({
    event_id: input.eventId,
    user_id: input.guardianUserId,
    child_id: input.childId,
    status: input.status,
    source: "user",
  }).select("id").maybeSingle();
  if (error) throw error;
  if (data?.id) return { queued: false, rsvpId: data.id };

  // The duplicate-child trigger may redirect a co-guardian insert to the
  // canonical row. Resolve that row without changing its ownership.
  const { data: canonical, error: lookupError } = await client
    .from("rsvps")
    .select("id")
    .eq("event_id", input.eventId)
    .eq("child_id", input.childId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  return { queued: false, rsvpId: canonical?.id ?? null };
}

export async function saveParentMiniLeaguePlayerRsvp(
  client: any,
  input: {
    eventId: string;
    parentUserId: string;
    playerId: string;
    status: RsvpStatus;
    existingRsvpId: string | null;
  },
): Promise<void> {
  if (input.existingRsvpId) {
    const { error } = await client.from("rsvps").update({
      status: input.status,
      source: "user",
    }).eq("id", input.existingRsvpId);
    if (error) throw error;
    return;
  }
  const { error } = await client.from("rsvps").insert({
    event_id: input.eventId,
    user_id: input.parentUserId,
    mini_league_player_id: input.playerId,
    status: input.status,
    source: "user",
  });
  if (error) throw error;
}

export async function adminUpsertRsvp(
  client: any,
  input: {
    eventId: string;
    actingUserId: string;
    subjectUserId: string;
    status: RsvpStatus;
    childId?: string | null;
    miniLeaguePlayerId?: string | null;
  },
): Promise<void> {
  const args: Record<string, unknown> = {
    p_event_id: input.eventId,
    p_user_id: input.subjectUserId,
    p_status: input.status,
    p_acting_user_id: input.actingUserId,
  };
  if (input.childId) args.p_child_id = input.childId;
  if (input.miniLeaguePlayerId) args.p_mini_league_player_id = input.miniLeaguePlayerId;
  const { error } = await client.rpc("admin_upsert_rsvp", args);
  if (error) throw error;
}

export async function adminUpdateRsvpStatus(
  client: any,
  input: { rsvpId: string; status: RsvpStatus; actingUserId: string },
): Promise<void> {
  const { error } = await client.rpc("admin_update_rsvp_status", {
    p_rsvp_id: input.rsvpId,
    p_status: input.status,
    p_acting_user_id: input.actingUserId,
  });
  if (error) throw error;
}

export async function adminSaveChildRsvp(
  client: any,
  input: {
    eventId: string;
    parentUserId: string;
    childId: string;
    status: RsvpStatus;
  },
): Promise<void> {
  const { data: existing } = await client
    .from("rsvps")
    .select("id")
    .eq("event_id", input.eventId)
    .eq("child_id", input.childId)
    .maybeSingle();
  if (existing?.id) {
    const { error } = await client.from("rsvps").update({ status: input.status }).eq("id", existing.id);
    if (error) throw error;
    return;
  }
  const { error } = await client.from("rsvps").insert({
    event_id: input.eventId,
    user_id: input.parentUserId,
    child_id: input.childId,
    status: input.status,
  });
  if (error) throw error;
}
