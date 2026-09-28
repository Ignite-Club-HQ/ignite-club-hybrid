export type AttendanceSummary =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "social"; total: number; adults: number; children: number }
  | { state: "players"; count: number };

export function calculateAttendanceSummary(input: {
  eventType: string;
  rsvps?: any[] | null;
  guestCount: number;
  playerUserIds: Iterable<string>;
  attendanceUnavailable: boolean;
}): AttendanceSummary {
  if (!input.rsvps) return input.attendanceUnavailable ? { state: "unavailable" } : { state: "loading" };
  const going = input.rsvps.filter((rsvp) => rsvp.status === "going");
  if (input.eventType === "social") {
    const adults = going.filter((rsvp) => rsvp.child_id == null).length + input.guestCount;
    const children = going.filter((rsvp) => rsvp.child_id != null).length;
    return { state: "social", total: adults + children, adults, children };
  }

  const adultPlayers = new Set(input.playerUserIds);
  const seen = new Set<string>();
  for (const rsvp of going) {
    const childId = rsvp.child_id || rsvp.mini_league_players?.child_id || null;
    const isPlayer = childId || rsvp.mini_league_player_id || (rsvp.user_id && adultPlayers.has(rsvp.user_id));
    if (!isPlayer) continue;
    const key = childId
      ? `c:${childId}`
      : rsvp.mini_league_player_id
        ? `m:${rsvp.mini_league_player_id}`
        : `u:${rsvp.user_id}`;
    seen.add(key);
  }
  return { state: "players", count: seen.size + input.guestCount };
}
