/**
 * RSVP audience defines who is prompted to RSVP for an event:
 *  - players_only: only the player (or the child of a parent) sees RSVP buttons
 *  - players_and_parents: both player and parent are prompted
 *  - parents_only: only the parent is prompted (rare; e.g. parent-only socials)
 *
 * Events store a nullable override; NULL means "use the team default".
 */
export type RsvpAudience = "players_only" | "players_and_parents" | "parents_only";

export const RSVP_AUDIENCE_OPTIONS: Array<{
  value: RsvpAudience;
  label: string;
  description: string;
}> = [
  {
    value: "players_only",
    label: "Players only",
    description: "Only the player (or child) is prompted to RSVP.",
  },
  {
    value: "players_and_parents",
    label: "Players + parents",
    description: "Both the player and the parent are prompted.",
  },
  {
    value: "parents_only",
    label: "Parents only",
    description: "Only the parent is prompted.",
  },
];

export const DEFAULT_TEAM_RSVP_AUDIENCE: RsvpAudience = "players_and_parents";

/**
 * Resolves the effective RSVP audience for an event, falling back through
 * event override → team default → global default.
 */
export function resolveRsvpAudience(
  eventAudience: RsvpAudience | string | null | undefined,
  teamDefault: RsvpAudience | string | null | undefined,
): RsvpAudience {
  const valid: RsvpAudience[] = ["players_only", "players_and_parents", "parents_only"];
  if (eventAudience && valid.includes(eventAudience as RsvpAudience)) {
    return eventAudience as RsvpAudience;
  }
  if (teamDefault && valid.includes(teamDefault as RsvpAudience)) {
    return teamDefault as RsvpAudience;
  }
  return DEFAULT_TEAM_RSVP_AUDIENCE;
}

export function shouldPromptPlayer(a: RsvpAudience): boolean {
  return a === "players_only" || a === "players_and_parents";
}

export function shouldPromptParent(a: RsvpAudience): boolean {
  return a === "parents_only" || a === "players_and_parents";
}

/**
 * Should the signed-in adult see their OWN ("Your RSVP") block?
 *
 * Parents are prompted whenever the audience includes parents. Adult players
 * are ALSO prompted under `players_only`, because on that audience *they* are
 * the player. This is what makes mixed teams (adult players + children on one
 * roster) work: the parent gets both their own block and their children's.
 */
export function shouldPromptSelf(
  a: RsvpAudience,
  viewerIsAdultPlayer?: boolean | null,
): boolean {
  if (shouldPromptParent(a)) return true;
  return shouldPromptPlayer(a) && !!viewerIsAdultPlayer;
}

/**
 * Club-wide social events (no team_id, type === "social") are parent-first:
 * the logged-in adult is the primary RSVP, and any household children are
 * shown as a secondary RSVP block.
 */
export function isParentFirstEvent(event: {
  team_id?: string | null;
  type?: string | null;
} | null | undefined): boolean {
  if (!event) return false;
  return !event.team_id && event.type === "social";
}
