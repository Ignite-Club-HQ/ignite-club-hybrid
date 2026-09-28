export type EventFormType = "game" | "training" | "social";
export type EventGrouping = "" | "level" | "team";

export type SharedEventPayloadInput = {
  title: string;
  type: EventFormType;
  address: string;
  description: string;
  clubId: string;
  teamId: string;
  price: string;
  opponent: string;
  isBye: boolean;
  arrivalMinutesBefore: string;
  rsvpAudience: string | null;
  allowGuests: boolean;
  maxGuestsPerMember: number;
  restrictedRoles: string[];
  adultsOnly: boolean;
  rsvpGrouping: EventGrouping;
  targetTeamIds: string[] | null;
};

/** Shared create/edit form normalization; transaction-specific fields stay with callers. */
export function buildSharedEventPayload(input: SharedEventPayloadInput) {
  const isClubWideGroupable =
    !input.teamId && (input.type === "game" || input.type === "social");
  const parsedPrice = input.price ? parseFloat(input.price) : null;

  return {
    title: input.title.trim(),
    type: input.type,
    address: input.address.trim() || null,
    description: input.description.trim() || null,
    amount: input.type === "social" ? parsedPrice : null,
    club_id: input.clubId,
    team_id: input.teamId || null,
    opponent:
      input.type === "game" && !input.isBye ? input.opponent.trim() || null : null,
    arrival_minutes_before:
      input.type === "game" && !input.isBye && input.arrivalMinutesBefore.trim() !== ""
        ? parseInt(input.arrivalMinutesBefore, 10)
        : null,
    rsvp_audience: input.rsvpAudience,
    is_bye: input.type === "game" ? input.isBye : false,
    allow_guests: input.type === "social" && input.allowGuests ? true : null,
    max_guests_per_member:
      input.type === "social" && input.allowGuests ? input.maxGuestsPerMember : null,
    restricted_to_roles:
      input.type === "social" && !input.teamId && input.restrictedRoles.length > 0
        ? input.restrictedRoles
        : null,
    adults_only: input.adultsOnly,
    rsvp_grouping: isClubWideGroupable && input.rsvpGrouping ? input.rsvpGrouping : null,
    target_team_ids:
      isClubWideGroupable && input.targetTeamIds && input.targetTeamIds.length >= 2
        ? input.targetTeamIds
        : null,
  };
}
