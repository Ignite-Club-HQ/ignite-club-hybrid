import { format } from "date-fns";

export const DEFAULT_MATCH_ARRIVAL_MINUTES = 30;

type MatchArrivalEvent = {
  type?: string | null;
  event_date: string;
  start_time?: string | null;
  arrival_minutes_before?: number | null;
  teams?: { default_match_arrival_minutes?: number | null } | null;
};

export function getMatchArrivalMinutes(event: MatchArrivalEvent): number | null {
  if (event.type !== "game") return null;

  if (event.arrival_minutes_before != null) {
    return event.arrival_minutes_before > 0 ? event.arrival_minutes_before : null;
  }

  if (event.teams?.default_match_arrival_minutes != null) {
    return event.teams.default_match_arrival_minutes > 0 ? event.teams.default_match_arrival_minutes : null;
  }

  return null;
}

export function getMatchArrivalDate(event: MatchArrivalEvent): Date | null {
  const mins = getMatchArrivalMinutes(event);
  if (mins == null) return null;

  const kickoff = new Date(event.start_time || event.event_date);
  if (Number.isNaN(kickoff.getTime())) return null;

  return new Date(kickoff.getTime() - mins * 60000);
}

export function formatMatchArrivalTime(event: MatchArrivalEvent, formatString = "h:mm a") {
  const arrivalDate = getMatchArrivalDate(event);
  return arrivalDate ? format(arrivalDate, formatString) : null;
}