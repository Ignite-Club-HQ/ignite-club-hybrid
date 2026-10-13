import type { LiveEventInput } from "@/live/features/events";

/** Fixture fields needed to build a live (ICP events_domain) event input. */
export interface FixtureForLiveEvent {
  title: string;
  date: string;
  time: string;
  address?: string;
  description?: string;
  opponent?: string;
  teamId?: string;
}

// 2-hour default window: fixtures only carry a kickoff time, no explicit
// end, matching the single start_time written on the Supabase row.
export const DEFAULT_FIXTURE_GAME_DURATION_MS = 2 * 60 * 60 * 1000;

/**
 * Maps one parsed CSV fixture row to the `createLiveEvent` input shape,
 * mirroring the fields written by the Supabase insert (title/opponent,
 * start/end window, location, team).
 */
export function buildLiveFixtureEventInput(
  fixture: FixtureForLiveEvent,
  clubId: string,
  fallbackTeamId: string | undefined,
): LiveEventInput {
  const startsAt = new Date(`${fixture.date}T${fixture.time}`);
  const endsAt = new Date(startsAt.getTime() + DEFAULT_FIXTURE_GAME_DURATION_MS);
  return {
    clubId,
    teamId: fixture.teamId || fallbackTeamId || null,
    title: fixture.title,
    description: fixture.description || "",
    eventType: "game",
    location: fixture.address || null,
    opponent: fixture.opponent || null,
    address: fixture.address || null,
    startsAtMs: startsAt,
    endsAtMs: endsAt,
  };
}
