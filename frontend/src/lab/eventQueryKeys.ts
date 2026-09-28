/**
 * Canonical cache identities for event data and event-derived UI surfaces.
 *
 * Adapted from the bundle's refactored `eventQueryKeys` helper, which
 * replaced scattered literal React Query key arrays (duplicated across the
 * event pages) with one shared factory. A typo in a hand-written key array
 * silently breaks cache invalidation; centralizing the keys here removes
 * that duplication risk. This module has no provider or Supabase/ICP edge —
 * it only names cache entries.
 */
export const eventKeys = {
  lists: () => ['events'] as const,
  upcoming: () => ['upcoming-events'] as const,
  teamNext: () => ['team-next-event'] as const,
  home: (userId?: string | null) =>
    userId
      ? (['user-memberships-and-events', userId] as const)
      : (['user-memberships-and-events'] as const),

  detail: (eventId?: string | null) =>
    eventId ? (['event', eventId] as const) : (['event'] as const),
  rsvps: (eventId?: string | null) =>
    eventId ? (['event-rsvps', eventId] as const) : (['event-rsvps'] as const),
  goingRsvps: (eventId?: string | null) =>
    eventId ? (['event-rsvps-going', eventId] as const) : (['event-rsvps-going'] as const),
  groups: (eventId?: string | null) =>
    eventId ? (['event-groups', eventId] as const) : (['event-groups'] as const),
  duties: (eventId?: string | null) =>
    eventId ? (['event-duties', eventId] as const) : (['event-duties'] as const),
  payments: (eventId?: string | null) =>
    eventId ? (['event-payments', eventId] as const) : (['event-payments'] as const),
  recentReminders: (eventId?: string | null) =>
    eventId ? (['event-recent-reminders', eventId] as const) : (['event-recent-reminders'] as const),

  pitchLinked: (eventId: string) => ['pitch-linked-event', eventId] as const,
  pitchGoingRsvps: (eventId?: string | null) =>
    eventId
      ? (['pitch-board-going-rsvps', eventId] as const)
      : (['pitch-board-going-rsvps'] as const),
  pitchTeamMembers: (teamId?: string | null, eventId?: string | null) =>
    teamId && eventId
      ? (['team-members-for-pitch', teamId, eventId] as const)
      : (['team-members-for-pitch'] as const),
};
