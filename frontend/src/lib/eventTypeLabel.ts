/**
 * Returns a human-friendly label for an event type.
 * game → "Game", training → "Training", mini_league → "Match Day", social → "Event"
 * If a miniLeagueId is present, prefer "Match Day" even when legacy records still store type as "game".
 */
export function getEventTypeLabel(
  type?: string | null,
  options?: { miniLeagueId?: string | null }
): string {
  if (options?.miniLeagueId) {
    return "Match Day";
  }

  switch (type) {
    case "game":
      return "Game";
    case "training":
      return "Training";
    case "social":
      return "Social";
    case "mini_league":
      return "Match Day";
    default:
      return "Event";
  }
}
