import { supabase } from "@/integrations/supabase/client";

// Time window: 2 hours before to 3 hours after the event start time
const WINDOW_BEFORE_MS = 120 * 60 * 1000; // 2 hours before
const WINDOW_AFTER_MS = 3 * 60 * 60 * 1000; // 3 hours after

interface PitchState {
  linkedEventId?: string | null;
  [key: string]: unknown;
}

/**
 * Check if there's an active game in progress for this team and return its linked event ID.
 * This allows anyone opening the pitch board for a team to automatically join an in-progress game.
 */
async function findActiveGameEventForTeam(teamId: string): Promise<string | null> {
  const { data: activeGame, error } = await supabase
    .from("active_games")
    .select("pitch_state")
    .eq("team_id", teamId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !activeGame) {
    return null;
  }

  // Extract linkedEventId from pitch_state
  const pitchState = activeGame.pitch_state as PitchState | null;
  if (!pitchState?.linkedEventId) {
    return null;
  }

  // Verify the linked event is still within the editable game window.
  // An active_games row may have been left active from a previous match — only
  // adopt it if the linked event is actually current.
  const { data: linkedEvent } = await supabase
    .from("events")
    .select("event_date, is_cancelled")
    .eq("id", pitchState.linkedEventId)
    .maybeSingle();

  if (!linkedEvent || linkedEvent.is_cancelled) {
    return null;
  }

  const eventTime = new Date(linkedEvent.event_date).getTime();
  const now = Date.now();
  const inWindow =
    eventTime - WINDOW_BEFORE_MS <= now && now <= eventTime + WINDOW_AFTER_MS;

  if (!inWindow) {
    console.log('[NearbyGame] Active game found but linked event outside window, ignoring');
    return null;
  }

  return pitchState.linkedEventId;
}

/**
 * Find a game event for the given team that is currently within the game time window.
 * First checks for an active game in progress for the team.
 * Returns the event ID if found, null otherwise.
 */
export async function findNearbyGameEvent(teamId: string): Promise<string | null> {
  // First, check if there's an active game for this team
  const activeGameEventId = await findActiveGameEventForTeam(teamId);
  if (activeGameEventId) {
    console.log('[NearbyGame] Found active game for team, using linked event:', activeGameEventId);
    return activeGameEventId;
  }

  const now = new Date();
  
  // Look for games within the window
  const windowStart = new Date(now.getTime() - WINDOW_AFTER_MS); // Started up to 3 hours ago
  const windowEnd = new Date(now.getTime() + WINDOW_BEFORE_MS); // Starting in the next 2 hours
  
  const { data: events, error } = await supabase
    .from("events")
    .select("id, event_date")
    .eq("team_id", teamId)
    .eq("type", "game")
    .eq("is_cancelled", false)
    .gte("event_date", windowStart.toISOString())
    .lte("event_date", windowEnd.toISOString());

  if (error || !events || events.length === 0) {
    return null;
  }

  const nowMs = now.getTime();

  type Candidate = { id: string; time: number; distance: number };
  const candidates: Candidate[] = [];
  for (const evt of events) {
    if (!evt?.event_date || !evt?.id) continue;
    const time = new Date(evt.event_date).getTime();
    if (!Number.isFinite(time)) continue;
    candidates.push({ id: evt.id, time, distance: Math.abs(time - nowMs) });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    // Prefer the upcoming event when past and future are equally distant.
    const aUpcoming = a.time >= nowMs;
    const bUpcoming = b.time >= nowMs;
    if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
    // Stable secondary tie-breaker on event id.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return candidates[0].id;
}
