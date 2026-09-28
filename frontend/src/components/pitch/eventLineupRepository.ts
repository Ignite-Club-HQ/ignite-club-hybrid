import { supabase } from "@/integrations/supabase/client";
import type { Player, TeamSize, PitchBoardState } from "./types";
import { PITCH_STATE_KEY, getPitchStateKey } from "./types";
import { loadTimerStateForMinutes } from "./pitchStateUtils";

/**
 * Durable per-event lineup storage (`public.event_lineups`).
 *
 * localStorage remains the hot path for the live board, but the *planned
 * lineup* (who is on the pitch, in which slot, with which formation/team size)
 * is mirrored into the database keyed by (event_id, team_id) so it survives:
 *   - a different device / browser,
 *   - localStorage being cleared,
 *   - another coach opening the same fixture's board.
 *
 * Only lineup shape is stored — never live game progress (minutes, goals,
 * injuries, auto-sub plan, timer). Those stay device-local per game.
 */

export interface EventLineupSnapshot {
  players: Player[];
  teamSize: TeamSize;
  selectedFormation: number;
  ballPosition?: { x: number; y: number };
  savedAt: number;
  version: 1;
}

export interface EventLineupRecord {
  snapshot: EventLineupSnapshot;
  updatedAt: number;
}

const isRealTeamId = (teamId: string | null | undefined) =>
  !!teamId && !teamId.startsWith("event-group-") && !teamId.startsWith("mock");

/**
 * Strip live-game data so only the planned lineup is persisted.
 * Fill-in guests ARE included: they belong to this fixture (the snapshot is
 * keyed by event_id) and coaches expect them to survive to game day.
 */
export const buildEventLineupSnapshot = (args: {
  players: Player[];
  teamSize: TeamSize;
  selectedFormation: number;
  ballPosition?: { x: number; y: number };
}): EventLineupSnapshot => ({
  players: (args.players || [])
    .map((p) => ({
      ...p,
      minutesPlayed: 0,
      isInjured: false,
    })),
  teamSize: args.teamSize,
  selectedFormation: args.selectedFormation,
  ballPosition: args.ballPosition,
  savedAt: Date.now(),
  version: 1,
});

/** Stable signature so we only write when the lineup actually changed. */
export const lineupSignature = (snapshot: EventLineupSnapshot): string =>
  JSON.stringify({
    s: snapshot.teamSize,
    f: snapshot.selectedFormation,
    p: snapshot.players.map((p) => [
      p.id,
      p.position ? `${Math.round(p.position.x)}:${Math.round(p.position.y)}` : "b",
      p.currentPitchPosition ?? "",
      p.number ?? "",
    ]),
  });

export async function fetchEventLineup(
  eventId: string,
  teamId: string
): Promise<EventLineupRecord | null> {
  if (!eventId || !isRealTeamId(teamId)) return null;
  try {
    const { data, error } = await supabase
      .from("event_lineups")
      .select("lineup, updated_at")
      .eq("event_id", eventId)
      .eq("team_id", teamId)
      .maybeSingle();
    if (error || !data) return null;
    const snapshot = data.lineup as unknown as EventLineupSnapshot | null;
    if (!snapshot || !Array.isArray(snapshot.players) || snapshot.players.length === 0) {
      return null;
    }
    return {
      snapshot,
      updatedAt: data.updated_at ? new Date(data.updated_at).getTime() : 0,
    };
  } catch (e) {
    console.warn("[EventLineup] fetch failed", e);
    return null;
  }
}

export async function saveEventLineup(args: {
  eventId: string;
  teamId: string;
  userId?: string | null;
  snapshot: EventLineupSnapshot;
}): Promise<boolean> {
  const { eventId, teamId, userId, snapshot } = args;
  if (!eventId || !isRealTeamId(teamId)) return false;
  if (!snapshot.players.length) return false;
  try {
    const { error } = await supabase
      .from("event_lineups")
      .upsert(
        {
          event_id: eventId,
          team_id: teamId,
          lineup: snapshot as unknown as never,
          updated_by: userId ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "event_id,team_id" }
      );
    if (error) {
      console.warn("[EventLineup] save failed", error);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[EventLineup] save threw", e);
    return false;
  }
}

const readLocalState = (teamId: string): PitchBoardState | null => {
  try {
    const raw = localStorage.getItem(getPitchStateKey(teamId));
    return raw ? (JSON.parse(raw) as PitchBoardState) : null;
  } catch {
    return null;
  }
};

/**
 * Decide whether the DB lineup should replace whatever is in localStorage.
 * Pure so it can be unit-tested.
 */
export function shouldAdoptRemoteLineup(args: {
  remote: EventLineupRecord | null;
  local: PitchBoardState | null;
  eventId: string;
  timerRunning: boolean;
}): boolean {
  const { remote, local, eventId, timerRunning } = args;
  if (!remote) return false;
  // Never disturb a live game in progress on this device.
  if (timerRunning) return false;
  if (!local) return true;
  // Local state belongs to a different (or no) fixture → adopt the remote plan.
  if (local.linkedEventId !== eventId) return true;
  if (!local.players?.length) return true;
  // Same fixture: newest write wins.
  return remote.updatedAt > (local.lastUpdateTime || 0);
}

/**
 * Hydrate localStorage from the DB lineup when appropriate.
 * Returns true when local state was replaced.
 */
export async function hydrateEventLineupToLocal(
  eventId: string,
  teamId: string
): Promise<boolean> {
  if (!eventId || !isRealTeamId(teamId)) return false;
  const remote = await fetchEventLineup(eventId, teamId);
  if (!remote) return false;

  const local = readLocalState(teamId);
  const timerState = loadTimerStateForMinutes(teamId);
  const timerFresh =
    !!timerState?.lastUpdateTime &&
    Date.now() - timerState.lastUpdateTime <= 12 * 60 * 60 * 1000;
  const timerRunning = timerState?.isRunning === true && timerFresh;

  if (!shouldAdoptRemoteLineup({ remote, local, eventId, timerRunning })) return false;

  const hydrated: PitchBoardState = {
    teamId,
    players: remote.snapshot.players.map((p) => ({
      ...p,
      minutesPlayed: 0,
      isInjured: false,
    })),
    teamSize: remote.snapshot.teamSize,
    selectedFormation: remote.snapshot.selectedFormation,
    ballPosition: remote.snapshot.ballPosition || { x: 50, y: 50 },
    autoSubPlan: [],
    autoSubActive: false,
    autoSubPaused: false,
    mockMode: false,
    linkedEventId: eventId,
    goals: [],
    lastUpdateTime: Date.now(),
    lastTimerSeconds: 0,
  };

  try {
    const serialised = JSON.stringify(hydrated);
    localStorage.setItem(getPitchStateKey(teamId), serialised);
    localStorage.setItem(PITCH_STATE_KEY, serialised);
    console.log("[EventLineup] hydrated lineup from database", {
      eventId,
      teamId,
      players: hydrated.players.length,
    });
    return true;
  } catch (e) {
    console.warn("[EventLineup] hydrate write failed", e);
    return false;
  }
}
