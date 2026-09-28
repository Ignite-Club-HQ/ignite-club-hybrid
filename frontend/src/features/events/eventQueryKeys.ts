/** Canonical cache identities for event data and event-derived UI surfaces. */
export const eventKeys = {
  lists: () => ["events"] as const,
  upcoming: () => ["upcoming-events"] as const,
  teamNext: () => ["team-next-event"] as const,
  home: (userId: string) => ["user-memberships-and-events", userId] as const,

  detail: (eventId: string) => ["event", eventId] as const,
  rsvps: (eventId: string) => ["event-rsvps", eventId] as const,
  goingRsvps: (eventId: string) => ["event-rsvps-going", eventId] as const,
  groups: (eventId: string) => ["event-groups", eventId] as const,
  duties: (eventId: string) => ["event-duties", eventId] as const,
  payments: (eventId: string) => ["event-payments", eventId] as const,
  recentReminders: (eventId: string) => ["event-recent-reminders", eventId] as const,

  pitchLinked: (eventId: string) => ["pitch-linked-event", eventId] as const,
  pitchGoingRsvps: (eventId: string) => ["pitch-board-going-rsvps", eventId] as const,
  pitchTeamMembers: (teamId?: string | null, eventId?: string | null) =>
    teamId && eventId
      ? (["team-members-for-pitch", teamId, eventId] as const)
      : (["team-members-for-pitch"] as const),
};
