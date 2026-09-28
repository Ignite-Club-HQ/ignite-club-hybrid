import { useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { recordSyncWrite } from "@/lib/syncWriteRateMonitor";
import { hasAnchoredTimerMarker, mayWriteLegacyTimerState } from "@/lib/serverTimer";
import type { Json } from "@/integrations/supabase/types";

const SYNC_INTERVAL = 10000; // Sync every 10 seconds
const TIMER_STATE_KEY = "pitch-board-timer-state";
const PITCH_STATE_KEY = "ignite-pitch-board-state";
const PITCH_STATE_KEY_BASE = "ignite-pitch-board-state-team";
const getPitchStateKeyForTeam = (teamId: string) => `${PITCH_STATE_KEY_BASE}-${teamId}`;

interface TimerState {
  elapsedSeconds: number;
  isRunning: boolean;
  currentHalf: number;
  minutesPerHalf: number;
  lastUpdateTime: number;
  teamName?: string;
  teamId?: string;
}

interface PitchState {
  players: any[];
  autoSubPlan: any[];
  autoSubActive: boolean;
  autoSubPaused?: boolean;
}

/**
 * Hook to sync active game state to the database for server-side push notifications.
 * This enables push notifications even when the app is closed.
 */
export function useActiveGameSync() {
  const { user } = useAuth();
  const activeGameIdRef = useRef<string | null>(null);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // Stable board session id for the lifetime of this hook mount. Stamped on
  // every active_games write so spectators can lock onto this session even if
  // the underlying row id changes (e.g. recovery after a unique-violation race).
  const boardSessionIdRef = useRef<string>(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `bs-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  // Scope deactivation to (user, team) — without the team filter, a coach
  // running boards for two teams in parallel tabs would flip each other off
  // every 10s. Mirrors the basketball/netball sync hooks.
  const deactivateOtherActiveGames = useCallback(
    async (teamId: string | null, currentGameId?: string | null) => {
      if (!user?.id) return;

      // Shared-session model: deactivation must be scoped by team only.
      // Filtering by user_id would leave a stale row owned by a different
      // controller (admin vs subs-mgr) and trip the unique constraint.
      let query = supabase
        .from('active_games')
        .update({ is_active: false })
        .eq('is_active', true);

      if (teamId) query = query.eq('team_id', teamId);
      else query = query.eq('user_id', user.id).is('team_id', null);

      if (currentGameId) {
        query = query.neq('id', currentGameId);
      }

      const { error } = await query;
      if (error) {
        console.error('[SYNC] Failed to deactivate other active games:', error);
      }
    },
    [user?.id]
  );

  const loadTimerState = useCallback((): TimerState | null => {
    try {
      const saved = localStorage.getItem(TIMER_STATE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }, []);

  const loadPitchState = useCallback((teamId?: string): PitchState | null => {
    try {
      if (teamId) {
        const teamSaved = localStorage.getItem(getPitchStateKeyForTeam(teamId));
        if (teamSaved) return JSON.parse(teamSaved);

        const activeSaved = localStorage.getItem(PITCH_STATE_KEY);
        if (!activeSaved) return null;
        const activeState = JSON.parse(activeSaved) as PitchState & { teamId?: string };
        return activeState.teamId === teamId ? activeState : null;
      }

      const saved = localStorage.getItem(PITCH_STATE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }, []);

  /**
   * Read the CURRENT server row's timer_state so we can refuse to downgrade a
   * server-anchored (v2) board from this legacy writer. Local localStorage is
   * not a safe proxy: `active_games` rows are shared per team, so a device with
   * v1 localStorage would otherwise adopt the team's anchored row and stomp it.
   */
  const readRemoteTimerState = useCallback(
    async (teamId: string | null, rowId: string | null): Promise<unknown> => {
      if (!user?.id) return null;
      try {
        let q = supabase.from('active_games').select('timer_state').eq('is_active', true);
        q = rowId
          ? q.eq('id', rowId)
          : (teamId ? q.eq('team_id', teamId) : q.eq('user_id', user.id).is('team_id', null));
        const { data } = await q.order('updated_at', { ascending: false }).limit(1).maybeSingle();
        return data?.timer_state ?? null;
      } catch {
        // Unknown remote shape → treat as anchored (fail safe: skip timer_state).
        return { schema_version: 2 };
      }
    },
    [user?.id]
  );


  const syncToDatabase = useCallback(async () => {
    if (!user?.id) return;
    // Skip DB sync when offline — local pitch state remains the source of truth,
    // and we'll resync on the next interval after connectivity returns.
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    const timerState = loadTimerState();
    // If the server-anchored timer (schema v2) is in play, the new
    // `pitch-timer-event` edge function owns timer_state. We must not
    // clobber it with the v1 elapsedSeconds/lastUpdateTime shape — but we
    // STILL need to keep pitch_state in sync so the cron can read
    // autoSubPlan / players for sub & halftime notifications. Update
    // pitch_state only on existing rows; never timer_state.
    const isServerAnchored = hasAnchoredTimerMarker(timerState);
    if (isServerAnchored) {
      try {
        const ps = loadPitchState(timerState?.teamId);
        if (!ps) return;
        const teamId = timerState?.teamId || null;
        let q = supabase
          .from('active_games')
          .update({
            pitch_state: ps as unknown as Json,
            updated_at: new Date().toISOString(),
          })
          .eq('is_active', true);
        q = teamId ? q.eq('team_id', teamId) : q.eq('user_id', user.id).is('team_id', null);
        await q;
      } catch (e) {
        console.warn('[SYNC] v2 pitch_state sync failed', e);
      }
      return;
    }

    const pitchState = loadPitchState(timerState?.teamId);

    const deactivateActiveGame = async () => {
      if (!activeGameIdRef.current) return;

      await supabase
        .from('active_games')
        .update({ is_active: false })
        .eq('id', activeGameIdRef.current);

      activeGameIdRef.current = null;
    };

    // If no active game state, deactivate any existing game
    if (!timerState || !pitchState) {
      await deactivateActiveGame();
      return;
    }

    const halfDurationSeconds = timerState.minutesPerHalf * 60;
    const secondsSinceLastUpdate = timerState.lastUpdateTime
      ? Math.max(0, Math.floor((Date.now() - timerState.lastUpdateTime) / 1000))
      : 0;
    const projectedElapsedSeconds = Math.min(
      timerState.elapsedSeconds + (timerState.isRunning ? secondsSinceLastUpdate : 0),
      halfDurationSeconds
    );
    const isFinishedByState = Boolean((timerState as TimerState & { isGameFinished?: boolean }).isGameFinished)
      || (timerState.currentHalf === 2 && projectedElapsedSeconds >= halfDurationSeconds);

    // Never re-sync or resurrect a game after full time.
    // BUT keep active during halftime break (half 2, elapsed 0, paused) so server
    // can detect and send halftime push notifications.
    const isHalftimeBreak = !timerState.isRunning && timerState.currentHalf === 2 && timerState.elapsedSeconds === 0 && pitchState.autoSubActive;
    
    // Don't keep syncing at halftime forever — if the coach hasn't started the
    // second half within 20 minutes, treat the game as abandoned.
    const MAX_HALFTIME_SYNC_MS = 20 * 60 * 1000; // 20 minutes
    const halftimeTooLong = isHalftimeBreak && timerState.lastUpdateTime
      && (Date.now() - timerState.lastUpdateTime) > MAX_HALFTIME_SYNC_MS;
    
    if (isFinishedByState || (!timerState.isRunning && !isHalftimeBreak) || halftimeTooLong || !pitchState.autoSubActive) {
      await deactivateActiveGame();
      return;
    }

    // Guard against creating a phantom active_games row from stale localStorage.
    // A real running game always has either isRunning=true OR elapsedSeconds>0
    // (halftime). If the board has never actually started ticking, do NOT
    // insert a new row — only update an existing one we already own.
    const hasRealProgress = timerState.isRunning || timerState.elapsedSeconds > 0;
    if (!hasRealProgress && !activeGameIdRef.current) {
      return;
    }

    // Skip syncing to active_games for event-group based games
    // Those are synced via useEventGroupSync to the event_groups table
    const isEventGroup = timerState.teamId?.startsWith("event-group-");
    if (isEventGroup) {
      return;
    }

    // Compute the ACTUAL elapsed time so the server sees real game progress.
    // Use uncapped drift here so long background periods don't freeze synced time.
    const nowMs = Date.now();
    const secondsSinceFrozen = timerState.isRunning && timerState.lastUpdateTime
      ? Math.max(0, Math.floor((nowMs - timerState.lastUpdateTime) / 1000))
      : 0;
    const actualElapsed = Math.min(timerState.elapsedSeconds + secondsSinceFrozen, halfDurationSeconds);

    const syncedTimerState: TimerState = {
      ...timerState,
      elapsedSeconds: actualElapsed,
      lastUpdateTime: nowMs,
    };

    // If already at halftime boundary, pre-set last_sub_check_time so the cron
    // doesn't re-send half-time notifications when a new active_games row is created
    const isAtHalftime = syncedTimerState.currentHalf === 2 && syncedTimerState.elapsedSeconds === 0 && !syncedTimerState.isRunning;

    // Local storage says "legacy v1", but the shared team row may already be
    // server-anchored (another device / a newer app version owns the clock).
    // Publishing our v1 timer_state there strands every device at 00:00, so ask
    // the row itself before including the column.
    const remoteTimerState = await readRemoteTimerState(
      timerState.teamId || null,
      activeGameIdRef.current,
    );
    const allowTimerWrite = mayWriteLegacyTimerState({
      local: timerState,
      remote: remoteTimerState,
    });
    if (!allowTimerWrite) {
      console.log('[SYNC] v1 timer_state write SKIPPED — server row is anchored (v2)');
    }

    const gameData = {
      user_id: user.id,
      team_id: timerState.teamId || null,
      ...(allowTimerWrite ? { timer_state: syncedTimerState as unknown as Json } : {}),
      pitch_state: pitchState as unknown as Json,
      is_active: true,
      updated_at: new Date().toISOString(),
      board_session_id: boardSessionIdRef.current,
      ...(isAtHalftime ? { last_sub_check_time: halfDurationSeconds } : {}),
    };

    try {
      const teamId = timerState.teamId || null;
      // Telemetry: count this attempted write toward the per-(user,team) rate.
      // Mirrored server-side by trigger `log_active_game_write`.
      recordSyncWrite({ userId: user.id, teamId, source: "soccer" });

      if (activeGameIdRef.current) {
        await deactivateOtherActiveGames(teamId, activeGameIdRef.current);

        // Update existing game
        const { error } = await supabase
          .from('active_games')
          .update(gameData)
          .eq('id', activeGameIdRef.current);

        if (error) {
          console.error('[SYNC] Failed to update game:', error);
          activeGameIdRef.current = null;
        }
      } else {
        // Look up an existing active row for this TEAM (any controller).
        // Shared-session model: team admins and the assigned Subs Manager all
        // collaborate on the same active_games row. The unique index
        // `uniq_active_games_team_active` guarantees at most one. Falling back
        // to (user_id) for the personal/null-team legacy path.
        let existingQ = supabase
          .from('active_games')
          .select('id, team_id, updated_at')
          .eq('is_active', true)
          .order('updated_at', { ascending: false })
          .limit(5);
        existingQ = teamId
          ? existingQ.eq('team_id', teamId)
          : existingQ.eq('user_id', user.id).is('team_id', null);
        const { data: existingGames, error: existingError } = await existingQ;

        if (existingError) {
          console.error('[SYNC] Failed to fetch existing active games:', existingError);
        }

        const existing = existingGames?.[0];

        if (existing) {
          activeGameIdRef.current = existing.id;
          await deactivateOtherActiveGames(teamId, existing.id);
          await supabase
            .from('active_games')
            .update(gameData)
            .eq('id', existing.id);
        } else {
          const { data: newGame, error } = await supabase
            .from('active_games')
            .insert(gameData)
            .select()
            .single();

          if (error) {
            // 23505 = unique_violation. The DB enforces one active row per
            // team via uniq_active_games_team_active. If a race lands here,
            // adopt the existing row instead of leaving the board un-synced.
            if ((error as { code?: string }).code === '23505' && teamId) {
              const { data: claimed } = await supabase
                .from('active_games')
                .select('id')
                .eq('team_id', teamId)
                .eq('is_active', true)
                .limit(1)
                .maybeSingle();
              if (claimed) {
                activeGameIdRef.current = claimed.id;
                await supabase.from('active_games').update(gameData).eq('id', claimed.id);
              } else {
                console.error('[SYNC] Insert race but no claimed row', error);
              }
            } else {
              console.error('[SYNC] Failed to create game:', error);
            }
          } else {
            activeGameIdRef.current = newGame.id;
            await deactivateOtherActiveGames(teamId, newGame.id);
            console.log('[SYNC] Created new active game:', newGame.id);
          }
        }
      }
    } catch (err) {
      console.error('[SYNC] Sync error:', err);
    }
  }, [user?.id, loadTimerState, loadPitchState, deactivateOtherActiveGames, readRemoteTimerState]);

  const startSync = useCallback(() => {
    if (syncIntervalRef.current) return;
    
    // Sync immediately
    syncToDatabase();
    
    // Then sync every interval
    syncIntervalRef.current = setInterval(syncToDatabase, SYNC_INTERVAL);
    console.log('[SYNC] Started game state sync');
  }, [syncToDatabase]);

  const stopSync = useCallback(async () => {
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }

    // Mark game as inactive
    if (activeGameIdRef.current) {
      await supabase
        .from('active_games')
        .update({ is_active: false })
        .eq('id', activeGameIdRef.current);
      activeGameIdRef.current = null;
    }
    console.log('[SYNC] Stopped game state sync');
  }, []);

  // Force sync on demand
  const forceSync = useCallback(() => {
    syncToDatabase();
  }, [syncToDatabase]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, []);

  return {
    startSync,
    stopSync,
    forceSync,
    isActive: !!activeGameIdRef.current,
  };
}
