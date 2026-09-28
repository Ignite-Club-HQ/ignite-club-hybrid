import { Trophy, Dumbbell, PartyPopper, CalendarDays, type LucideIcon } from "lucide-react";

/**
 * Returns a Lucide icon component for an event type. Used as a small visual
 * cue next to the event title so we can drop the redundant "Training"/"Match"
 * pills from the top of cards.
 */
export function getEventTypeIcon(
  type?: string | null,
  options?: { miniLeagueId?: string | null }
): LucideIcon {
  if (options?.miniLeagueId) return Trophy;
  switch (type) {
    case "game":
    case "mini_league":
      return Trophy;
    case "training":
      return Dumbbell;
    case "social":
      return PartyPopper;
    default:
      return CalendarDays;
  }
}

export type EventTypeAccent = "game" | "training" | "social" | "default";

export function getEventTypeAccent(
  type?: string | null,
  options?: { miniLeagueId?: string | null; opponent?: string | null }
): EventTypeAccent {
  if (options?.miniLeagueId) return "game";
  if (type === "game" || type === "mini_league") return "game";
  if (type === "training") return "training";
  if (type === "social") return "social";
  if (options?.opponent) return "game";
  return "default";
}

/**
 * Returns the Tailwind text/bg/border tokens for a given event type accent.
 * All values use semantic CSS vars defined in index.css so they remain theme-aware.
 */
export function getEventTypeAccentClasses(accent: EventTypeAccent) {
  switch (accent) {
    case "game":
      return {
        text: "text-[hsl(var(--event-game))]",
        bg: "bg-[hsl(var(--event-game)/0.12)]",
        border: "border-[hsl(var(--event-game)/0.35)]",
        rail: "bg-[hsl(var(--event-game))]",
      };
    case "training":
      return {
        text: "text-[hsl(var(--event-training))]",
        bg: "bg-[hsl(var(--event-training)/0.12)]",
        border: "border-[hsl(var(--event-training)/0.30)]",
        rail: "bg-[hsl(var(--event-training))]",
      };
    case "social":
      return {
        text: "text-[hsl(var(--event-social))]",
        bg: "bg-[hsl(var(--event-social)/0.12)]",
        border: "border-[hsl(var(--event-social)/0.30)]",
        rail: "bg-[hsl(var(--event-social))]",
      };
    default:
      return {
        text: "text-muted-foreground",
        bg: "bg-muted",
        border: "border-border",
        rail: "bg-primary",
      };
  }
}
