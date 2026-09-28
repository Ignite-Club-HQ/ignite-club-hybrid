import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { getSecondsSinceUpdateUncapped } from "./timerUtils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Play, Pause } from "lucide-react";
import { showBrowserNotification, requestNotificationPermission } from "@/lib/notifications";
import { toast } from "@/hooks/use-toast";
import { useWakeLock } from "@/hooks/useWakeLock";
import { sendTimerEvent, readServerTimer, deriveElapsedSeconds, shouldAcceptServerSnapshot, isServerAnchoredTimer, shouldPreferLocalOnFirstHydrate, type ServerTimer } from "@/lib/serverTimer";
import { getPitchStateKey, PITCH_STATE_KEY } from "./types";

/**
 * Read the current pitch board localStorage snapshot for this team so we can
 * piggy-back autoSubPlan / players onto the next timer event. This keeps
 * `active_games.pitch_state` fresh for the `check-pending-subs` cron even
 * when the board is unlinked (so `GlobalSubMonitor`'s own DB sync is skipped).
 */
const readLocalPitchPatch = (teamId: string | null | undefined): {
  autoSubPlan?: unknown[];
  autoSubActive?: boolean;
  players?: unknown[];
} => {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = teamId
      ? (localStorage.getItem(getPitchStateKey(teamId)) || localStorage.getItem(PITCH_STATE_KEY))
      : localStorage.getItem(PITCH_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as {
      teamId?: string;
      autoSubPlan?: unknown[];
      autoSubActive?: boolean;
      players?: unknown[];
    };
    if (teamId && parsed.teamId && parsed.teamId !== teamId) return {};
    const patch: ReturnType<typeof readLocalPitchPatch> = {};
    if (Array.isArray(parsed.autoSubPlan)) patch.autoSubPlan = parsed.autoSubPlan;
    if (typeof parsed.autoSubActive === "boolean") patch.autoSubActive = parsed.autoSubActive;
    if (Array.isArray(parsed.players)) patch.players = parsed.players;
    return patch;
  } catch {
    return {};
  }
};

// Helper to play audio beep
const playBeepSound = (frequency: number, beepCount: number, beepDuration: number, beepGap: number) => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    for (let i = 0; i < beepCount; i++) {
      const delay = i * beepGap;
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.5, audioContext.currentTime + delay);
      gainNode.gain.setValueAtTime(0.01, audioContext.currentTime + delay + beepDuration);
      
      oscillator.start(audioContext.currentTime + delay);
      oscillator.stop(audioContext.currentTime + delay + beepDuration);
    }
  } catch (error) {
    console.error('Failed to play beep sound:', error);
  }
};

export const playTimerBeep = (message?: string) => {
  // Send browser/push notification only (no in-app beep)
  if (message) {
    requestNotificationPermission().then(() => {
      showBrowserNotification("⚽ Game Alert", message);
    });
  }
};

// Sub alert - notification only (no in-app beep)
export const playSubAlertBeep = (message?: string) => {
  if (message) {
    requestNotificationPermission().then(() => {
      showBrowserNotification("🔄 Substitution Alert", message);
    });
  }
};

// Request notification permission when timer starts
export const requestTimerNotificationPermission = async () => {
  return requestNotificationPermission();
};

export interface GameTimerRef {
  getElapsedSeconds: () => number;
  getCurrentHalf: () => 1 | 2;
  getMinutesPerHalf: () => number;
  isRunning: () => boolean;
  isGameFinished: () => boolean;
  toggleTimer: () => boolean;
  resetTimer: () => void;
}

interface GameTimerProps {
  compact?: boolean;
  compactLarge?: boolean; // Larger compact mode when no score is showing
  large?: boolean; // Larger touch targets for landscape setup tab
  teamId?: string;
  teamName?: string;
  onTimeUpdate?: (elapsedSeconds: number, currentHalf: 1 | 2) => void;
  onHalfChange?: (newHalf: 1 | 2, source?: 'live' | 'reconcile') => void;
  readOnly?: boolean;
  hideExtras?: boolean;
  hidePlayPause?: boolean;
  // External minutes per half control
  minutesPerHalf?: number;
  onMinutesPerHalfChange?: (minutes: number) => void;
  /** ISO timestamp of the linked event's kickoff. When set:
   *  - Manual start before kickoff is blocked.
   *  - Timer auto-starts at kickoff. */
  kickoffTime?: string | null;
}

// Legacy key used by widgets to find any active timer
const ACTIVE_TIMER_KEY = 'pitch-board-timer-state';
// Team-specific keys for timer isolation
const TIMER_STORAGE_KEY_BASE = 'pitch-board-timer-state-team';

interface TimerState {
  minutesPerHalf: number;
  currentHalf: 1 | 2;
  elapsedSeconds: number;
  isRunning: boolean;
  
  lastUpdateTime: number; // timestamp to calculate elapsed time while away
  teamId?: string;
  teamName?: string;
  isGameFinished?: boolean; // Track if game has reached full time
  gameFinishedAt?: number; // Timestamp when game finished (for auto-reset)
  manualReset?: boolean; // Set when coach manually reset; suppresses auto fast-forward
}

const getTeamTimerStorageKey = (teamId: string) => {
  return `${TIMER_STORAGE_KEY_BASE}-${teamId}`;
};

const saveTimerState = (state: TimerState, teamId?: string) => {
  try {
    // Stamp schema_version: 2 on every write so useActiveGameSync's legacy
    // 10s sync correctly skips this row and does NOT clobber the
    // server-anchored timer_state written by pitch-timer-event.
    // GameTimer is fully server-anchored in Phase 2; every state we save
    // is part of that contract — the marker is purely a "do not touch"
    // signal for the legacy sync path.
    const stamped = { ...state, schema_version: 2 } as TimerState & { schema_version: 2 };
    // Always save to the active timer key for widgets to find
    localStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify(stamped));

    // Also save to team-specific key for isolation between games
    if (teamId) {
      const teamKey = getTeamTimerStorageKey(teamId);
      localStorage.setItem(teamKey, JSON.stringify(stamped));
    }
    // Dispatch custom event so GlobalSubMonitor can react in same-tab (Android WebView)
    window.dispatchEvent(new CustomEvent('game-state-changed', { detail: { source: 'timer' } }));
  } catch (e) {
    console.error('Failed to save timer state:', e);
  }
};


const loadTimerState = (teamId?: string): TimerState | null => {
  try {
    // If teamId provided, load from team-specific key for isolation
    if (teamId) {
      const teamKey = getTeamTimerStorageKey(teamId);
      const teamSaved = localStorage.getItem(teamKey);
      if (teamSaved) {
        const parsed = JSON.parse(teamSaved) as TimerState;
        console.info('[TimerAudit] loadTimerState (team key)', { teamId, key: teamKey, state: parsed });
        return parsed;
      }
      
      // Fallback: check legacy/active key and migrate if it matches this team
      const active = localStorage.getItem(ACTIVE_TIMER_KEY);
      if (active) {
        const activeState = JSON.parse(active) as TimerState;
        if (activeState.teamId === teamId) {
          // Save to team-specific key for future isolation
          localStorage.setItem(teamKey, active);
          console.info('[TimerAudit] loadTimerState (migrated active->team)', { teamId, state: activeState });
          return activeState;
        }
      }
      console.info('[TimerAudit] loadTimerState miss', { teamId });
      return null;
    }
    
    // No teamId - load from active key (used by widgets)
    const saved = localStorage.getItem(ACTIVE_TIMER_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load timer state:', e);
  }
  return null;
};

export const clearTimerState = (teamId?: string) => {
  try {
    // Clear team-specific key
    if (teamId) {
      const teamKey = getTeamTimerStorageKey(teamId);
      localStorage.removeItem(teamKey);
      
      // Also clear active key if it matches this team
      const active = localStorage.getItem(ACTIVE_TIMER_KEY);
      if (active) {
        try {
          const activeState = JSON.parse(active) as TimerState;
          if (activeState.teamId === teamId) {
            localStorage.removeItem(ACTIVE_TIMER_KEY);
          }
        } catch {}
      }
    } else {
      // No teamId - just clear active key
      localStorage.removeItem(ACTIVE_TIMER_KEY);
    }
  } catch (e) {
    console.error('Failed to clear timer state:', e);
  }
};

const GameTimer = forwardRef<GameTimerRef, GameTimerProps>(({ 
  compact = false,
  compactLarge = false,
  large = false,
  teamId,
  teamName,
  onTimeUpdate,
  onHalfChange,
  readOnly = false,
  hideExtras = false,
  hidePlayPause = false,
  minutesPerHalf: externalMinutesPerHalf,
  onMinutesPerHalfChange,
  kickoffTime,
}, ref) => {
  const internalKickoffMs = kickoffTime ? new Date(kickoffTime).getTime() : null;
  const kickoffMs = internalKickoffMs && !isNaN(internalKickoffMs) ? internalKickoffMs : null;
  const [internalMinutesPerHalf, setInternalMinutesPerHalf] = useState(45);
  const [currentHalf, setCurrentHalf] = useState<1 | 2>(1);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isGameFinished, setIsGameFinished] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);

  // Keep the screen awake while the timer is running so iOS/Android don't
  // sleep mid-half and suspend the JS runtime.
  useWakeLock(isRunning && !isGameFinished);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Stable ref for onHalfChange to avoid restarting the interval every time
  // the callback identity changes (e.g. when `players` updates minutesPlayed).
  const onHalfChangeRef = useRef(onHalfChange);
  onHalfChangeRef.current = onHalfChange;

  // Stable ref for onTimeUpdate to prevent the notification effect from
  // re-firing when the callback identity changes (e.g. gameInProgress flip).
  // Re-firing can cause duplicate delta calculations, doubling player minutes.
  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;

  // Use external minutesPerHalf if provided, otherwise use internal
  const minutesPerHalf = externalMinutesPerHalf !== undefined ? externalMinutesPerHalf : internalMinutesPerHalf;
  const setMinutesPerHalf = (mins: number) => {
    if (onMinutesPerHalfChange) {
      onMinutesPerHalfChange(mins);
    } else {
      setInternalMinutesPerHalf(mins);
    }
    // Propagate to server so spectators / cron see the new half length and
    // the next mount (anywhere) hydrates with the right value.
    sendTimerEvent({
      teamId: teamId ?? null,
      event: 'set_minutes',
      minutesPerHalf: mins,
      payload: { minutes_per_half: mins },
    }).catch((e) => console.warn('[TimerAudit] set_minutes send failed', e));
  };

  const halfDurationSeconds = minutesPerHalf * 60;

  // Cap elapsed time ONLY when paused. Capping while running/in-progress is
  // unsafe: a transient parent re-render that briefly drops
  // `externalMinutesPerHalf` to a smaller fallback (e.g. `|| 10` during a
  // React Query refetch) would otherwise instantly truncate a live clock
  // mid-half (the "stopped at 3:31, reverted to 10 min" bug).
  useEffect(() => {
    if (!hasInitialized) return;
    if (isRunning) return;
    if (elapsedSeconds > 0 || currentHalf === 2 || isGameFinished) return;
    if (elapsedSeconds > halfDurationSeconds) {
      console.info('[TimerAudit] cap-elapsed-to-half', {
        teamId, halfDurationSeconds, elapsedSeconds, minutesPerHalf,
      });
      setElapsedSeconds(halfDurationSeconds);
    }
  }, [halfDurationSeconds, hasInitialized, isRunning, elapsedSeconds, currentHalf, isGameFinished, teamId, minutesPerHalf]);

  // Trace every prop-driven minutesPerHalf change so we can correlate
  // mid-game reverts (e.g. "reverted to 10 min halves") with the upstream
  // refetch that caused them.
  const prevExternalMphRef = useRef<number | undefined>(externalMinutesPerHalf);
  useEffect(() => {
    if (prevExternalMphRef.current !== externalMinutesPerHalf) {
      console.info('[TimerAudit] externalMinutesPerHalf changed', {
        teamId,
        from: prevExternalMphRef.current,
        to: externalMinutesPerHalf,
        liveState: { isRunning, currentHalf, elapsedSeconds, isGameFinished },
        ts: new Date().toISOString(),
      });
      prevExternalMphRef.current = externalMinutesPerHalf;
    }
  }, [externalMinutesPerHalf, teamId, isRunning, currentHalf, elapsedSeconds, isGameFinished]);

  // Server-anchored hydration. On mount we ask the server for the
  // authoritative timer (immune to phone-lock drift, app-kill, etc). If
  // present, that wins over any localStorage projection. Falls back to
  // localStorage only when the server has no row (offline, brand-new game).
  const serverTimerRef = useRef<ServerTimer | null>(null);
  const clockSkewMsRef = useRef<number>(0); // server_now - Date.now()

  // Live refs of the displayed timer state so the snapshot guard can compare
  // an incoming server response against what the user is currently seeing
  // without stale closures.
  const liveStateRef = useRef({ isRunning: false, currentHalf: 1 as 1 | 2, elapsedSeconds: 0, isGameFinished: false });
  liveStateRef.current = { isRunning, currentHalf, elapsedSeconds, isGameFinished };

  const applyServerSnapshot = useCallback((t: ServerTimer, serverNowIso: string) => {
    const decision = shouldAcceptServerSnapshot(serverTimerRef.current, t, liveStateRef.current);
    if (!decision.accept) {
      console.info('[TimerAudit] server-snapshot-rejected', { teamId, reason: decision.reason, prev: serverTimerRef.current, incoming: t, local: liveStateRef.current });
      return;
    }
    serverTimerRef.current = t;
    clockSkewMsRef.current = new Date(serverNowIso).getTime() - Date.now();
    if (externalMinutesPerHalf === undefined) {
      setInternalMinutesPerHalf(t.minutes_per_half);
    }
    // `end_half` leaves the server row on half 1 with half_ended_at set (so
    // spectators can render "Half time"). Locally that state IS the start of
    // the second half — mapping it straight through would rewind the board to
    // half 1 at full time on the next resume.
    const isHalfTimeBreak =
      !!t.half_ended_at && !t.is_running && !t.is_game_finished && ((t.current_half as number) || 1) === 1;
    setCurrentHalf(isHalfTimeBreak ? 2 : ((t.current_half as 1 | 2) || 1));
    setIsGameFinished(!!t.is_game_finished);
    const elapsed = isHalfTimeBreak ? 0 : deriveElapsedSeconds(t, Date.now() + clockSkewMsRef.current);
    setElapsedSeconds(elapsed);
    setIsRunning(!!t.is_running);

    // Note: tick anchor is reset by the running-tick effect when isRunning flips true.
    console.info('[TimerAudit] server-hydrate', { teamId, reason: decision.reason, t, elapsed });
  }, [externalMinutesPerHalf, teamId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Local snapshot is loaded FIRST so a stale/zeroed server row can be
      // detected before it overwrites a locally-advanced clock.
      const local = loadTimerState(teamId);
      const localUsable = !!local && local.teamId === teamId;
      // Try server first.
      try {
        const res = await readServerTimer(teamId ?? null);
        if (cancelled) return;
        if (res.found && isServerAnchoredTimer(res.timer_state)) {
          const incoming = res.timer_state as ServerTimer;
          const serverNowMs = new Date(res.server_now).getTime();
          const localElapsed = localUsable
            ? Math.max(0, (local!.elapsedSeconds || 0)) +
              (local!.isRunning ? getSecondsSinceUpdateUncapped(local!.lastUpdateTime) : 0)
            : 0;
          const preferLocal = localUsable && !local!.isGameFinished && shouldPreferLocalOnFirstHydrate({
            incoming,
            serverNowMs: Number.isFinite(serverNowMs) ? serverNowMs : Date.now(),
            localElapsedSeconds: localElapsed,
            localCurrentHalf: local!.currentHalf,
            localIsRunning: local!.isRunning,
            localLastUpdateMs: local!.lastUpdateTime,
          });
          if (!preferLocal) {
            applyServerSnapshot(incoming, res.server_now);
            setHasInitialized(true);
            return;
          }
          console.info('[TimerAudit] server-row-would-regress-local, keeping local projection', {
            teamId, incoming, localElapsed,
          });
        }
      } catch (e) {
        console.warn('[TimerAudit] server-hydrate failed, fallback to localStorage', e);
      }
      if (cancelled) return;


      // Fallback: legacy localStorage hydration (unchanged from before so
      // mid-flight games on the old path keep working).
      const saved = loadTimerState(teamId);
      console.info('[TimerAudit] mount/teamId-load (fallback)', { teamId, externalMinutesPerHalf, savedExists: !!saved, saved });
      if (saved && saved.teamId === teamId) {
        if (externalMinutesPerHalf === undefined) setInternalMinutesPerHalf(saved.minutesPerHalf);
        setIsGameFinished(saved.isGameFinished || false);
        const halfDuration = (externalMinutesPerHalf ?? saved.minutesPerHalf) * 60;
        if (saved.isGameFinished) {
          setCurrentHalf(saved.currentHalf);
          setElapsedSeconds(saved.elapsedSeconds);
          setIsRunning(false);
        } else if (saved.isRunning && saved.lastUpdateTime) {
          const secondsPassed = getSecondsSinceUpdateUncapped(saved.lastUpdateTime);
          let half: 1 | 2 = saved.currentHalf;
          let elapsed = (saved.elapsedSeconds || 0) + secondsPassed;
          let running = true;
          let finished = false;
          if (half === 1 && elapsed >= halfDuration) {
            half = 2; elapsed = elapsed - halfDuration; running = false;
            onHalfChangeRef.current?.(2, 'reconcile');
          }
          if (half === 2 && elapsed >= halfDuration) {
            elapsed = halfDuration; running = false; finished = true;
          }
          setCurrentHalf(half);
          setElapsedSeconds(elapsed);
          setIsRunning(running);
          if (finished) setIsGameFinished(true);
        } else {
          setCurrentHalf(saved.currentHalf);
          setElapsedSeconds(saved.elapsedSeconds);
          setIsRunning(saved.isRunning);
        }
      }
      setHasInitialized(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  // Save state to localStorage whenever it changes (only after initialization)
  const lastSavedSnapshotRef = useRef<string>('');
  useEffect(() => {
    if (!hasInitialized) return;

    saveTimerState({
      minutesPerHalf,
      currentHalf,
      elapsedSeconds,
      isRunning,
      lastUpdateTime: Date.now(),
      teamId,
      teamName,
      isGameFinished,
    }, teamId);

    // Log only on meaningful transitions (not every 1s tick) so we can see
    // exactly when isRunning/half/mph/finished flipped.
    const snap = `${minutesPerHalf}|${currentHalf}|${isRunning}|${isGameFinished}`;
    if (snap !== lastSavedSnapshotRef.current) {
      console.info('[TimerAudit] state-transition', {
        teamId,
        from: lastSavedSnapshotRef.current,
        to: snap,
        elapsedSeconds,
        ts: new Date().toISOString(),
      });
      lastSavedSnapshotRef.current = snap;
    }
  }, [minutesPerHalf, currentHalf, elapsedSeconds, isRunning, hasInitialized, teamId, teamName, isGameFinished]);

  const toggleTimer = useCallback(() => {
    // Cannot resume if game is finished
    if (isGameFinished) return false;

    // If linked to an event, block manual start only after the post-kickoff window closes.
    if (!isRunning && kickoffMs && elapsedSeconds === 0 && currentHalf === 1) {
      const now = Date.now();
      const latest = kickoffMs + 2 * 60 * 60 * 1000;
      if (now > latest) {
        toast({
          title: "Kick-off window closed",
          description: "This event ended more than 2 hours ago.",
        });
        return false;
      }
    }

    let nextIsRunning = false;
    setIsRunning(prev => {
      nextIsRunning = !prev;
      return nextIsRunning;
    });

    // Mirror to server so resume / cross-device / lock-phone never lose time.
    // Determine the event type from current state at moment of press.
    const evt = !isRunning
      ? (elapsedSeconds === 0 && currentHalf === 1 ? 'start_half'
        : elapsedSeconds === 0 && currentHalf === 2 ? 'start_half_2'
        : 'resume')
      : 'pause';
    sendTimerEvent({
      teamId: teamId ?? null,
      event: evt,
      minutesPerHalf,
      ...readLocalPitchPatch(teamId ?? null),
    }).then((res) => {
      // Shape-validate before hydrating: a clobbered "fake v2" row derives
      // elapsed = 0 and would visibly zero the clock mid-match.
      if (!isServerAnchoredTimer(res.timer_state)) {
        console.warn('[TimerAudit] ignoring malformed timer_state from', evt);
        return;
      }
      applyServerSnapshot(res.timer_state, res.server_now);
    }).catch((e) => console.warn('[TimerAudit] sendTimerEvent failed', evt, e));


    return nextIsRunning;
  }, [isGameFinished, isRunning, kickoffMs, elapsedSeconds, currentHalf, teamId, minutesPerHalf, applyServerSnapshot]);

  const resetTimer = useCallback(() => {
    setIsRunning(false);
    setCurrentHalf(1);
    setElapsedSeconds(0);
    setIsGameFinished(false);
    clearTimerState(teamId);
    // Mark a manual reset so the kickoff-derived auto-resume logic doesn't
    // immediately fast-forward the clock back to "now - kickoff".
    if (kickoffMs && Date.now() >= kickoffMs) {
      try {
        saveTimerState({
          minutesPerHalf,
          currentHalf: 1,
          elapsedSeconds: 0,
          isRunning: false,
          lastUpdateTime: Date.now(),
          teamId,
          teamName,
          isGameFinished: false,
          manualReset: true,
        }, teamId);
      } catch {}
    }
    // Server reset so spectators / cron / next mount all snap to zero.
    sendTimerEvent({ teamId: teamId ?? null, event: 'reset', minutesPerHalf })
      .catch((e) => console.warn('[TimerAudit] reset send failed', e));
  }, [teamId, kickoffMs, minutesPerHalf, teamName]);

  // Expose state via ref
  useImperativeHandle(ref, () => ({
    getElapsedSeconds: () => elapsedSeconds,
    getCurrentHalf: () => currentHalf,
    getMinutesPerHalf: () => minutesPerHalf,
    isRunning: () => isRunning,
    isGameFinished: () => isGameFinished,
    toggleTimer,
    resetTimer,
  }), [elapsedSeconds, currentHalf, minutesPerHalf, isRunning, isGameFinished, toggleTimer, resetTimer]);

  // Auto-start on kickoff has been removed — coach must press Play to start the timer.


  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }, []);

  const getDisplayTime = useCallback((cumulative = false) => {
    if (currentHalf === 1 || !cumulative) {
      return formatTime(elapsedSeconds);
    } else {
      return formatTime(halfDurationSeconds + elapsedSeconds);
    }
  }, [currentHalf, elapsedSeconds, halfDurationSeconds, formatTime]);

  // Request notification permission when timer starts
  useEffect(() => {
    if (isRunning) {
      requestTimerNotificationPermission();
    }
  }, [isRunning]);

  // Wall-clock anchor for the running tick. Set when the timer transitions
  // to running and re-anchored on every tick. Using Date.now() deltas (rather
  // than `prev + 1`) ensures the clock catches up when iOS/Android WebViews
  // throttle or skip setInterval callbacks while backgrounded or in low-power
  // mode — which is what caused U12 boys at Riverside to show 7:00 when 11:00
  // of real time had elapsed.
  const tickAnchorRef = useRef<number | null>(null);

  useEffect(() => {
    if (isRunning) {
      tickAnchorRef.current = Date.now();
      intervalRef.current = setInterval(() => {
        const now = Date.now();
        const anchor = tickAnchorRef.current ?? now;
        const deltaSec = Math.floor((now - anchor) / 1000);
        // If the interval fired early (sub-second since last credit), skip
        // this tick rather than over-crediting a full second. The anchor is
        // left untouched so the next fire picks up the full elapsed delta.
        if (deltaSec < 1) return;
        // Advance anchor by exactly the seconds we credited, preserving the
        // sub-second remainder so we don't drift over a full half.
        tickAnchorRef.current = anchor + deltaSec * 1000;
        setElapsedSeconds(prev => {
          const newValue = prev + deltaSec;
          // Check if half is complete
          if (newValue >= halfDurationSeconds) {
            if (currentHalf === 1) {
              // End of first half - pause and switch to second half
              setIsRunning(false);
              setCurrentHalf(2);
              onHalfChangeRef.current?.(2, 'live');
              playTimerBeep("Half Time! First half complete.");
              sendTimerEvent({ teamId: teamId ?? null, event: 'end_half', minutesPerHalf })
                .catch((e) => console.warn('[TimerAudit] end_half send failed', e));
              return 0;
            } else {
              // End of match - mark game as finished
              setIsRunning(false);
              setIsGameFinished(true);
              // Save gameFinishedAt timestamp for auto-reset
              const finishedState: TimerState = {
                minutesPerHalf,
                currentHalf: 2,
                elapsedSeconds: halfDurationSeconds,
                isRunning: false,
                lastUpdateTime: Date.now(),
                teamId,
                teamName,
                isGameFinished: true,
                gameFinishedAt: Date.now(),
              };
              saveTimerState(finishedState, teamId);
              playTimerBeep("Full Time! Match complete.");
              sendTimerEvent({ teamId: teamId ?? null, event: 'end_game', minutesPerHalf })
                .catch((e) => console.warn('[TimerAudit] end_game send failed', e));
              return halfDurationSeconds;
            }
          }
          return newValue;
        });
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning, halfDurationSeconds, currentHalf]);

  // Reconcile timer when app resumes from background (no 30s cap)
  // CRITICAL: register listeners ONCE per teamId. Previously the dep array
  // included elapsedSeconds/currentHalf/isRunning, causing this effect to
  // tear down + re-register every tick. On Android Capacitor the async
  // `import('@capacitor/app')` couldn't keep up, leaking listeners and
  // racing with cleanup (so reconcile sometimes never ran on resume).
  const reconcileRefs = useRef({
    isRunning,
    isGameFinished,
    currentHalf,
    elapsedSeconds,
    minutesPerHalf,
    halfDurationSeconds,
    teamId,
    teamName,
  });
  reconcileRefs.current = {
    isRunning,
    isGameFinished,
    currentHalf,
    elapsedSeconds,
    minutesPerHalf,
    halfDurationSeconds,
    teamId,
    teamName,
  };

  useEffect(() => {
    const reconcileAfterResume = async () => {
      const r = reconcileRefs.current;
      if (r.isGameFinished) return;

      // Capture the team-id we're reading for. If it changes mid-flight
      // (user navigated to another team), discard the response so we don't
      // hydrate team A's timer into team B's component.
      const readForTeamId = r.teamId ?? null;

      // Server-first: pull authoritative timer and snap to it. Drift is
      // impossible because the server derives elapsed from event timestamps.
      try {
        const res = await readServerTimer(readForTeamId);
        if ((reconcileRefs.current.teamId ?? null) !== readForTeamId) {
          console.info('[TimerAudit] reconcile: team-id changed mid-read, dropping', { readForTeamId, current: reconcileRefs.current.teamId });
          return;
        }
        if (res.found && isServerAnchoredTimer(res.timer_state)) {
          const prevHalf = r.currentHalf;
          const prevFinished = r.isGameFinished;
          const prevSnapshot = serverTimerRef.current;
          applyServerSnapshot(res.timer_state as ServerTimer, res.server_now);
          // Only fire chimes if the snapshot was actually accepted (i.e.
          // serverTimerRef advanced). Prevents a rejected stale snapshot
          // from triggering a spurious half/full-time beep.
          if (serverTimerRef.current !== prevSnapshot) {
            if (!prevFinished && res.timer_state.is_game_finished) {
              playTimerBeep("Full Time! Match complete.");
            } else if (prevHalf === 1 && res.timer_state.current_half === 2) {
              onHalfChangeRef.current?.(2, 'reconcile');
              playTimerBeep("Half Time! First half complete.");
            }
          }
          return;
        }
      } catch (e) {
        console.warn('[TimerAudit] reconcile: server read failed, falling back', e);
      }

      // Fallback: legacy localStorage drift projection (for games still on
      // the old path or fully offline). Same logic as before.
      const saved = loadTimerState(r.teamId);
      if (!saved || !saved.isRunning || !saved.lastUpdateTime) return;

      const uncappedDrift = getSecondsSinceUpdateUncapped(saved.lastUpdateTime);
      if (uncappedDrift < 2) return;

      const halfDur = (r.minutesPerHalf || saved.minutesPerHalf) * 60;
      let half: 1 | 2 = saved.currentHalf;
      let elapsed = (saved.elapsedSeconds || 0) + uncappedDrift;
      let running = true;
      let finished = false;
      let crossedHalf = false;
      if (half === 1 && elapsed >= halfDur) {
        half = 2; elapsed = elapsed - halfDur; running = false; crossedHalf = true;
      }
      if (half === 2 && elapsed >= halfDur) {
        elapsed = halfDur; running = false; finished = true;
      }

      tickAnchorRef.current = Date.now();
      setCurrentHalf(half);
      setElapsedSeconds(elapsed);
      setIsRunning(running);
      if (finished) {
        setIsGameFinished(true);
        playTimerBeep("Full Time! Match complete.");
      } else if (crossedHalf) {
        onHalfChangeRef.current?.(2, 'reconcile');
        playTimerBeep("Half Time! First half complete.");
      }
    };

    // flushOnHide is no longer needed — server holds the truth via event
    // timestamps, so there's nothing to "flush" on hide. Keeping a no-op
    // for the event handlers below.
    const flushOnHide = () => {};

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') reconcileAfterResume();
      else flushOnHide();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pageshow', reconcileAfterResume);
    window.addEventListener('focus', reconcileAfterResume);
    window.addEventListener('pagehide', flushOnHide);
    window.addEventListener('beforeunload', flushOnHide);
    document.addEventListener('freeze', flushOnHide as any);
    document.addEventListener('resume', reconcileAfterResume as any);

    // Capacitor app state — track listener + cancellation so cleanup can't race
    let appListener: any = null;
    let cancelled = false;
    (async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app');
        const listener = await CapApp.addListener('appStateChange', ({ isActive }: { isActive: boolean }) => {
          if (isActive) reconcileAfterResume();
          else flushOnHide();
        });
        if (cancelled) {
          listener.remove();
        } else {
          appListener = listener;
        }
      } catch {}
    })();

    // Run reconciliation immediately on mount — handles the case where
    // the app resumed (visibilitychange/appStateChange already fired)
    // BEFORE this effect registered its listeners.
    reconcileAfterResume();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pageshow', reconcileAfterResume);
      window.removeEventListener('focus', reconcileAfterResume);
      window.removeEventListener('pagehide', flushOnHide);
      window.removeEventListener('beforeunload', flushOnHide);
      document.removeEventListener('freeze', flushOnHide as any);
      document.removeEventListener('resume', reconcileAfterResume as any);
      appListener?.remove?.();
    };
  }, [teamId]);

  // Notify parent of time updates — use stable ref to avoid re-firing
  // when the callback identity changes (which was doubling player minutes).
  useEffect(() => {
    onTimeUpdateRef.current?.(elapsedSeconds, currentHalf);
  }, [elapsedSeconds, currentHalf]);

  // toggleTimer moved above useImperativeHandle

  const handleHalfDurationChange = (value: string) => {
    const mins = parseInt(value);
    setMinutesPerHalf(mins);
    // Reset timer when duration changes
    resetTimer();
  };


  if (compact) {
    const isLarge = compactLarge;
    return (
      <div className={cn("flex items-center", isLarge ? "gap-2" : "gap-1")}>
        {!hideExtras && (
          <Select value={minutesPerHalf.toString()} onValueChange={handleHalfDurationChange} disabled={readOnly || isGameFinished || isRunning || elapsedSeconds > 0}>
            <SelectTrigger className={cn(isLarge ? "w-16 h-9 text-sm px-2" : "w-14 h-7 text-xs px-1.5")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[99999] bg-popover">
              <SelectItem value="5">5m</SelectItem>
              <SelectItem value="10">10m</SelectItem>
              <SelectItem value="15">15m</SelectItem>
              <SelectItem value="20">20m</SelectItem>
              <SelectItem value="25">25m</SelectItem>
              <SelectItem value="30">30m</SelectItem>
              <SelectItem value="35">35m</SelectItem>
              <SelectItem value="40">40m</SelectItem>
              <SelectItem value="45">45m</SelectItem>
            </SelectContent>
          </Select>
        )}
        <div className={cn(
          "flex items-center rounded",
          isLarge ? "px-2.5 py-1" : "px-1.5 py-0.5",
          isLarge ? "text-sm" : "text-xs",
          isGameFinished ? "bg-primary/20" : "bg-muted"
        )}>
          <span className={cn("font-medium text-muted-foreground", isLarge && "text-sm")}>
            {isGameFinished ? "FT" : `H${currentHalf}`}
          </span>
          <span className={cn("font-mono font-bold ml-1", isLarge ? "text-lg" : "")}>
            {getDisplayTime(false)}
          </span>
        </div>
        {!readOnly && !hidePlayPause && (
          <Button
            variant="outline"
            size="icon"
            className={cn(isLarge ? "h-10 w-10" : "h-8 w-8")}
            onClick={toggleTimer}
            disabled={isGameFinished}
          >
            {isRunning ? <Pause className={cn(isLarge ? "h-4 w-4" : "h-3 w-3")} /> : <Play className={cn(isLarge ? "h-4 w-4" : "h-3 w-3")} />}
          </Button>
        )}

      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {!hideExtras && (
        <div className="space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Minutes per Half</span>
          <div className="flex rounded-lg overflow-hidden border border-border">
            {[5, 10, 15, 20, 25, 30, 35, 40, 45].map((v) => {
              const isDisabled = readOnly || isGameFinished || isRunning || elapsedSeconds > 0;
              return (
                <button
                  key={v}
                  onClick={() => !isDisabled && handleHalfDurationChange(v.toString())}
                  disabled={isDisabled}
                  className={cn(
                    "flex-1 py-2.5 text-sm font-medium transition-colors",
                    minutesPerHalf === v
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-foreground hover:bg-muted",
                    isDisabled && minutesPerHalf !== v && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {v}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
      
      <div className={cn(
        "flex items-center gap-1.5 rounded-md",
        large ? "px-4 py-2.5" : "px-2 py-1",
        isGameFinished ? "bg-primary/20" : "bg-muted/60"
      )}>
        <span className={cn("font-medium text-muted-foreground", large ? "text-base" : "text-xs")}>
          {isGameFinished ? "FT" : (currentHalf === 1 ? "1H" : "2H")}
        </span>
        <span className={cn("font-mono font-bold tabular-nums", large ? "text-2xl" : "text-xl")}>{getDisplayTime(false)}</span>
      </div>
      
      {!readOnly && !hidePlayPause && (
        <Button
          variant="outline"
          size={large ? "default" : "icon"}
          className={large ? "h-12 w-12" : undefined}
          onClick={toggleTimer}
          disabled={isGameFinished}
        >
          {isRunning ? <Pause className={large ? "h-5 w-5" : "h-4 w-4"} /> : <Play className={large ? "h-5 w-5" : "h-4 w-4"} />}
        </Button>
      )}
      
      </div>
    </div>
  );
});

GameTimer.displayName = "GameTimer";

export default GameTimer;
