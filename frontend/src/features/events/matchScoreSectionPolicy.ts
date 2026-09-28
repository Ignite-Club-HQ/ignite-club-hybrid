export type MatchScoreSectionModel = {
  visible: boolean;
  opponent: string | null;
  canEdit: boolean;
};

export function deriveMatchOpponent(explicitOpponent?: string | null, title?: string | null): string | null {
  if (explicitOpponent) return explicitOpponent;
  const parts = (title || "").split(/\s+(?:v|vs|versus)\.?\s+/i);
  return parts.length > 1 ? parts[parts.length - 1].trim() : null;
}

export function resolveMatchScoreSection(input: {
  eventType: string;
  teamId?: string | null;
  isTeamMember: boolean;
  canManageEvent: boolean;
  canOperateMatch: boolean;
  opponent?: string | null;
  title?: string | null;
}): MatchScoreSectionModel {
  return {
    visible: input.eventType === "game" && !!input.teamId && (input.isTeamMember || input.canManageEvent),
    opponent: deriveMatchOpponent(input.opponent, input.title),
    canEdit: input.canOperateMatch,
  };
}
