/**
 * Competition chat threads.
 *
 * A competition can have two chat groups, distinguished by
 * `chat_groups.competition_scope`:
 *   - "coordinators": competition owners/admins + team admins of entered teams
 *   - "all_members":  everyone with a role on an entered team (opt-in per competition)
 *
 * Membership is maintained server-side by triggers. These helpers only cover
 * presentation and the client-side mirror of the posting rule (the authoritative
 * rule lives in the `group_messages` INSERT policy).
 */

export type CompetitionChatScope = "coordinators" | "all_members";

export function normaliseCompetitionChatScope(
  value: unknown,
): CompetitionChatScope | null {
  return value === "coordinators" || value === "all_members" ? value : null;
}

export function competitionChatSublabel(scope: unknown): string {
  switch (normaliseCompetitionChatScope(scope)) {
    case "all_members":
      return "Competition chat · all members";
    case "coordinators":
      return "Competition chat · coordinators";
    default:
      return "Competition chat";
  }
}

/**
 * Mirrors `public.can_post_in_chat_group`: only the competition-wide thread can
 * be organiser-only, and organisers (competition owner/admin) can always post.
 */
export function canPostInCompetitionChat(params: {
  scope: unknown;
  adminsOnly: boolean | null | undefined;
  isCompetitionAdmin: boolean;
}): boolean {
  if (normaliseCompetitionChatScope(params.scope) !== "all_members") return true;
  if (!params.adminsOnly) return true;
  return params.isCompetitionAdmin;
}
