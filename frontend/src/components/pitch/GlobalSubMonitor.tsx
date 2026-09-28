import { useEffect, useRef, useCallback, useState, Suspense } from "react";
import { playSubAlertBeep, playTimerBeep } from "./GameTimer";
import SubConfirmDialog from "./SubConfirmDialog";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
const GameFinishedDialog = lazyWithRetry(() => import("./GameFinishedDialog"));
import { END_GAME_REQUEST_EVENT, type EndGameRequestDetail } from "./endGameRequest";
import { useGameStats } from "@/hooks/useGameStats";
import { showBrowserNotification, requestNotificationPermission } from "@/lib/notifications";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePitchBoardNotifications } from "@/hooks/usePitchBoardNotifications";
import type { Json } from "@/integrations/supabase/types";
import { setSyncStatus } from "@/hooks/useSyncStatus";
import { hasAnchoredTimerMarker } from "@/lib/serverTimer";
import { getCurrentGameSeconds, MAX_EXTRAPOLATION_SECS } from "./timerUtils";
import { recalculateRemainingPlanTeamAware as recalculateRemainingPlan, validateAndFixRemainingPlan } from "./pitchStateUtils";
import type { Player, SubstitutionEvent, TimerState, PitchBoardState, Goal } from "./types";
import {
  PITCH_STATE_KEY,
  getPitchStateKey,
  PITCH_BOARD_OPEN_KEY,
  TIMER_STORAGE_KEY,
} from "./types";
import {
  getSubKey,
  executeSubsOnPlayers,
  markSubsExecuted,
  calculateSubDelay,
  getDueSubGroups,
  getSubTotalSeconds,
  STALE_SUB_GRACE_SECONDS,
} from "./autoSubHelpers";
import { acknowledgeHalftimePrompt, canShowHalftimePrompt, getHalftimePromptAckKey } from "./halftimePromptAck";

const TIMER_STATE_KEY = TIMER_STORAGE_KEY;
const getPitchStateKeyForTeam = getPitchStateKey;
const MAX_CLIENT_EXTRAPOLATION_SECS = MAX_EXTRAPOLATION_SECS;

const loadTimerState = (): TimerState | null => {
  try {
    const saved = localStorage.getItem(TIMER_STATE_KEY);
    if (!saved) return null;
    return JSON.parse(saved) as TimerState;
  } catch {
    return null;
  }
};

const loadPitchState = (teamId?: string): PitchBoardState | null => {
  try {
    if (teamId) {
      const teamSaved = localStorage.getItem(getPitchStateKeyForTeam(teamId));
      if (teamSaved) return JSON.parse(teamSaved) as PitchBoardState;

      const activeSaved = localStorage.getItem(PITCH_STATE_KEY);
      if (!activeSaved) return null;
      const activeState = JSON.parse(activeSaved) as PitchBoardState;
      return activeState.teamId === teamId ? activeState : null;
    }

    const saved = localStorage.getItem(PITCH_STATE_KEY);
    if (!saved) return null;
    return JSON.parse(saved) as PitchBoardState;
  } catch {
    return null;
  }
};

const savePitchState = (state: PitchBoardState) => {
  try {
    const json = JSON.stringify(state);
    // Write to team-specific key if teamId available
    if (state.teamId) {
      localStorage.setItem(getPitchStateKeyForTeam(state.teamId), json);
    }
    // Also write to active key
    localStorage.setItem(PITCH_STATE_KEY, json);
    // Dispatch custom event for same-tab sync (Android WebView)
    window.dispatchEvent(new CustomEvent('game-state-changed', { detail: { source: 'pitch-monitor' } }));
  } catch (e) {
    console.error("Failed to save pitch state:", e);
  }
};

const getTeamSizeNumber = (teamSize: string): number => {
  return parseInt(teamSize) || 11;
};

/**
 * Convert a v1-shaped local timer snapshot into the server-anchored (v2)
 * shape used by `pitch-timer-event` / `pitch-timer-read`. Elapsed time is
 * expressed as event timestamps so the server derives it from now(), which
 * is what makes resume-after-background drift-free.
 */
const toServerAnchoredTimerState = (t: TimerState) => {
  const nowMs = Date.now();
  const elapsed = Math.max(0, t.elapsedSeconds || 0);
  const hasProgress = elapsed > 0 || !!t.isRunning;
  const nowIso = new Date(nowMs).toISOString();
  return {
    schema_version: 2 as const,
    current_half: (t.currentHalf === 2 ? 2 : 1) as 1 | 2,
    minutes_per_half: t.minutesPerHalf,
    half_started_at: hasProgress ? new Date(nowMs - elapsed * 1000).toISOString() : null,
    half_paused_at: hasProgress && !t.isRunning ? nowIso : null,
    accumulated_pause_ms: 0,
    is_running: !!t.isRunning,
    is_game_finished: !!(t as TimerState & { isGameFinished?: boolean }).isGameFinished,
    half_ended_at: null,
    last_event_at: new Date(t.lastUpdateTime || nowMs).toISOString(),
  };
};


// recalculateRemainingPlan is imported from pitchStateUtils

export default function GlobalSubMonitor() {
  const { user } = useAuth();
  const { savePartialGameStats } = useGameStats();
  const { pitchBoardNotificationsEnabled } = usePitchBoardNotifications();
  const [pendingAutoSub, setPendingAutoSub] = useState<SubstitutionEvent | null>(null);
  const [pendingBatchSubs, setPendingBatchSubs] = useState<SubstitutionEvent[]>([]);
  const [subConfirmDialogOpen, setSubConfirmDialogOpen] = useState(false);
  const [currentPlayers, setCurrentPlayers] = useState<Player[]>([]);
  const [gameFinishedOpen, setGameFinishedOpen] = useState(false);
  const [manualFinish, setManualFinish] = useState(false);
  const [finishedGameData, setFinishedGameData] = useState<{
    players: Player[];
    totalGameTime: number;
    teamName?: string;
    teamId?: string;
    linkedEventId?: string | null;
    formationUsed?: string;
    teamSize?: number;
    executedSubs?: SubstitutionEvent[];
    halfDuration?: number;
    goals?: Goal[];
    eventTitle?: string;
    eventDate?: string;
    opponent?: string;
  } | null>(null);
  const lastCheckedSubRef = useRef<string | null>(null);
  const gameFinishedShownRef = useRef(false);
  const activeGameIdRef = useRef<string | null>(null);
  const finishedSyncHandledRef = useRef<string | null>(null);
  const immediateCheckRef = useRef<{ key: string; at: number } | null>(null);

  const triggerImmediatePitchCheck = useCallback(async (source: string, dedupeKey?: string) => {
    const now = Date.now();
    if (dedupeKey && immediateCheckRef.current?.key === dedupeKey && (now - immediateCheckRef.current.at) < 4000) {
      return;
    }

    if (dedupeKey) {
      immediateCheckRef.current = { key: dedupeKey, at: now };
    }

    try {
      const { error } = await supabase.functions.invoke('check-pending-subs', {
        body: { source },
      });

      if (error) {
        console.error('[SYNC] Failed to trigger immediate pitch check:', error);
      }
    } catch (error) {
      console.error('[SYNC] Error triggering immediate pitch check:', error);
    }
  }, []);

  // Sync game state to database for server-side push notifications
  const syncToDatabase = useCallback(async () => {
    if (!user?.id) {
      console.log('[SYNC] No user logged in, skipping sync');
      setSyncStatus({ status: "idle", lastSyncTime: null });
      return;
    }

    const timerState = loadTimerState();
    const pitchState = loadPitchState(timerState?.teamId);

    // The server-anchored timer (schema v2) is owned exclusively by the
    // `pitch-timer-event` edge function, which stores event timestamps
    // (half_started_at / last_event_at). Writing the v1 localStorage shape
    // ({ elapsedSeconds, lastUpdateTime, schema_version: 2 }) over the top
    // leaves a row that still LOOKS like v2 but has no half_started_at, so
    // `pitch-timer-read` derives elapsed = 0 and the next mount hydrates the
    // board at 00:00 — the "timer resets to 0 after the app is inactive"
    // defect. Never write timer_state for v2 boards; pitch_state only.
    //
    // The LOCAL marker alone is not a sufficient gate: active_games rows are
    // shared per team, so a device whose localStorage is still v1 would decide
    // "not anchored" and stomp the team's anchored row. Consult the row too.
    const remoteAnchored = await (async () => {
      try {
        const tId = timerState?.teamId || null;
        let q = supabase.from('active_games').select('timer_state').eq('is_active', true);
        q = tId ? q.eq('team_id', tId) : q.eq('user_id', user.id).is('team_id', null);
        const { data } = await q.order('updated_at', { ascending: false }).limit(1).maybeSingle();
        return hasAnchoredTimerMarker(data?.timer_state);
      } catch {
        return true; // fail safe: never downgrade on an unknown remote shape
      }
    })();
    const isServerAnchoredTimer =
      hasAnchoredTimerMarker(timerState) || remoteAnchored;

    /**
     * Deactivating the row is NOT a harmless bookkeeping write for a
     * server-anchored (v2) board.
     *
     * `pitch-timer-read` and `pitch-timer-event` both filter on
     * `is_active = true`. Once this loop flips the authoritative row inactive,
     * the next resume read returns `found: false` and the next `resume` event
     * finds no row to continue — so the edge function takes its "no existing
     * row" path and anchors a FRESH half from `half_started_at = now()`. The
     * coach presses play and the board snaps back to the start of the half,
     * discarding elapsed time and `accumulated_pause_ms`.
     *
     * That was reachable on any real match, because this loop deactivates on
     * every pause that is not exactly halftime — water breaks, injuries, or
     * pausing to fix a late kickoff. Lifecycle of a v2 row belongs solely to
     * `pitch-timer-event` (`end_game` / `reset` clear it); this legacy sync
     * loop must never revoke it.
     */
    const deactivateActiveGameRow = async (reason: string) => {
      if (!activeGameIdRef.current) return;
      if (isServerAnchoredTimer) {
        console.info('[SYNC] Keeping server-anchored active_games row active:', reason);
        return;
      }
      console.log('[SYNC] Deactivating game -', reason);
      await supabase
        .from('active_games')
        .update({ is_active: false })
        .eq('id', activeGameIdRef.current);
      activeGameIdRef.current = null;
    };


    console.log('[SYNC] Timer state:', timerState ? {
      isRunning: timerState.isRunning,
      currentHalf: timerState.currentHalf,
      elapsedSeconds: timerState.elapsedSeconds,
      minutesPerHalf: timerState.minutesPerHalf,
      teamId: timerState.teamId,
    } : null);
    console.log('[SYNC] Pitch state:', pitchState ? {
      autoSubActive: pitchState.autoSubActive,
      autoSubPaused: pitchState.autoSubPaused,
      planLength: pitchState.autoSubPlan?.length,
    } : null);

    // If no active game or timer not running with auto-subs, deactivate any existing game
    // Note: We sync even if autoSubPaused is true, so server can track the game
    // CRITICAL: Also check if the game is actually finished — if so, don't re-sync as active.
    // This prevents resurrecting finished games which causes duplicate full-time notifications.
    const halfDurationSecs = timerState ? timerState.minutesPerHalf * 60 : 0;
    const projectedElapsed = timerState ? getCurrentGameSeconds(timerState) : 0;
    const isFinished = timerState
      ? (Boolean((timerState as any).isGameFinished) ||
         (timerState.currentHalf === 2 && projectedElapsed >= halfDurationSecs))
      : false;

    const teamId = timerState?.teamId || pitchState?.teamId || null;
    const finishedSyncKey = isFinished
      ? `${teamId ?? 'no-team'}-${timerState?.gameFinishedAt ?? `${timerState?.currentHalf}-${halfDurationSecs}`}`
      : null;

    if (!isFinished) {
      finishedSyncHandledRef.current = null;
    }

    if (!timerState || !pitchState) {
      await deactivateActiveGameRow(`no local timer/pitch state (isFinished=${isFinished})`);
      setSyncStatus({ status: "idle", lastSyncTime: null });
      return;
    }

    const syncedTimerState = isFinished
      ? {
          ...timerState,
          currentHalf: 2,
          elapsedSeconds: halfDurationSecs,
          isRunning: false,
          lastUpdateTime: Date.now(),
          teamId: teamId || undefined,
          teamName: timerState.teamName || 'Your team',
          isGameFinished: true,
          gameFinishedAt: timerState.gameFinishedAt || Date.now(),
        }
      : {
          ...timerState,
          elapsedSeconds: projectedElapsed,
          lastUpdateTime: Date.now(),
          teamId: teamId || undefined,
          teamName: timerState.teamName || 'Your team',
        };

    if (isFinished) {
      if (finishedSyncKey && finishedSyncHandledRef.current === finishedSyncKey) {
        setSyncStatus({ status: "idle", lastSyncTime: null });
        return;
      }

      setSyncStatus({ status: "syncing", lastSyncTime: null });

      try {
        if (!activeGameIdRef.current) {
          const { data: existingGames, error: existingError } = await supabase
            .from('active_games')
            .select('id, team_id, updated_at')
            .eq('user_id', user.id)
            .eq('is_active', true)
            .order('updated_at', { ascending: false });

          if (existingError) {
            console.error('[SYNC] Failed to locate active game for full-time sync:', existingError);
          } else if (existingGames?.length) {
            const matchingGame = existingGames.find((game) => game.team_id === teamId) ?? existingGames[0];
            activeGameIdRef.current = matchingGame.id;

            const duplicateIds = existingGames
              .filter((game) => game.id !== matchingGame.id)
              .map((game) => game.id);

            if (duplicateIds.length > 0) {
              await supabase
                .from('active_games')
                .update({ is_active: false })
                .in('id', duplicateIds);
            }
          }
        }

        if (activeGameIdRef.current) {
          const { error } = await supabase
            .from('active_games')
            .update({
              user_id: user.id,
              team_id: teamId,
              ...(isServerAnchoredTimer ? {} : { timer_state: syncedTimerState as unknown as Json }),

              pitch_state: pitchState as unknown as Json,
              is_active: true,
              updated_at: new Date().toISOString(),
            })
            .eq('id', activeGameIdRef.current);

          if (error) {
            console.error('[SYNC] Final full-time sync failed:', error);
            setSyncStatus({ status: "error", lastSyncTime: Date.now(), error: error.message });
            return;
          }

          finishedSyncHandledRef.current = finishedSyncKey;
          await triggerImmediatePitchCheck('client-full-time-sync', `full-time-${finishedSyncKey}`);
          setSyncStatus({ status: "synced", lastSyncTime: Date.now() });
          return;
        }
      } catch (err) {
        console.error('[SYNC] Error during final full-time sync:', err);
        setSyncStatus({ status: "error", lastSyncTime: Date.now(), error: String(err) });
        return;
      }

      setSyncStatus({ status: "idle", lastSyncTime: null });
      return;
    }

    // Keep the game active during halftime break so the server can send
    // halftime push notifications. Halftime = half 2, elapsed 0, paused.
    //
    // NOTE: Do NOT gate this on `pitchState.autoSubActive`. Half-time, full-time,
    // and pending-sub notifications should fire whenever the board is linked to
    // an event (see `linkedEventId` gate below), regardless of whether the coach
    // has enabled the auto-sub plan. Previously this branch deactivated the
    // active_games row whenever auto-sub was off, which silently suppressed all
    // pitch-board pushes for coaches who never turned on auto-sub.
    const isHalftimeBreak = !timerState.isRunning && timerState.currentHalf === 2 && timerState.elapsedSeconds === 0;
    if (!timerState.isRunning && !isHalftimeBreak) {
      await deactivateActiveGameRow(`paused outside halftime (isFinished=${isFinished})`);
      setSyncStatus({ status: "idle", lastSyncTime: null });
      return;
    }
    
    // Skip syncing to active_games for event-group based games
    // Those are synced via useEventGroupSync to the event_groups table
    const isEventGroup = typeof teamId === 'string' && teamId.startsWith("event-group-");
    if (isEventGroup) {
      setSyncStatus({ status: "idle", lastSyncTime: null });
      return;
    }

    // If the pitch board has NOT been linked to an event, do not sync to
    // active_games. This prevents the server cron from sending half-time,
    // pending-sub, or full-time push/email notifications to coaches and team
    // admins for casual / unlinked sessions (e.g. when a coach is just moving
    // players around or experimenting with formations).
    if (!pitchState.linkedEventId) {
      await deactivateActiveGameRow('board not linked to an event');
      setSyncStatus({ status: "idle", lastSyncTime: null });
      return;
    }

    // If already at halftime boundary, pre-set last_sub_check_time so the cron
    // doesn't re-send half-time notifications when a new active_games row is created
    const isAtHalftime = timerState.currentHalf === 2 && timerState.elapsedSeconds === 0 && !timerState.isRunning;

    const gameData = {
      user_id: user.id,
      team_id: teamId,
      ...(isServerAnchoredTimer ? {} : { timer_state: syncedTimerState as unknown as Json }),
      pitch_state: pitchState as unknown as Json,
      is_active: true,
      updated_at: new Date().toISOString(),
      ...(isAtHalftime ? { last_sub_check_time: halfDurationSecs } : {}),
    };

    setSyncStatus({ status: "syncing", lastSyncTime: null });

    try {
      if (activeGameIdRef.current) {
        // Update existing game
        const { error } = await supabase
          .from('active_games')
          .update(gameData)
          .eq('id', activeGameIdRef.current);

        if (error) {
          console.error('[SYNC] Update failed:', error);
          activeGameIdRef.current = null;
          setSyncStatus({ status: "error", lastSyncTime: Date.now(), error: error.message });
        } else {
          console.log('[SYNC] Updated game:', activeGameIdRef.current);
          setSyncStatus({ status: "synced", lastSyncTime: Date.now() });
        }
      } else {
        // Find existing active game or create new one
        const { data: existingGames, error: existingError } = await supabase
          .from('active_games')
          .select('id, team_id, updated_at')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .order('updated_at', { ascending: false });

        if (existingError) {
          console.error('[SYNC] Failed to find existing active games:', existingError);
        }

        const existing = existingGames?.find((game) => game.team_id === teamId) ?? existingGames?.[0];

        if (existing) {
          activeGameIdRef.current = existing.id;

          const duplicateIds = (existingGames || [])
            .filter((game) => game.id !== existing.id)
            .map((game) => game.id);

          if (duplicateIds.length > 0) {
            await supabase
              .from('active_games')
              .update({ is_active: false })
              .in('id', duplicateIds);
          }

          await supabase
            .from('active_games')
            .update(gameData)
            .eq('id', existing.id);
          console.log('[SYNC] Resumed existing game:', existing.id);
          setSyncStatus({ status: "synced", lastSyncTime: Date.now() });
        } else {
          // The `existing` lookup above is scoped by `user_id`, so a live
          // server-anchored row owned by a DIFFERENT controller (co-coach,
          // team admin) is invisible here. Synthesising a fresh anchor in that
          // case would either collide with `uniq_active_games_team_active` or —
          // if the real row had just been released — create a second,
          // independently anchored row for the same team whose
          // `half_started_at = now()` silently discards the real match history.
          // Let `pitch-timer-event` own row creation for anchored boards.
          if (isServerAnchoredTimer) {
            console.info('[SYNC] Anchored board with no row owned by this user — deferring to pitch-timer-event');
            setSyncStatus({ status: "idle", lastSyncTime: null });
            return;
          }

          // Deactivate ALL previous games for this user before creating a new one
          // This prevents stale games from triggering false half-time notifications
          await supabase
            .from('active_games')
            .update({ is_active: false })
            .eq('user_id', user.id)
            .eq('is_active', true);


          const { data: newGame, error } = await supabase
            .from('active_games')
            .insert({
              ...gameData,
              // A brand-new row must carry a valid timer_state or the
              // pending-sub / half-time cron has nothing to read. For
              // server-anchored boards we synthesise a correctly shaped v2
              // state (event timestamps, not elapsedSeconds) so
              // `pitch-timer-read` derives the right elapsed value.
              timer_state: (isServerAnchoredTimer
                ? toServerAnchoredTimerState(syncedTimerState as unknown as TimerState)
                : (syncedTimerState as unknown)) as Json,
            })

            .select()
            .single();

          if (!error && newGame) {
            activeGameIdRef.current = newGame.id;
            console.log('[SYNC] Created new game:', newGame.id);
            setSyncStatus({ status: "synced", lastSyncTime: Date.now() });
          } else if (error) {
            console.error('[SYNC] Insert failed:', error);
            setSyncStatus({ status: "error", lastSyncTime: Date.now(), error: error.message });
          }
        }
      }
    } catch (err) {
      console.error('[SYNC] Error:', err);
      setSyncStatus({ status: "error", lastSyncTime: Date.now(), error: String(err) });
    }
  }, [triggerImmediatePitchCheck, user?.id]);

  // Create database notification which triggers server-side push via database trigger
  const createPitchBoardNotification = useCallback(async (type: string, message: string) => {
    if (!user?.id) return;
    if (!pitchBoardNotificationsEnabled) return; // Check preference
    
    try {
      const { error } = await supabase
        .from('notifications')
        .insert({
          user_id: user.id,
          type,
          message,
          related_id: null,
        });
      if (error) {
        console.log('Failed to create notification:', error);
      }
    } catch (error) {
      console.log('Notification creation failed:', error);
    }
  }, [user?.id, pitchBoardNotificationsEnabled]);

  // Check for game finished
  const checkForGameFinished = useCallback(async () => {
    const isPitchBoardOpen = localStorage.getItem(PITCH_BOARD_OPEN_KEY) === "true";
    if (isPitchBoardOpen) return;
    if (gameFinishedShownRef.current) return;

    const timerState = loadTimerState();
    const pitchState = loadPitchState(timerState?.teamId);

    if (!timerState || !pitchState) return;

    // Calculate current elapsed time using centralized utility
    const halfDuration = timerState.minutesPerHalf * 60;
    const currentElapsed = getCurrentGameSeconds(timerState);

    // Game is finished when 2nd half timer reaches full time
    const isGameFinished = timerState.currentHalf === 2 && currentElapsed >= halfDuration;

    if (isGameFinished) {
      gameFinishedShownRef.current = true;
      
      // Calculate total game time (both halves)
      const totalGameTime = halfDuration * 2;

      // Play finish beep only if sound is enabled
      if (timerState.soundEnabled) {
        try {
          playTimerBeep();
        } catch {
          // Audio may fail silently
        }
      }

      const notificationTitle = "🏆 Game Finished!";
      const notificationBody = timerState.teamName ? `${timerState.teamName} - Full Time` : "Full Time";

      // Show browser notification (only if preference enabled)
      if (pitchBoardNotificationsEnabled) {
        requestNotificationPermission().then(() => {
          showBrowserNotification(notificationTitle, notificationBody);
        });
      }

      // NOTE: Do NOT create a client-side 'game_finished' notification here.
      // The server-side 'check-pending-subs' edge function already detects game
      // completion and sends push notifications with atomic dedup. Inserting
      // a notification from the client as well causes duplicate pushes.

      // Fetch event details if linked
      let eventTitle: string | undefined;
      let eventDate: string | undefined;
      let opponent: string | undefined;

      if (pitchState.linkedEventId) {
        try {
          const { data: eventData } = await supabase
            .from('events')
            .select('title, event_date, opponent')
            .eq('id', pitchState.linkedEventId)
            .single();
          
          if (eventData) {
            eventTitle = eventData.title;
            eventDate = eventData.event_date ? new Date(eventData.event_date).toLocaleDateString() : undefined;
            opponent = eventData.opponent || undefined;
          }
        } catch (err) {
          console.error('[GAME] Error fetching event details:', err);
        }
      }

      setFinishedGameData({
        players: pitchState.players,
        totalGameTime,
        teamName: timerState.teamName,
        teamId: pitchState.teamId,
        linkedEventId: pitchState.linkedEventId,
        formationUsed: undefined, // TODO: Add to pitchState if needed
        teamSize: parseInt(pitchState.teamSize) || 7,
        executedSubs: pitchState.executedSubs || pitchState.autoSubPlan?.filter(s => s.executed) || [],
        halfDuration,
        goals: pitchState.goals || [],
        eventTitle,
        eventDate,
        opponent,
      });
      setGameFinishedOpen(true);
    }
  }, [createPitchBoardNotification, pitchBoardNotificationsEnabled]);

  const handleGameFinishedClose = useCallback(() => {
    setGameFinishedOpen(false);
    setFinishedGameData(null);
    setManualFinish(false);
    gameFinishedShownRef.current = false;
  }, []);

  // Manual "End game & save stats" — works while the board is open and at any
  // timer state, because coaches routinely pause or close the app before full
  // time and would otherwise never persist the session.
  const openManualFinish = useCallback(async (requestedTeamId?: string | null) => {
    const timerState = loadTimerState();
    const pitchState = loadPitchState(requestedTeamId || timerState?.teamId);
    if (!pitchState) return;

    const minutesPerHalf = timerState?.minutesPerHalf ?? 0;
    const halfDuration = minutesPerHalf * 60;
    const elapsed = timerState ? getCurrentGameSeconds(timerState) : 0;
    const priorHalf = timerState?.currentHalf === 2 ? halfDuration : 0;

    let eventTitle: string | undefined;
    let eventDate: string | undefined;
    let opponent: string | undefined;
    if (pitchState.linkedEventId) {
      try {
        const { data: eventData } = await supabase
          .from('events')
          .select('title, event_date, opponent')
          .eq('id', pitchState.linkedEventId)
          .maybeSingle();
        if (eventData) {
          eventTitle = eventData.title;
          eventDate = eventData.event_date ? new Date(eventData.event_date).toLocaleDateString() : undefined;
          opponent = eventData.opponent || undefined;
        }
      } catch (err) {
        console.error('[GAME] Error fetching event details:', err);
      }
    }

    setFinishedGameData({
      players: pitchState.players,
      totalGameTime: priorHalf + elapsed,
      teamName: timerState?.teamName,
      teamId: pitchState.teamId || requestedTeamId || undefined,
      linkedEventId: pitchState.linkedEventId,
      teamSize: parseInt(pitchState.teamSize) || 7,
      executedSubs: pitchState.executedSubs || pitchState.autoSubPlan?.filter(s => s.executed) || [],
      halfDuration: halfDuration || Math.max(1, Math.floor((priorHalf + elapsed) / 2)),
      goals: pitchState.goals || [],
      eventTitle,
      eventDate,
      opponent,
    });
    setManualFinish(true);
    setGameFinishedOpen(true);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<EndGameRequestDetail>).detail;
      void openManualFinish(detail?.teamId);
    };
    window.addEventListener(END_GAME_REQUEST_EVENT, handler);
    return () => window.removeEventListener(END_GAME_REQUEST_EVENT, handler);
  }, [openManualFinish]);

  // Safety net: persist a PARTIAL save when the app goes to the background so a
  // coach who simply closes the app doesn't lose the session's stats. Rows are
  // keyed by event and replaced on the next save, so a later full-time or
  // manual finalisation overwrites this snapshot.
  const lastPartialSaveRef = useRef(0);
  useEffect(() => {
    const savePartial = () => {
      if (Date.now() - lastPartialSaveRef.current < 60_000) return;
      const timerState = loadTimerState();
      const pitchState = loadPitchState(timerState?.teamId);
      if (!pitchState?.linkedEventId) return;
      const elapsed = timerState ? getCurrentGameSeconds(timerState) : 0;
      if (elapsed <= 0) return;
      const halfDuration = (timerState?.minutesPerHalf ?? 0) * 60;
      const priorHalf = timerState?.currentHalf === 2 ? halfDuration : 0;
      lastPartialSaveRef.current = Date.now();
      void savePartialGameStats({
        eventId: pitchState.linkedEventId,
        teamId: pitchState.teamId,
        players: pitchState.players,
        totalGameTime: priorHalf + elapsed,
        halfDuration: halfDuration || Math.max(1, Math.floor((priorHalf + elapsed) / 2)),
        teamSize: parseInt(pitchState.teamSize) || 7,
        executedSubs:
          pitchState.executedSubs || pitchState.autoSubPlan?.filter((s) => s.executed) || [],
        goals: pitchState.goals || [],
      }).catch((err) => console.warn('[GAME] partial stats save failed', err));
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') savePartial();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', savePartial);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', savePartial);
    };
  }, [savePartialGameStats]);




  const checkForPendingSubs = useCallback(() => {
    // Check if pitch board is currently open (it handles its own subs)
    const isPitchBoardOpen = localStorage.getItem(PITCH_BOARD_OPEN_KEY) === "true";
    if (isPitchBoardOpen) return;

    const timerState = loadTimerState();
    const pitchState = loadPitchState(timerState?.teamId);

    if (!timerState || !pitchState) return;
    if (pitchState.autoSubPaused) return;

    // Guard against stale/finished games re-triggering the "Half Time" popup
    // every time the user opens the app. If the timer has been sitting idle
    // for hours, or the game was already marked finished, clear the persisted
    // state so the popup doesn't resurrect on every cold-start.
    const STALE_TIMER_MS = 4 * 60 * 60 * 1000; // 4h
    const lastUpdate = timerState.lastUpdateTime ?? 0;
    const isStale =
      Boolean((timerState as any).isGameFinished) ||
      (lastUpdate > 0 && Date.now() - lastUpdate > STALE_TIMER_MS);
    if (isStale) {
      try {
        localStorage.removeItem(TIMER_STATE_KEY);
      } catch { /* ignore */ }
      lastCheckedSubRef.current = null;
      return;
    }

    // Calculate halftime state before early-returning on empty plan
    const halfDuration = timerState.minutesPerHalf * 60;
    const elapsed = getCurrentGameSeconds(timerState);
    const isHalftimeBreakEarly = !timerState.isRunning && timerState.currentHalf === 2 && elapsed === 0;

    // Allow halftime check to proceed even with empty plan
    if (!isHalftimeBreakEarly && (!pitchState.autoSubActive || pitchState.autoSubPlan.length === 0)) return;

    // Reuse already-calculated values
    const currentElapsed = elapsed;
    const currentHalf = timerState.currentHalf;

    // Don't show sub notifications if game is finished
    if (timerState.currentHalf === 2 && currentElapsed >= halfDuration) return;

    // Check for halftime subs during the break (timer stopped, half=2, elapsed=0)
    const isHalftimeBreak = !timerState.isRunning && currentHalf === 2 && currentElapsed === 0;
    
    if (isHalftimeBreak) {
      // Unified gate: must be at genuine halftime boundary AND not acknowledged.
      if (!canShowHalftimePrompt(timerState, pitchState)) return;


      const staleFirstHalfSubs = pitchState.autoSubPlan.filter(sub => !sub.executed && sub.half === 1);
      const halftimeSubs = pitchState.autoSubPlan.filter(sub =>
        !sub.executed && sub.half === 2 && sub.time === 0
      );

      let nextPitchState = pitchState;
      if (staleFirstHalfSubs.length > 0) {
        const staleKeys = staleFirstHalfSubs.map(getSubKey);
        const updatedPlan = markSubsExecuted(pitchState.autoSubPlan, staleKeys, true);
        nextPitchState = { ...pitchState, autoSubPlan: updatedPlan, lastUpdateTime: Date.now() };
        savePitchState(nextPitchState);
        setPendingAutoSub(null);
        setPendingBatchSubs([]);
        setSubConfirmDialogOpen(false);
        lastCheckedSubRef.current = null;
      }

      if (halftimeSubs.length > 0) {
        const [primarySub, ...additionalSubs] = halftimeSubs;
        const subKey = `halftime-batch-${halftimeSubs.length}`;
        if (lastCheckedSubRef.current !== subKey) {
          lastCheckedSubRef.current = subKey;
          if (timerState.soundEnabled) {
            try { playSubAlertBeep(); } catch { /* Audio may fail */ }
          }

          void (async () => {
            await syncToDatabase();
            await triggerImmediatePitchCheck('client-halftime-sync', subKey);
          })();

          setCurrentPlayers(nextPitchState.players);
          setPendingAutoSub(primarySub);
          setPendingBatchSubs(additionalSubs);
          setSubConfirmDialogOpen(true);
        }
      } else {
        // No halftime subs — still show a halftime notification
        const subKey = `halftime-no-subs`;
        if (lastCheckedSubRef.current !== subKey) {
          lastCheckedSubRef.current = subKey;
          if (timerState.soundEnabled) {
            try { playSubAlertBeep(); } catch { /* Audio may fail */ }
          }

          void (async () => {
            await syncToDatabase();
            await triggerImmediatePitchCheck('client-halftime-sync', subKey);
          })();

          setCurrentPlayers(nextPitchState.players);
          setPendingAutoSub(null);
          setPendingBatchSubs([]);
          setSubConfirmDialogOpen(true);
        }
      }
      return;
    }

    // For non-halftime subs, timer must be running
    if (!timerState.isRunning) return;

    const { latestDueSubs: dueSubs, olderDueSubs: olderSubs } = getDueSubGroups(
      pitchState.autoSubPlan,
      currentHalf,
      currentElapsed,
      halfDuration
    );

    if (dueSubs.length > 0) {
      let activePitchState = pitchState;

      // Grace-window bundling: a slightly-late missed sub (within
      // STALE_SUB_GRACE_SECONDS of the newest due sub) is folded into the
      // current confirm batch instead of being silently auto-skipped.
      // Only truly stale subs (older than the grace window) get auto-skipped.
      const latestDueAbs = getSubTotalSeconds(dueSubs[0], halfDuration);
      const recentlyMissed = olderSubs.filter(
        s => latestDueAbs - getSubTotalSeconds(s, halfDuration) <= STALE_SUB_GRACE_SECONDS
      );
      const trulyStale = olderSubs.filter(
        s => latestDueAbs - getSubTotalSeconds(s, halfDuration) > STALE_SUB_GRACE_SECONDS
      );

      if (trulyStale.length > 0) {
        const staleKeys = trulyStale.map(s => getSubKey(s));
        const updatedPlan = markSubsExecuted(pitchState.autoSubPlan, staleKeys, true);
        activePitchState = { ...pitchState, autoSubPlan: updatedPlan };
        savePitchState(activePitchState);
      }

      // Show recently-missed (oldest first) then the newest due batch.
      const batchSubs = [
        ...recentlyMissed.sort(
          (a, b) => getSubTotalSeconds(a, halfDuration) - getSubTotalSeconds(b, halfDuration)
        ),
        ...dueSubs,
      ];

      if (batchSubs.length === 0) return;

      const [primarySub, ...additionalSubs] = batchSubs;
      const subKey = `${primarySub.half}-${primarySub.time}-batch-${batchSubs.length}`;

      if (lastCheckedSubRef.current !== subKey) {
        lastCheckedSubRef.current = subKey;

        const notificationBody = batchSubs.length > 1
          ? `Time for ${batchSubs.length} substitutions`
          : `${primarySub.playerOut.name || `#${primarySub.playerOut.number}`} → Bench. ${primarySub.playerIn.name || `#${primarySub.playerIn.number}`} → ${primarySub.playerOut.currentPitchPosition || 'Unknown'}`;

        if (timerState.soundEnabled) {
          try {
            playSubAlertBeep();
          } catch {
            // Audio may fail silently
          }
        }

        // IMPORTANT: Do not create browser/DB notifications here.
        // Server-side check-pending-subs already sends pending_sub notifications,
        // and triggering them here causes duplicate device notifications.

        // Trigger immediate DB sync AND immediate server-side check so push
        // fires right away instead of waiting for the next background cycle.
        void (async () => {
          await syncToDatabase();
          await triggerImmediatePitchCheck('client-pending-sub-sync', subKey);
        })();

        setCurrentPlayers(activePitchState.players);
        setPendingAutoSub(primarySub);
        setPendingBatchSubs(additionalSubs);
        setSubConfirmDialogOpen(true);
      }
    }
  }, [syncToDatabase, triggerImmediatePitchCheck]);

  // Check if there's an active game that needs monitoring
  const hasActiveGame = useCallback(() => {
    const timerState = loadTimerState();
    const pitchState = loadPitchState(timerState?.teamId);
    
    if (!timerState || !pitchState) return false;

    const halfDuration = timerState.minutesPerHalf * 60;
    const projectedElapsed = getCurrentGameSeconds(timerState);
    const isFinished = Boolean(timerState.isGameFinished) || (timerState.currentHalf === 2 && projectedElapsed >= halfDuration);

    if (isFinished) return false;
    
    // Monitor when timer is running
    if (timerState.isRunning) return true;
    
    // Monitor during halftime break (half=2, elapsed=0, not running) — always show halftime popup
    if (!timerState.isRunning && timerState.currentHalf === 2 && timerState.elapsedSeconds === 0) {
      if (pitchState.autoSubActive) {
        return true;
      }
    }
    
    if (!pitchState.autoSubActive || pitchState.autoSubPlan.length === 0) return false;
    if (pitchState.autoSubPaused) return false;
    
    return true;
  }, []);

  // Force-open sub confirmation from notification click
  const forceOpenSubConfirmation = useCallback(() => {
    const timerState = loadTimerState();
    const pitchState = loadPitchState(timerState?.teamId);
    if (!pitchState || !timerState) return;

    // Calculate current elapsed time using centralized utility
    const halfDuration = timerState.minutesPerHalf * 60;
    const currentElapsed = getCurrentGameSeconds(timerState);
    const currentHalf = timerState.currentHalf;

    const { latestDueSubs: dueSubs, olderDueSubs: olderSubs } = getDueSubGroups(
      pitchState.autoSubPlan || [],
      currentHalf,
      currentElapsed,
      timerState.minutesPerHalf * 60
    );

    if (dueSubs.length > 0) {
      // Auto-skip older time groups, then rebuild future subs from the current game state.
      let nextPitchState = pitchState;
      const latestDueSub = dueSubs[0];
      let latestTime = latestDueSub.time;

      // Grace-window bundling (mirrors the regular monitor flow): a missed
      // sub that's only a little stale is presented in the same dialog as
      // the newest due sub instead of being silently auto-skipped, giving
      // the coach a chance to action it.
      const latestDueAbs = getSubTotalSeconds(latestDueSub, timerState.minutesPerHalf * 60);
      const recentlyMissed = olderSubs.filter(
        s => latestDueAbs - getSubTotalSeconds(s, timerState.minutesPerHalf * 60) <= STALE_SUB_GRACE_SECONDS
      );
      const trulyStaleOlderSubs = olderSubs.filter(
        s => latestDueAbs - getSubTotalSeconds(s, timerState.minutesPerHalf * 60) > STALE_SUB_GRACE_SECONDS
      );

      if (trulyStaleOlderSubs.length > 0) {
        const olderKeys = trulyStaleOlderSubs.map(s => getSubKey(s));
        const latestMissedSub = trulyStaleOlderSubs[trulyStaleOlderSubs.length - 1];

        let updatedPlan = markSubsExecuted(pitchState.autoSubPlan || [], olderKeys, true);

        if (latestMissedSub) {
          const executedSubs = updatedPlan.filter(s => s.executed);
          const currentDueSubs = updatedPlan.filter(s => !s.executed && s.half === currentHalf && s.time === latestTime);
          const futureSubsExist = updatedPlan.some(s => !s.executed && !(s.half === currentHalf && s.time === latestTime));

          if (futureSubsExist) {
                // Simulate currentDueSubs on the players array using shared helper
                const { updatedPlayers: simulatedPlayers } = executeSubsOnPlayers(currentDueSubs, pitchState.players);
                const existingFutureSubs = updatedPlan.filter(s => !s.executed && !(s.half === currentHalf && s.time === latestTime));

                const recalculated = recalculateRemainingPlan(
                  simulatedPlayers,
                  getTeamSizeNumber(pitchState.teamSize),
                  timerState.minutesPerHalf * 60,
                  currentElapsed,
                  currentHalf,
                  latestMissedSub,
                  true
                );

                // Safety guard: preserve existing future subs if recalculation shrinks the plan
                if (recalculated.length >= existingFutureSubs.length || existingFutureSubs.length === 0) {
                  updatedPlan = [...executedSubs, ...currentDueSubs, ...recalculated];
                } else {
                  const benchPlayers = simulatedPlayers.filter((p: Player) => p.position === null && !p.isInjured);
                  if (benchPlayers.length > 0 && recalculated.length === 0) {
                    console.warn("[GlobalSubMonitor] Auto-skip recalculation returned empty — preserving existing future subs");
                    updatedPlan = [...executedSubs, ...currentDueSubs, ...existingFutureSubs];
                  } else {
                    console.warn("[GlobalSubMonitor] Auto-skip recalculation shortened plan — preserving existing future subs");
                    updatedPlan = [...executedSubs, ...currentDueSubs, ...existingFutureSubs];
                  }
                }
              }
        }

        nextPitchState = { ...pitchState, autoSubPlan: updatedPlan };
        savePitchState(nextPitchState);
        window.dispatchEvent(new StorageEvent('storage', { key: PITCH_STATE_KEY }));
      }

      const refreshedDueSubs = getDueSubGroups(
        nextPitchState.autoSubPlan || [],
        currentHalf,
        currentElapsed,
        timerState.minutesPerHalf * 60
      ).latestDueSubs.filter(sub => sub.time === latestTime);
      // Surface recently-missed subs (oldest first) alongside the newest due batch.
      const orderedRecentlyMissed = [...recentlyMissed].sort(
        (a, b) =>
          getSubTotalSeconds(a, timerState.minutesPerHalf * 60) -
          getSubTotalSeconds(b, timerState.minutesPerHalf * 60)
      );
      const combined = [...orderedRecentlyMissed, ...refreshedDueSubs];
      const [primarySub, ...additionalSubs] = combined;
      setCurrentPlayers(nextPitchState.players);
      setPendingAutoSub(primarySub);
      setPendingBatchSubs(additionalSubs);
      setSubConfirmDialogOpen(true);
      return;
    }

    // No pending subs - show the most recent executed sub in read-only mode
    const executedSubs = pitchState.autoSubPlan?.filter(s => s.executed) || [];
    if (executedSubs.length > 0) {
      const lastExecuted = executedSubs[executedSubs.length - 1];
      setCurrentPlayers(pitchState.players);
      setPendingAutoSub(lastExecuted);
      setPendingBatchSubs([]);
      setSubConfirmDialogOpen(true);
    }
  }, []);


  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let syncIntervalId: ReturnType<typeof setInterval> | null = null;
    
    const startPolling = () => {
      const isPitchBoardOpen = localStorage.getItem(PITCH_BOARD_OPEN_KEY) === "true";
      const gameActive = hasActiveGame();
      
      // Sub checking only when pitch board is closed (it handles its own subs)
      if (!isPitchBoardOpen && gameActive) {
        if (intervalId) clearInterval(intervalId);
        intervalId = setInterval(() => {
          checkForPendingSubs();
          checkForGameFinished();
        }, 5000);
        checkForPendingSubs();
        checkForGameFinished();
      } else if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      
      // Database sync runs whether pitch board is open or closed (for background notifications)
      if (gameActive && !syncIntervalId) {
        console.log('[SYNC] Starting sync interval');
        syncToDatabase(); // Immediate sync
        syncIntervalId = setInterval(syncToDatabase, 10000); // Sync every 10s
      } else if (!gameActive && syncIntervalId) {
        console.log('[SYNC] Stopping sync interval - no active game');
        clearInterval(syncIntervalId);
        syncIntervalId = null;
        setSyncStatus({ status: "idle", lastSyncTime: null });
      }
    };
    
    // Check when visibility changes - critical for mobile where background intervals are throttled
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Immediately sync on foreground return to refresh updated_at
        // This prevents the edge function from marking the game as stale
        syncToDatabase();
        startPolling();
      } else {
        // When app goes to background, do one final sync
        syncToDatabase();
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
        // Keep syncIntervalId running - even if throttled, it will fire eventually
      }
    };
    
    // Capacitor native app state change - more reliable than visibilitychange on Android
    let appStateListener: any = null;
    const setupNativeListener = async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app');
        appStateListener = await CapApp.addListener('appStateChange', ({ isActive }) => {
          if (isActive) {
            console.log('[SYNC] Native app resumed - forcing sync');
            syncToDatabase();
            startPolling();
          } else {
            console.log('[SYNC] Native app backgrounded - final sync');
            syncToDatabase();
          }
        });
      } catch {
        // Not in Capacitor - that's fine, visibilitychange will handle it
      }
    };
    setupNativeListener();
    
    // Listen for storage changes to detect game state changes (cross-tab)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === TIMER_STATE_KEY || e.key?.startsWith(PITCH_STATE_KEY) || e.key === PITCH_BOARD_OPEN_KEY) {
        startPolling();
        syncToDatabase(); // Sync on state change
      }
    };
    
    // Listen for same-tab game state changes (critical for Android WebView
    // where StorageEvent doesn't fire for same-window localStorage writes)
    const handleGameStateChanged = () => {
      startPolling();
      syncToDatabase();
    };
    
    // Listen for notification clicks requesting sub confirmation
    const handleOpenSubConfirmation = () => forceOpenSubConfirmation();
    window.addEventListener('open-sub-confirmation', handleOpenSubConfirmation);

    // When the full pitch board is being opened (e.g. via a pending_sub push
    // tap), suppress GlobalSubMonitor's own SubConfirmDialog. Otherwise the
    // user sees the same sub prompted twice — once by the global monitor
    // (which fired on app-resume before the board had a chance to mount) and
    // once by the board itself once it takes over. The board owns the dialog
    // while it's open; this listener hands control over cleanly.
    const handleOpenPitchBoard = () => {
      setSubConfirmDialogOpen(false);
      setPendingAutoSub(null);
      setPendingBatchSubs([]);
      lastCheckedSubRef.current = null;
    };
    window.addEventListener('open-pitch-board', handleOpenPitchBoard);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('game-state-changed', handleGameStateChanged);
    
    // Initial setup
    startPolling();

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (syncIntervalId) clearInterval(syncIntervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('game-state-changed', handleGameStateChanged);
      window.removeEventListener('open-sub-confirmation', handleOpenSubConfirmation);
      window.removeEventListener('open-pitch-board', handleOpenPitchBoard);
      appStateListener?.remove?.();
    };
  }, [checkForPendingSubs, checkForGameFinished, hasActiveGame, syncToDatabase]);

  const handleConfirmAutoSub = useCallback(() => {
    if (!pendingAutoSub) return;

    const timerState = loadTimerState();
    const pitchState = loadPitchState(timerState?.teamId);
    if (!pitchState) return;

    // Guard: check if this sub was already skipped
    const matchingSub = pitchState.autoSubPlan?.find(s =>
      s.playerOut.id === pendingAutoSub.playerOut.id && 
      s.time === pendingAutoSub.time && 
      s.half === pendingAutoSub.half
    );
    if (matchingSub?.executed || matchingSub?.skipped) {
      setSubConfirmDialogOpen(false);
      setPendingAutoSub(null);
      setPendingBatchSubs([]);
      lastCheckedSubRef.current = null;
      return;
    }

    // Use shared helper to execute subs
    const allPendingSubs = [pendingAutoSub, ...pendingBatchSubs];
    const { updatedPlayers, executedSubKeys, skippedSubKeys } = executeSubsOnPlayers(allPendingSubs, pitchState.players);

    // Mark processed subs as executed, and skipped subs as skipped
    let finalPlan = markSubsExecuted(pitchState.autoSubPlan, executedSubKeys);
    finalPlan = markSubsExecuted(finalPlan, skippedSubKeys, true);
    
    // Recalculate if significantly late (>30s)
    if (timerState && finalPlan.some(sub => !sub.executed)) {
      const halfDuration = timerState.minutesPerHalf * 60;
      const currentElapsed = getCurrentGameSeconds(timerState);
      const delaySeconds = calculateSubDelay(pendingAutoSub, currentElapsed, timerState.currentHalf as 1 | 2, halfDuration);
      
      // Also detect early execution
      const scheduledTime = pendingAutoSub.time;
      const earlyBySeconds = pendingAutoSub.half === (timerState.currentHalf as 1 | 2)
        ? Math.max(0, scheduledTime - currentElapsed)
        : 0;
      const isSignificantlyEarly = earlyBySeconds > 15;
      const isSignificantlyLate = delaySeconds > 30;
      // Always recalculate after halftime subs — player positions change at the break
      // and the remaining plan references pre-halftime positions, causing cascade skips.
      const isHalftimeSub = pendingAutoSub.half === 2 && pendingAutoSub.time === 0;

      if (isSignificantlyLate || isSignificantlyEarly || isHalftimeSub) {
        console.log(`[GlobalSubMonitor] Sub was ${isSignificantlyLate ? Math.round(delaySeconds / 60) + 'm late' : Math.round(earlyBySeconds) + 's early'}, recalculating remaining plan`);
        const executedPlan = finalPlan.filter(sub => sub.executed);
        const remainingSubs = finalPlan.filter(sub => !sub.executed);
        const recalculated = recalculateRemainingPlan(
          updatedPlayers,
          getTeamSizeNumber(pitchState.teamSize),
          halfDuration,
          currentElapsed,
          timerState.currentHalf as 1 | 2,
          { ...pendingAutoSub, executed: true },
          true
        );
        // Safety guard: don't let recalculation wipe the plan
        if (recalculated.length > 0 || remainingSubs.length === 0) {
          finalPlan = [...executedPlan, ...recalculated];
        } else {
          const benchPlayers = updatedPlayers.filter((p: Player) => p.position === null && !p.isInjured);
          if (benchPlayers.length > 0) {
            console.warn("[GlobalSubMonitor] Recalculation returned empty but bench players remain — preserving existing plan");
            finalPlan = [...executedPlan, ...remainingSubs];
          } else {
            finalPlan = [...executedPlan, ...recalculated];
          }
        }
      }
    }

    // Always validate remaining plan against updated player positions
    finalPlan = validateAndFixRemainingPlan(finalPlan, updatedPlayers);
    
    savePitchState({
      ...pitchState,
      players: updatedPlayers,
      autoSubPlan: finalPlan,
      autoSubActive: pitchState.autoSubActive,
      lastUpdateTime: Date.now(),
    });
    
    setSubConfirmDialogOpen(false);
    setPendingAutoSub(null);
    setPendingBatchSubs([]);
    lastCheckedSubRef.current = null;
  }, [pendingAutoSub, pendingBatchSubs]);

  const handleSkipAutoSub = useCallback(() => {
    if (!pendingAutoSub) return;

    const timerState = loadTimerState();
    const pitchState = loadPitchState(timerState?.teamId);
    if (!pitchState) return;

    const subsToSkip = [pendingAutoSub, ...pendingBatchSubs];
    const skippedKeys = subsToSkip.map(sub => getSubKey(sub));

    let updatedPlan = markSubsExecuted(pitchState.autoSubPlan, skippedKeys, true);
    const existingUnexecuted = updatedPlan.filter(sub => !sub.executed);
    const executedSubs = updatedPlan.filter(sub => sub.executed);

    let finalPlan = updatedPlan;

    if (timerState && existingUnexecuted.length > 0) {
      const halfDuration = timerState.minutesPerHalf * 60;
      const currentElapsed = getCurrentGameSeconds(timerState);
      const currentHalf = timerState.currentHalf as 1 | 2;

      // Recalculate if significantly late (>30s overdue) OR if skipping a halftime sub
      // (player positions change at the break, so remaining plan would reference stale positions)
      const isHalftimeSkip = pendingAutoSub.half === 2 && pendingAutoSub.time === 0;
      const shouldRecalculate = isHalftimeSkip || subsToSkip.some(sub =>
        calculateSubDelay(sub, currentElapsed, currentHalf, halfDuration) > 30
      );

      if (shouldRecalculate) {
        const recalculated = recalculateRemainingPlan(
          pitchState.players,
          getTeamSizeNumber(pitchState.teamSize),
          halfDuration,
          currentElapsed,
          currentHalf,
          pendingAutoSub,
          true
        );

        // Safety guard: if recalculation shrinks the plan, preserve existing schedule
        if (recalculated.length >= existingUnexecuted.length || existingUnexecuted.length === 0) {
          finalPlan = [...executedSubs, ...recalculated];
        } else {
          // Check if bench players still exist — only preserve if they do
          const benchPlayers = pitchState.players.filter((p: Player) => p.position === null && !p.isInjured);
          if (benchPlayers.length > 0 && recalculated.length === 0) {
            console.warn("[GlobalSubMonitor] Recalculation returned empty but bench players remain — preserving existing plan");
            finalPlan = [...executedSubs, ...existingUnexecuted];
          } else {
            console.warn("[GlobalSubMonitor] Recalculation shortened plan — preserving existing plan");
            finalPlan = [...executedSubs, ...existingUnexecuted];
          }
        }
      } else {
        // Not significantly late — just keep the existing unexecuted subs
        finalPlan = [...executedSubs, ...existingUnexecuted];
      }
    }

    // Always validate after any plan change
    finalPlan = validateAndFixRemainingPlan(finalPlan, pitchState.players);

    savePitchState({
      ...pitchState,
      autoSubPlan: finalPlan,
      autoSubActive: pitchState.autoSubActive,
      lastUpdateTime: Date.now(),
    });
    
    setSubConfirmDialogOpen(false);
    setPendingAutoSub(null);
    setPendingBatchSubs([]);
    lastCheckedSubRef.current = null;
  }, [pendingAutoSub, pendingBatchSubs]);

  const handleAcknowledgeHalftime = useCallback(() => {
    const timerState = loadTimerState();
    const pitchState = loadPitchState(timerState?.teamId);
    acknowledgeHalftimePrompt(getHalftimePromptAckKey(timerState, pitchState));
  }, []);

  return (
    <>
      <SubConfirmDialog
        open={subConfirmDialogOpen}
        onOpenChange={setSubConfirmDialogOpen}
        substitution={pendingAutoSub}
        batchSubstitutions={pendingBatchSubs}
        onConfirm={handleConfirmAutoSub}
        onSkip={handleSkipAutoSub}
        onAcknowledgeHalftime={handleAcknowledgeHalftime}
        players={currentPlayers}
      />
      {finishedGameData && (
        <Suspense fallback={null}>
        <GameFinishedDialog
          open={gameFinishedOpen}
          onClose={handleGameFinishedClose}
          players={finishedGameData.players}
          totalGameTime={finishedGameData.totalGameTime}
          teamName={finishedGameData.teamName}
          linkedEventId={finishedGameData.linkedEventId}
          teamId={finishedGameData.teamId}
          formationUsed={finishedGameData.formationUsed}
          teamSize={finishedGameData.teamSize}
          executedSubs={finishedGameData.executedSubs}
          halfDuration={finishedGameData.halfDuration}
          goals={finishedGameData.goals}
          eventTitle={finishedGameData.eventTitle}
          eventDate={finishedGameData.eventDate}
          opponent={finishedGameData.opponent}
          manual={manualFinish}
          boardTeamId={finishedGameData.teamId}
        />
        </Suspense>
      )}
    </>
  );
}
