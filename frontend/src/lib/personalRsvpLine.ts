/**
 * Build a personal-first RSVP summary line used across event cards.
 *
 * Examples:
 *   "Teddy going"
 *   "Teddy going + 2 others"
 *   "You going + 3 others"
 *   "5 going" (when nobody from the household has RSVP'd)
 *
 * Rules:
 *  - The current user's child(ren) take precedence (first child name)
 *  - Then the user themselves ("You")
 *  - Then a "+ N others" tail counting OTHER going attendees
 *
 * Returns null when nobody is going at all.
 */
export interface PersonalRsvpInput {
  /** Parent (current user) RSVP status for this event, if any. */
  parentStatus?: "going" | "maybe" | "not_going" | null;
  /** Names of the user's children that are going (first name only is fine). */
  goingChildNames?: string[];
  /** TOTAL number of "going" RSVPs on the event (including household). */
  totalGoing?: number;
}

export function buildPersonalRsvpLine({
  parentStatus,
  goingChildNames = [],
  totalGoing = 0,
}: PersonalRsvpInput): string | null {
  const firstChild = goingChildNames[0];
  const householdGoingCount =
    (parentStatus === "going" ? 1 : 0) + goingChildNames.length;

  // Personal-first: child name wins as the anchor
  if (firstChild) {
    const others = Math.max(totalGoing - 1, 0);
    return others > 0
      ? `${firstChild} + ${others} going`
      : `${firstChild} going`;
  }

  // Otherwise lead with "You" if the user themselves is going
  if (parentStatus === "going") {
    const others = Math.max(totalGoing - 1, 0);
    return others > 0
      ? `You + ${others} going`
      : "You going";
  }

  // Nobody from the household is going — fall back to a global count
  if (totalGoing > 0) {
    return `${totalGoing} going`;
  }

  return null;
}
