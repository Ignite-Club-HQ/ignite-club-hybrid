import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { getCurrentGameSeconds, getSecondsSinceUpdateUncapped } from "./timerUtils";
import { cn } from "@/lib/utils";
import {
  readServerTimer,
  sendTimerEvent,
  deriveElapsedSeconds,
  isServerAnchoredTimer,
  shouldPreferLocalOnFirstHydrate,
  shouldAcceptServerSnapshot,
  type ServerTimer,
} from "@/lib/serverTimer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Play, Pause, Timer, LayoutGrid, X, ArrowRightLeft, Clock, UserRoundCheck, ChevronDown, ChevronUp, SkipForward, Eye, Check, Ban } from "lucide-react";
import { Goal, getSpecificPositionLabel } from "./types";
import { PitchPosition, POSITION_COLORS } from "./PositionBadge";
import { toast } from "@/hooks/use-toast";
import { useWakeLock } from "@/hooks/useWakeLock";
import {
  recalculateRemainingPlanTeamAware as recalculateRemainingPlan,
  validateAndFixRemainingPlan,
} from "./pitchStateUtils";


// Storage keys
const ACTIVE_TIMER_KEY = 'pitch-board-timer-state';
const TIMER_STORAGE_KEY_BASE = 'pitch-board-timer-state-team';
const PITCH_STATE_KEY = "ignite-pitch-board-state";
const PITCH_STATE_KEY_BASE = "ignite-pitch-board-state-team";
const WIDGET_DISMISSED_KEY = "pitch-widget-dismissed";
const getPitchStateKeyForTeam = (teamId: string) => `${PITCH_STATE_KEY_BASE}-${teamId}`;

interface TimerState {
  minutesPerHalf: number;
  currentHalf: 1 | 2;
  elapsedSeconds: number;
  isRunning: boolean;
  soundEnabled: boolean;
  lastUpdateTime: number;
  teamId?: string;
  teamName?: string;
  isGameFinished?: boolean;
  gameFinishedAt?: number;
}

const POST_GAME_VISIBILITY_MS = 60 * 60 * 1000; // 60 minutes

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
  minutesPlayed?: number;
  isInjured?: boolean;
}

interface SubstitutionEvent {
  time: number;
  half: 1 | 2;
  playerOut: Player;
  playerIn: Player;
  positionSwap?: {
    player: Player;
    fromPosition: PitchPosition;
    toPosition: PitchPosition;
  };
  executed?: boolean;
  skipped?: boolean;
}

interface PitchBoardState {
  teamId: string;
  players: Player[];
  teamSize: string;
  autoSubPlan: SubstitutionEvent[];
  autoSubActive: boolean;
  autoSubPaused: boolean;
  goals?: Goal[];
}

interface SubInfo {
  sub: SubstitutionEvent;
  isDue: boolean;
  secondsUntil: number;
}

const getTeamTimerStorageKey = (teamId: string) => `${TIMER_STORAGE_KEY_BASE}-${teamId}`;

const loadActiveTimerState = (): TimerState | null => {
  try {
    const activeRaw = localStorage.getItem(ACTIVE_TIMER_KEY);
    if (!activeRaw) return null;
    const activeState = JSON.parse(activeRaw) as TimerState;

    // If widget was dismissed for this team, don't show it
    const dismissed = localStorage.getItem(WIDGET_DISMISSED_KEY);
    if (dismissed && (dismissed === 'true' || dismissed === activeState.teamId)) {
      return null;
    }

    if (activeState.teamId) {
      const teamKey = getTeamTimerStorageKey(activeState.teamId);
      const teamRaw = localStorage.getItem(teamKey);
      if (teamRaw) return JSON.parse(teamRaw) as TimerState;
    }
    return activeState;
  } catch { return null; }
};

const saveTimerState = (state: TimerState) => {
  try {
    // CRITICAL: stamp `schema_version: 2` on EVERY write, exactly like
    // GameTimer.saveTimerState does. The marker is the "do not touch" signal
    // that makes `useActiveGameSync` and `GlobalSubMonitor` skip writing
    // `active_games.timer_state`. `serverToTimerState()` builds a fresh object
    // literal without the marker, so saving it unstamped silently downgraded
    // localStorage to "legacy v1" — the two legacy syncs then overwrote the
    // authoritative server-anchored row with `{ elapsedSeconds, lastUpdateTime }`,
    // which derives elapsed = 0 and reset the board to 00:00 on the next
    // resume / button press. Never remove this stamp.
    const stamped = { ...state, schema_version: 2 as const };
    const json = JSON.stringify(stamped);
    localStorage.setItem(ACTIVE_TIMER_KEY, json);
    if (state.teamId) {
      localStorage.setItem(getTeamTimerStorageKey(state.teamId), json);
    }
    // Clear dismissed flag when timer state is actively saved (new game or state change)
    localStorage.removeItem(WIDGET_DISMISSED_KEY);
    // Dispatch custom event for same-tab sync (Android WebView)
    window.dispatchEvent(new CustomEvent('game-state-changed', { detail: { source: 'timer-widget' } }));
  } catch { /* ignore */ }
};


/**
 * Map a server-anchored ServerTimer row into the widget's legacy TimerState
 * shape so the rest of this component (display, subs, halftime detection)
 * keeps working unchanged. Elapsed is derived from event timestamps + the
 * server_now echo so device clock drift / phone-lock cannot lose seconds.
 */
const serverToTimerState = (
  t: ServerTimer,
  serverNowIso: string,
  fallback: { teamId?: string; teamName?: string; gameFinishedAt?: number },
): TimerState => {
  const clockSkewMs = new Date(serverNowIso).getTime() - Date.now();
  const elapsed = deriveElapsedSeconds(t, Date.now() + clockSkewMs);
  return {
    minutesPerHalf: t.minutes_per_half,
    currentHalf: (t.current_half as 1 | 2) || 1,
    elapsedSeconds: elapsed,
    isRunning: !!t.is_running,
    soundEnabled: true,
    // Stamp lastUpdateTime to "now" so the local 1Hz visual tick continues
    // smoothly from the server-derived value until the next hydrate.
    lastUpdateTime: Date.now(),
    teamId: fallback.teamId,
    teamName: fallback.teamName,
    isGameFinished: !!t.is_game_finished,
    gameFinishedAt: t.is_game_finished
      ? fallback.gameFinishedAt ?? Date.now()
      : fallback.gameFinishedAt,
  };
};


// Read pitch state: prefer team-specific key, fall back to active key ONLY if teamId matches
const readPitchState = (teamId?: string): PitchBoardState | null => {
  try {
    if (teamId) {
      const teamSaved = localStorage.getItem(getPitchStateKeyForTeam(teamId));
      if (teamSaved) return JSON.parse(teamSaved);

      // Fallback to active key — but ONLY if it belongs to the same team
      const activeSaved = localStorage.getItem(PITCH_STATE_KEY);
      if (!activeSaved) return null;
      const activeState = JSON.parse(activeSaved) as PitchBoardState;
      return activeState.teamId === teamId ? activeState : null;
    }
    const saved = localStorage.getItem(PITCH_STATE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch { return null; }
};

// Write pitch state: write to both team-specific and active keys
const writePitchState = (state: PitchBoardState) => {
  try {
    const json = JSON.stringify(state);
    if (state.teamId) localStorage.setItem(getPitchStateKeyForTeam(state.teamId), json);
    localStorage.setItem(PITCH_STATE_KEY, json);
    // Dispatch custom event for same-tab sync (Android WebView)
    window.dispatchEvent(new CustomEvent('game-state-changed', { detail: { source: 'pitch-widget' } }));
  } catch { /* ignore */ }
};

const getCurrentElapsed = (timer: TimerState): number => {
  if (!timer.isRunning || !timer.lastUpdateTime) return Math.min(timer.elapsedSeconds || 0, timer.minutesPerHalf * 60);
  const uncapped = (timer.elapsedSeconds || 0) + getSecondsSinceUpdateUncapped(timer.lastUpdateTime);
  return Math.min(uncapped, timer.minutesPerHalf * 60);
};

const getTotalSeconds = (elapsed: number, half: 1 | 2, minutesPerHalf: number): number => {
  return half === 1 ? elapsed : (minutesPerHalf * 60) + elapsed;
};

interface GameTimerWidgetProps {
  onOpenPitchBoard?: (teamId: string, teamName: string) => void;
  readOnly?: boolean;
}

export default function GameTimerWidget({ onOpenPitchBoard, readOnly = false }: GameTimerWidgetProps) {
  const [timerState, setTimerState] = useState<TimerState | null>(null);
  // Last server snapshot this widget accepted, so repeated resumes are compared
  // against it instead of each being treated as a fresh first hydrate.
  const serverTimerRef = useRef<ServerTimer | null>(null);
  const [displaySeconds, setDisplaySeconds] = useState(0);
  const [homeGoals, setHomeGoals] = useState(0);
  // Guard: skip polling reads for a short window after a user action
  // to prevent the stale-closure poll from reverting the toggle
  const userActionAtRef = useRef(0);
  const [awayGoals, setAwayGoals] = useState(0);
  const [allSubs, setAllSubs] = useState<SubInfo[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [subsExpanded, setSubsExpanded] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [selectedSubIndex, setSelectedSubIndex] = useState<number>(0);
  const [editedPlayerOutId, setEditedPlayerOutId] = useState<string | null>(null);
  const [editedPlayerInId, setEditedPlayerInId] = useState<string | null>(null);

  // Keep the screen awake while a game is actively running.
  useWakeLock(!!timerState?.isRunning && !gameFinished);

  const playersOnPitch = useMemo(() => allPlayers.filter(p => p.position !== null), [allPlayers]);
  const availableBenchPlayers = useMemo(() => allPlayers.filter(p => p.position === null && !p.isInjured), [allPlayers]);

  const selectedSub = allSubs[selectedSubIndex] || null;
  
  // All due subs at the same time slot are actionable together
  const firstDueTimeKey = allSubs.find(s => s.isDue) 
    ? `${allSubs.find(s => s.isDue)!.sub.half}-${allSubs.find(s => s.isDue)!.sub.time}` 
    : null;
  
  const isSubActionable = (subInfo: SubInfo, idx: number) => {
    if (subInfo.isDue) {
      // Actionable if it belongs to the same time slot as the first due sub
      return `${subInfo.sub.half}-${subInfo.sub.time}` === firstDueTimeKey;
    }
    // Future subs: actionable if no due subs exist and it's the first
    return !firstDueTimeKey && idx === 0;
  };
  
  const isSelectedSubActionable = selectedSub && !selectedSub.sub.skipped && !selectedSub.sub.executed && !gameFinished
    ? isSubActionable(selectedSub, selectedSubIndex) : false;

  const actualPlayerOut = useMemo(() => {
    if (!selectedSub) return null;
    if (editedPlayerOutId) return allPlayers.find(p => p.id === editedPlayerOutId) || selectedSub.sub.playerOut;
    return selectedSub.sub.playerOut;
  }, [editedPlayerOutId, allPlayers, selectedSub]);

  const actualPlayerIn = useMemo(() => {
    if (!selectedSub) return null;
    if (editedPlayerInId) return allPlayers.find(p => p.id === editedPlayerInId) || selectedSub.sub.playerIn;
    return selectedSub.sub.playerIn;
  }, [editedPlayerInId, allPlayers, selectedSub]);

  // Poll state
  useEffect(() => {
    const checkState = () => {
      // Skip polling for 1.5s after a user action to avoid reverting the toggle
      if (Date.now() - userActionAtRef.current < 1500) return;

      const saved = loadActiveTimerState();
      if (!saved) { setTimerState(null); return; }

      const currentElapsed = getCurrentElapsed(saved);
      setTimerState(saved);
      setDisplaySeconds(currentElapsed);

      try {
        let pitchState = readPitchState(saved.teamId);
        if (!pitchState) {
          setHomeGoals(0); setAwayGoals(0); setAllSubs([]); setAllPlayers([]);
          return;
        }
        
        // Score
        const goals = pitchState.goals || [];
        setHomeGoals(goals.filter(g => !g.isOpponentGoal).length);
        setAwayGoals(goals.filter(g => g.isOpponentGoal).length);
        
        // Players
        setAllPlayers(pitchState.players || []);

        // Subs - don't show if game is finished
        const mph = saved.minutesPerHalf || 20;
        const halfDur = mph * 60;
        const isGameFinished = saved.isGameFinished === true ||
          (saved.currentHalf === 2 && currentElapsed >= halfDur);
        const isHalftimeBreak = !saved.isRunning && saved.currentHalf === 2 && currentElapsed === 0;

        // Stamp gameFinishedAt the first time we observe full time so the
        // widget can stay visible for 60 minutes after the match ends.
        if (isGameFinished && !saved.gameFinishedAt) {
          const stamped: TimerState = {
            ...saved,
            isGameFinished: true,
            gameFinishedAt: Date.now(),
            isRunning: false,
          };
          saveTimerState(stamped);
        }

        // At halftime, auto-skip stale first-half subs that were never executed
        if (isHalftimeBreak) {
          const staleFirstHalfSubs = (pitchState.autoSubPlan || []).filter(
            s => !s.executed && s.half === 1
          );
          if (staleFirstHalfSubs.length > 0) {
            const updatedPlan = pitchState.autoSubPlan.map(s =>
              !s.executed && s.half === 1
                ? { ...s, executed: true, skipped: true }
                : s
            );
            const updatedState = { ...pitchState, autoSubPlan: updatedPlan, lastUpdateTime: Date.now() };
            writePitchState(updatedState);
            pitchState = updatedState;
          }
        }

        setGameFinished(isGameFinished);

        const allPlanSubs = pitchState.autoSubPlan || [];
        const unexecuted = allPlanSubs.filter(s => !s.executed);
        
        if (pitchState.autoSubActive && (unexecuted.length > 0 || isGameFinished)) {
          const currentTotal = getTotalSeconds(currentElapsed, saved.currentHalf, mph);
          
          // When game is finished, show all subs (executed, skipped, and unexecuted) for reference
          const subsToShow = isGameFinished ? allPlanSubs : unexecuted;
          
          const sorted = [...subsToShow].sort((a, b) => {
            if (a.half !== b.half) return a.half - b.half;
            return a.time - b.time;
          });
          
          // Find the first (earliest) due time slot
          let firstDueTimeSlot: string | null = null;
          const subInfos: SubInfo[] = sorted.map(sub => {
            // Skipped/executed subs are never "due"
            if (sub.executed || sub.skipped || isGameFinished) {
              return { sub, isDue: false, secondsUntil: 0 };
            }
            const subTotal = getTotalSeconds(sub.time, sub.half, mph);
            const isDue = subTotal <= currentTotal;
            if (isDue && !firstDueTimeSlot) {
              firstDueTimeSlot = `${sub.half}-${sub.time}`;
            }
            return { sub, isDue, secondsUntil: Math.max(0, subTotal - currentTotal) };
          });

          // Only mark the FIRST due time-slot batch as "due now";
          // later overdue batches show as upcoming so they don't pile up
          if (firstDueTimeSlot) {
            for (const info of subInfos) {
              if (info.isDue && `${info.sub.half}-${info.sub.time}` !== firstDueTimeSlot) {
                info.isDue = false;
              }
            }
          }
          
          subInfos.sort((a, b) => {
            if (a.isDue && !b.isDue) return -1;
            if (!a.isDue && b.isDue) return 1;
            return a.secondsUntil - b.secondsUntil;
          });
          
          setAllSubs(subInfos);
        } else {
          setAllSubs([]);
        }
      } catch { setAllSubs([]); }
    };

    checkState();
    const interval = setInterval(checkState, 1000);
    return () => clearInterval(interval);
  }, []);

  // Reconcile timer after app resumes from background (uncapped drift)
  useEffect(() => {
    const reconcileAfterResume = async () => {
      const saved = loadActiveTimerState();
      if (!saved) return;

      // Server-first: ask the authoritative timer row for current elapsed.
      // Immune to phone-lock, app-kill, or stale localStorage projections.
      try {
        const res = await readServerTimer(saved.teamId ?? null);
        if (res.found && isServerAnchoredTimer(res.timer_state)) {
          const incoming = res.timer_state as ServerTimer;
          const serverNowMs = new Date(res.server_now).getTime();
          const preferLocal = shouldPreferLocalOnFirstHydrate({
            incoming,
            serverNowMs: Number.isFinite(serverNowMs) ? serverNowMs : Date.now(),
            localElapsedSeconds: getCurrentGameSeconds(saved),
            localCurrentHalf: saved.currentHalf,
            localIsRunning: saved.isRunning,
            localLastUpdateMs: saved.lastUpdateTime,
          });
          // This effect fires on EVERY resume, so it is not a first hydrate
          // after the first one — `shouldPreferLocalOnFirstHydrate` alone lacks
          // the equal-timestamp divergence and backwards-regression rules. The
          // widget writes the SAME localStorage key the board reads, so a stale
          // snapshot accepted here becomes the board's next local baseline.
          // Require both guards, exactly like GameTimer.
          const decision = shouldAcceptServerSnapshot(
            serverTimerRef.current,
            incoming,
            {
              isRunning: saved.isRunning,
              currentHalf: saved.currentHalf,
              elapsedSeconds: getCurrentGameSeconds(saved),
              isGameFinished: Boolean(saved.gameFinishedAt),
            },
          );
          if (preferLocal || !decision.accept) {
            console.info(
              '[GameTimerWidget] server row rejected — keeping local',
              preferLocal ? 'prefer-local-on-hydrate' : decision.reason,
            );
          } else {
            serverTimerRef.current = incoming;
            const mapped = serverToTimerState(
              incoming,
              res.server_now,
              { teamId: saved.teamId, teamName: saved.teamName, gameFinishedAt: saved.gameFinishedAt },
            );
            saveTimerState(mapped);
            setTimerState(mapped);
            setDisplaySeconds(mapped.elapsedSeconds);
            return;
          }
        }


      } catch (e) {
        console.warn('[GameTimerWidget] server hydrate failed, falling back to local drift', e);
      }

      // Legacy fallback (offline / pre-v2 row): project uncapped drift locally.
      if (!saved.isRunning || saved.isGameFinished) return;
      const uncappedDrift = getSecondsSinceUpdateUncapped(saved.lastUpdateTime);
      if (uncappedDrift < 2) return;

      const halfDuration = saved.minutesPerHalf * 60;
      let half: 1 | 2 = saved.currentHalf;
      let elapsed = (saved.elapsedSeconds || 0) + uncappedDrift;
      if (half === 1 && elapsed >= halfDuration) {
        half = 2;
        elapsed = elapsed - halfDuration;
        saved.currentHalf = 2;
        saved.isRunning = false;
      }
      if (half === 2 && elapsed >= halfDuration) {
        saved.elapsedSeconds = halfDuration;
        saved.isRunning = false;
        saved.isGameFinished = true;
      } else {
        saved.elapsedSeconds = elapsed;
      }

      saved.lastUpdateTime = Date.now();
      saveTimerState(saved);
      setTimerState({ ...saved });
      setDisplaySeconds(saved.currentHalf === 2 && saved.elapsedSeconds === 0 ? 0 : saved.elapsedSeconds);
    };


    const flushOnHide = () => {
      const saved = loadActiveTimerState();
      if (!saved || !saved.isRunning || saved.isGameFinished) return;
      try {
        // CRITICAL: roll accumulated drift into elapsedSeconds BEFORE re-stamping
        // lastUpdateTime. The widget is a read-only display when no GameTimer is
        // mounted — nobody else has been advancing elapsedSeconds tick-by-tick.
        // Resetting the anchor without crediting the drift would silently lose
        // every second that passed between the last writer's save and now
        // (e.g. user navigates Pitch → Home → locks phone: the gap on Home
        // disappears from the clock on resume).
        const halfDur = (saved.minutesPerHalf || 20) * 60;
        const drift = getSecondsSinceUpdateUncapped(saved.lastUpdateTime);
        const projected = Math.min((saved.elapsedSeconds || 0) + drift, halfDur);
        saveTimerState({ ...saved, elapsedSeconds: projected, lastUpdateTime: Date.now() });
      } catch {}
    };

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

    let appListener: any = null;
    let cancelled = false;
    (async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app');
        const listener = await CapApp.addListener('appStateChange', ({ isActive }: { isActive: boolean }) => {
          if (isActive) reconcileAfterResume();
          else flushOnHide();
        });
        if (cancelled) listener.remove();
        else appListener = listener;
      } catch {}
    })();

    // Run immediately on mount to catch resumes where the event already fired
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
  }, []);

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }, []);

  const toggleTimer = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Read fresh state from localStorage to avoid stale-closure race with polling
    const fresh = loadActiveTimerState();
    if (!fresh) return;

    // Mark user action so polling doesn't revert this change
    userActionAtRef.current = Date.now();

    const currentElapsed = getCurrentElapsed(fresh);
    const mph = fresh.minutesPerHalf || 20;
    const atHalfTimeLimit = currentElapsed >= mph * 60;

    // Determine which server event this press maps to.
    let serverEvent: Parameters<typeof sendTimerEvent>[0]["event"] | null = null;

    // If currently in 1st half and at the time limit, transition to 2nd half
    if (!fresh.isRunning && fresh.currentHalf === 1 && atHalfTimeLimit) {
      const newState = { ...fresh, currentHalf: 2 as 1 | 2, elapsedSeconds: 0, isRunning: true, lastUpdateTime: Date.now() };
      saveTimerState(newState);
      setTimerState(newState);
      setDisplaySeconds(0);
      serverEvent = "start_half_2";
    } else if (!fresh.isRunning && fresh.currentHalf === 2 && atHalfTimeLimit) {
      // Don't allow resuming if game is finished (2nd half at limit)
      return;
    } else {
      const newState = { ...fresh, isRunning: !fresh.isRunning, lastUpdateTime: Date.now(), elapsedSeconds: currentElapsed };
      saveTimerState(newState);
      setTimerState(newState);
      setDisplaySeconds(currentElapsed);
      serverEvent = !fresh.isRunning
        ? (currentElapsed === 0 && fresh.currentHalf === 1 ? "start_half"
          : currentElapsed === 0 && fresh.currentHalf === 2 ? "start_half_2"
          : "resume")
        : "pause";
    }

    // Mirror to the server-anchored timer so resume / lock / cross-device
    // all snap to the same elapsed seconds. Re-hydrate from the response so
    // the widget reflects the authoritative state immediately.
    if (serverEvent) {
      sendTimerEvent({ teamId: fresh.teamId ?? null, event: serverEvent, minutesPerHalf: mph })
        .then((res) => {
          // Never map a malformed row back into the widget — a clobbered
          // "fake v2" payload derives elapsed = 0 and would zero the clock.
          if (!isServerAnchoredTimer(res.timer_state)) {
            console.warn("[GameTimerWidget] ignoring malformed timer_state from", serverEvent);
            return;
          }
          const mapped = serverToTimerState(
            res.timer_state,
            res.server_now,
            { teamId: fresh.teamId, teamName: fresh.teamName, gameFinishedAt: fresh.gameFinishedAt },
          );
          saveTimerState(mapped);
          setTimerState(mapped);
          setDisplaySeconds(mapped.elapsedSeconds);
        })
        .catch((err) => console.warn("[GameTimerWidget] sendTimerEvent failed", serverEvent, err));
    }

  };


  const handleOpenPitchBoard = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (timerState?.teamId && timerState?.teamName && onOpenPitchBoard) {
      onOpenPitchBoard(timerState.teamId, timerState.teamName);
    }
  };

  const handleDismiss = useCallback(() => {
    // Only hide the widget — do NOT delete timer or pitch state
    const teamId = timerState?.teamId;
    localStorage.setItem(WIDGET_DISMISSED_KEY, teamId || 'true');
    setTimerState(null);
  }, [timerState?.teamId]);

  // Swipe-to-dismiss state
  const swipeRef = useRef<{ startX: number; startY: number; swiping: boolean }>({ startX: 0, startY: 0, swiping: false });
  const [swipeOffset, setSwipeOffset] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    swipeRef.current = { startX: touch.clientX, startY: touch.clientY, swiping: false };
    setSwipeOffset(0);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const dx = touch.clientX - swipeRef.current.startX;
    const dy = touch.clientY - swipeRef.current.startY;

    // Only start swiping if horizontal movement exceeds vertical (prevent scroll hijack)
    if (!swipeRef.current.swiping && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swipeRef.current.swiping = true;
    }

    if (swipeRef.current.swiping) {
      e.preventDefault();
      setSwipeOffset(dx);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (swipeRef.current.swiping) {
      const threshold = cardRef.current ? cardRef.current.offsetWidth * 0.35 : 120;
      if (Math.abs(swipeOffset) > threshold) {
        // Animate off-screen then dismiss
        setSwipeOffset(swipeOffset > 0 ? 500 : -500);
        setTimeout(handleDismiss, 200);
      } else {
        setSwipeOffset(0);
      }
    }
    swipeRef.current = { startX: 0, startY: 0, swiping: false };
  }, [swipeOffset, handleDismiss]);

  const openSubDialog = (index: number) => {
    setSelectedSubIndex(index);
    setEditedPlayerOutId(null);
    setEditedPlayerInId(null);
    setShowConfirmDialog(true);
  };

  const executeSubstitution = () => {
    if (!selectedSub) return;
    const { sub } = selectedSub;
    try {
      const pitchState = readPitchState(timerState?.teamId);
      if (!pitchState) return;

      // Guard: check if this sub was already skipped (e.g., by auto-skip while dialog was open)
      const matchingSub = pitchState.autoSubPlan?.find(s =>
        s.playerOut.id === sub.playerOut.id && s.playerIn.id === sub.playerIn.id && s.time === sub.time && s.half === sub.half
      );
      if (matchingSub?.executed || matchingSub?.skipped) {
        toast({ title: "Substitution expired", description: "This sub was already skipped — a newer one is due", variant: "destructive" });
        setShowConfirmDialog(false);
        return;
      }
      let currentElapsedSeconds = 0, currentHalf: 1 | 2 = 1, minutesPerHalf = 20;
      if (timerState) {
        minutesPerHalf = timerState.minutesPerHalf || 20;
        currentHalf = timerState.currentHalf || 1;
        currentElapsedSeconds = getCurrentElapsed(timerState);
      }

      const playerOut = actualPlayerOut || sub.playerOut;
      const playerIn = actualPlayerIn || sub.playerIn;
      const currentPlayerOut = pitchState.players.find(p => p.id === playerOut.id);
      const currentPlayerIn = pitchState.players.find(p => p.id === playerIn.id);

      if (!currentPlayerOut?.position || !currentPlayerIn || !!currentPlayerIn.position) {
        // Invalid state - skip this sub and refresh remaining plan against live players
        let updatedPlan = pitchState.autoSubPlan.map(s =>
          s.playerOut.id === sub.playerOut.id && s.playerIn.id === sub.playerIn.id && s.time === sub.time && s.half === sub.half
            ? { ...s, executed: true, skipped: true } : s
        );

        const halfDur = minutesPerHalf * 60;
        const remaining = updatedPlan.filter(s => !s.executed);
        if (remaining.length > 0) {
          const recalculated = recalculateRemainingPlan(
            pitchState.players,
            parseInt(pitchState.teamSize),
            halfDur,
            currentElapsedSeconds,
            currentHalf as 1 | 2,
            { ...sub, executed: true, skipped: true },
            true
          );

          const executedSubs = updatedPlan.filter(s => s.executed);
          if (recalculated.length > 0 || remaining.length === 0) {
            updatedPlan = [...executedSubs, ...recalculated];
          } else {
            const benchPlayers = pitchState.players.filter(p => p.position === null && !p.isInjured);
            if (benchPlayers.length > 0) {
              console.warn("[GameTimerWidget] Invalid-state recalculation returned empty but bench players remain — preserving existing plan");
              updatedPlan = [...executedSubs, ...remaining];
            } else {
              updatedPlan = [...executedSubs, ...recalculated];
            }
          }
        }

        // Validate remaining plan entries against current player positions
        updatedPlan = validateAndFixRemainingPlan(updatedPlan, pitchState.players);
        writePitchState({ ...pitchState, autoSubPlan: updatedPlan });
        window.dispatchEvent(new StorageEvent('storage', { key: PITCH_STATE_KEY }));
        toast({ title: "Sub rescheduled", description: `${playerIn.name} is already ${currentPlayerIn?.position ? 'on' : 'off'} the pitch — remaining subs recalculated`, variant: "default" });
        setShowConfirmDialog(false);
        return;
      }

      const pitchPosition = { ...currentPlayerOut.position };
      const pitchPositionType = currentPlayerOut.currentPitchPosition;
      const updatedPlayers = pitchState.players.map(p => {
        if (p.id === playerOut.id) return { ...p, position: null, currentPitchPosition: undefined };
        if (p.id === playerIn.id) return { ...p, position: pitchPosition, currentPitchPosition: pitchPositionType };
        return p;
      });

      const subTotal = getTotalSeconds(sub.time, sub.half, minutesPerHalf);
      const currentTotal = getTotalSeconds(currentElapsedSeconds, currentHalf, minutesPerHalf);
      const delaySeconds = Math.max(0, currentTotal - subTotal);
      const earlyBySeconds = Math.max(0, subTotal - currentTotal);

      let updatedPlan = pitchState.autoSubPlan.map(s =>
        s.playerOut.id === sub.playerOut.id && s.playerIn.id === sub.playerIn.id && s.time === sub.time && s.half === sub.half
          ? { ...s, executed: true } : s
      );

      // If the sub was confirmed early/late or at halftime, rebuild remaining assignments
      // from live pitch state so skipped/changed players don't cause stale future subs.
      const isSignificantlyEarly = earlyBySeconds > 15;
      const isSignificantlyLate = delaySeconds > 30;
      const isHalftimeSub = sub.half === 2 && sub.time === 0;

      if ((isSignificantlyEarly || isSignificantlyLate || isHalftimeSub) && updatedPlan.some(s => !s.executed)) {
        const halfDur = minutesPerHalf * 60;
        const remaining = updatedPlan.filter(s => !s.executed);
        const recalculated = recalculateRemainingPlan(
          updatedPlayers,
          parseInt(pitchState.teamSize),
          halfDur,
          currentElapsedSeconds,
          currentHalf as 1 | 2,
          { ...sub, executed: true },
          true
        );
        const executedSubs = updatedPlan.filter(s => s.executed);

        if (recalculated.length > 0 || remaining.length === 0) {
          updatedPlan = [...executedSubs, ...recalculated];
        } else {
          const benchPlayers = updatedPlayers.filter(p => p.position === null && !p.isInjured);
          if (benchPlayers.length > 0) {
            console.warn("[GameTimerWidget] Early/late recalculation returned empty but bench players remain — preserving existing plan");
            updatedPlan = [...executedSubs, ...remaining];
          } else {
            updatedPlan = [...executedSubs, ...recalculated];
          }
        }
      }

      // Validate remaining plan entries against updated player positions
      const validatedPlan = validateAndFixRemainingPlan(updatedPlan, updatedPlayers);
      writePitchState({ ...pitchState, autoSubPlan: validatedPlan, players: updatedPlayers });
      window.dispatchEvent(new StorageEvent('storage', { key: PITCH_STATE_KEY }));
      toast({ title: "Substitution made", description: `${playerIn.name} on for ${playerOut.name}` });
    } catch (e) {
      console.error("[GameTimerWidget] Error executing sub:", e);
      toast({ title: "Error", description: "Failed to execute substitution", variant: "destructive" });
    }
    setShowConfirmDialog(false);
  };

  const skipSubstitution = () => {
    if (!selectedSub) return;
    const { sub } = selectedSub;
    try {
      const pitchState = readPitchState(timerState?.teamId);
      if (!pitchState) return;
      let currentElapsedSeconds = 0, currentHalf: 1 | 2 = 1, minutesPerHalf = 20;
      if (timerState) {
        minutesPerHalf = timerState.minutesPerHalf || 20;
        currentHalf = timerState.currentHalf || 1;
        currentElapsedSeconds = getCurrentElapsed(timerState);
      }
      let updatedPlan = pitchState.autoSubPlan.map(s =>
        s.playerOut.id === sub.playerOut.id && s.playerIn.id === sub.playerIn.id && s.time === sub.time && s.half === sub.half
          ? { ...s, executed: true, skipped: true } : s
      );

      const remaining = updatedPlan.filter(s => !s.executed);

      if (remaining.length > 0) {
        const halfDur = minutesPerHalf * 60;
        const recalculated = recalculateRemainingPlan(
          pitchState.players,
          parseInt(pitchState.teamSize),
          halfDur,
          currentElapsedSeconds,
          currentHalf as 1 | 2,
          { ...sub, executed: true, skipped: true },
          true
        );

        const executedSubs = updatedPlan.filter(s => s.executed);
        if (recalculated.length > 0 || remaining.length === 0) {
          updatedPlan = [...executedSubs, ...recalculated];
        } else {
          const benchPlayers = pitchState.players.filter(p => p.position === null && !p.isInjured);
          if (benchPlayers.length > 0) {
            console.warn("[GameTimerWidget] Skip recalculation returned empty but bench players remain — preserving existing plan");
            updatedPlan = [...executedSubs, ...remaining];
          } else {
            updatedPlan = [...executedSubs, ...recalculated];
          }
        }
      }

      // Validate remaining plan entries against current player positions
      updatedPlan = validateAndFixRemainingPlan(updatedPlan, pitchState.players);
      writePitchState({ ...pitchState, autoSubPlan: updatedPlan });
      window.dispatchEvent(new StorageEvent('storage', { key: PITCH_STATE_KEY }));
      toast({ title: "Substitution skipped", description: "Remaining subs have been rescheduled" });
    } catch (e) {
      console.error("[GameTimerWidget] Error skipping sub:", e);
      toast({ title: "Error", description: "Failed to skip substitution", variant: "destructive" });
    }
    setShowConfirmDialog(false);
  };

  // Don't show if no timer state or timer hasn't started.
  // When the game has concluded, keep the widget visible for 60 minutes
  // showing "Full Time" so users can review the final score and lineup.
  const halfDurSec = (timerState?.minutesPerHalf || 0) * 60;
  const isGameConcluded = !!timerState && (
    timerState.isGameFinished === true ||
    (timerState.currentHalf === 2 && displaySeconds >= halfDurSec)
  );
  const finishedAt = timerState?.gameFinishedAt ?? (isGameConcluded ? timerState?.lastUpdateTime : undefined);
  const postGameExpired = isGameConcluded && finishedAt
    ? Date.now() - finishedAt > POST_GAME_VISIBILITY_MS
    : false;

  if (!timerState || (timerState.elapsedSeconds === 0 && !timerState.isRunning && timerState.currentHalf === 1) || postGameExpired) {
    return null;
  }

  const halfLabel = isGameConcluded
    ? "Full Time"
    : timerState.currentHalf === 1 ? "1st Half" : "2nd Half";
  const hasScore = homeGoals > 0 || awayGoals > 0;
  const firstSub = allSubs[0] || null;

  const formatSubCountdown = (info: SubInfo) => {
    if (info.sub.skipped) return "Skipped";
    if (info.sub.executed) return "Done";
    if (gameFinished) return "Game over";
    if (info.isDue) return "Sub due now";
    const mins = Math.floor(info.secondsUntil / 60);
    const secs = info.secondsUntil % 60;
    if (mins > 0) return `Sub in ${mins}:${secs.toString().padStart(2, '0')}`;
    return `Sub in ${secs}s`;
  };

  return (
    <>
      <Card 
        ref={cardRef}
        className={`relative ${firstSub?.isDue ? "border-warning/50 bg-warning/5" : "border-primary/30 bg-primary/5"} touch-pan-y`}
        style={{
          transform: swipeOffset ? `translateX(${swipeOffset}px)` : undefined,
          opacity: swipeOffset ? Math.max(0.3, 1 - Math.abs(swipeOffset) / 300) : 1,
          transition: swipeRef.current.swiping ? 'none' : 'transform 0.2s ease-out, opacity 0.2s ease-out',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <CardContent className="p-3">
          {/* Main row: Timer + Score + Controls */}
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-full shrink-0 ${firstSub?.isDue ? "bg-warning/20" : "bg-primary/10"}`}>
              <Timer className={`h-5 w-5 ${firstSub?.isDue ? "text-warning" : "text-primary"} ${timerState.isRunning ? 'animate-pulse' : ''}`} />
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xl font-bold text-primary">
                  {isGameConcluded ? "FT" : formatTime(displaySeconds)}
                </span>
                {timerState.isRunning && !isGameConcluded && (
                  <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-destructive/50 text-destructive gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
                    LIVE
                  </Badge>
                )}
                {isGameConcluded && (
                  <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-primary/50 text-primary">
                    FULL TIME
                  </Badge>
                )}
                {hasScore && (
                  <span className="text-sm font-semibold text-muted-foreground ml-1">
                    {homeGoals} - {awayGoals}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{halfLabel}</span>
                {timerState.teamName && (
                  <>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground truncate">{timerState.teamName}</span>
                  </>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-1.5 shrink-0">
              {!readOnly && !isGameConcluded && (() => {
                const isEffectivelyPaused = !timerState.isRunning || 
                  (timerState.isRunning && displaySeconds >= timerState.minutesPerHalf * 60);
                return (
                  <Button variant="outline" size="icon" className="h-10 w-10" onClick={toggleTimer}>
                    {!isEffectivelyPaused ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  </Button>
                );
              })()}
              {timerState.teamId && timerState.teamName && onOpenPitchBoard && (
                <Button variant="default" size="icon" className="h-10 w-10" onClick={handleOpenPitchBoard}>
                  <LayoutGrid className="h-5 w-5" />
                </Button>
              )}
            
            </div>
          </div>

          {/* Next sub summary row (always visible when subs exist) */}
          {firstSub && (
            <button
              className={`mt-2 w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors ${
                firstSub.isDue ? "bg-warning/15 border border-warning/30" : "bg-muted/50"
              }`}
              onClick={() => setSubsExpanded(!subsExpanded)}
            >
              {firstSub.isDue ? (
                <ArrowRightLeft className="h-4 w-4 text-warning shrink-0" />
              ) : (
                <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className={`text-xs font-medium flex-1 truncate ${firstSub.isDue ? "text-warning" : "text-muted-foreground"}`}>
                {firstSub.isDue ? "SUB TIME" : formatSubCountdown(firstSub)} — OUT {firstSub.sub.playerOut.name} · IN {firstSub.sub.playerIn.name}
              </span>
              {allSubs.length > 1 && (
                <span className="text-[10px] text-muted-foreground shrink-0">+{allSubs.length - 1} more</span>
              )}
              {subsExpanded ? (
                <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
            </button>
          )}

          {/* Expanded sub list */}
          {subsExpanded && allSubs.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {allSubs.map((subInfo, idx) => {
                const isSkipped = subInfo.sub.skipped === true;
                const isExecuted = subInfo.sub.executed === true && !isSkipped;
                const isInactive = isSkipped || isExecuted || gameFinished;
                return (
                <div
                  key={`${subInfo.sub.playerOut.id}-${subInfo.sub.playerIn.id}-${subInfo.sub.time}`}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-2 ${
                    isSkipped ? "bg-muted/20 opacity-60" :
                    isExecuted ? "bg-muted/30" :
                    gameFinished ? "bg-muted/20 opacity-60" :
                    subInfo.isDue ? "bg-warning/10 border border-warning/20" : "bg-muted/30"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium ${
                      isSkipped ? "text-muted-foreground line-through" :
                      isExecuted ? "text-muted-foreground" :
                      gameFinished ? "text-muted-foreground" :
                      subInfo.isDue ? "text-warning" : "text-foreground"
                    }`}>
                      {formatSubCountdown(subInfo)}
                    </p>
                    <p className={`text-[11px] truncate ${isInactive ? "text-muted-foreground/70" : "text-muted-foreground"}`}>
                      OUT {subInfo.sub.playerOut.name} · IN {subInfo.sub.playerIn.name}
                    </p>
                  </div>
                  {!readOnly && (() => {
                    const actionable = !isInactive && isSubActionable(subInfo, idx);
                    return (
                      <Button
                        variant={subInfo.isDue && actionable ? "default" : "outline"}
                        size="sm"
                        className={`h-8 px-2.5 text-xs gap-1 shrink-0 ${subInfo.isDue && actionable ? "bg-warning text-warning-foreground hover:bg-warning/90" : ""}`}
                        onClick={(e) => { e.stopPropagation(); openSubDialog(idx); }}
                        disabled={subInfo.isDue && !actionable && !isInactive}
                      >
                        {isInactive ? (
                          <>
                            <Eye className="h-3.5 w-3.5" />
                            View
                          </>
                        ) : subInfo.isDue && actionable ? (
                          <>
                            <UserRoundCheck className="h-3.5 w-3.5" />
                            Accept
                          </>
                        ) : subInfo.isDue && !actionable ? (
                          <>
                            <Clock className="h-3.5 w-3.5" />
                            Next
                          </>
                        ) : actionable ? (
                          <>
                            <ArrowRightLeft className="h-3.5 w-3.5" />
                            Sub Now
                          </>
                        ) : (
                          <>
                            <Eye className="h-3.5 w-3.5" />
                            View
                          </>
                        )}
                      </Button>
                    );
                  })()}
                </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      {selectedSub && (
        <ResponsiveDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
          <ResponsiveDialogContent className="sm:max-w-md">
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle className="flex items-center gap-2">
                {selectedSub.sub.skipped ? (
                  <>
                    <Ban className="h-5 w-5 text-muted-foreground" />
                    Substitution Was Skipped
                  </>
                ) : selectedSub.sub.executed ? (
                  <>
                    <Check className="h-5 w-5 text-muted-foreground" />
                    Substitution Already Made
                  </>
                ) : gameFinished ? (
                  <>
                    <Timer className="h-5 w-5 text-muted-foreground" />
                    Game Has Finished
                  </>
                ) : (
                  <>
                    <ArrowRightLeft className="h-5 w-5" />
                    {selectedSub.isDue ? "Make This Substitution" : "Upcoming Substitution"}
                  </>
                )}
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                {selectedSub.sub.skipped
                  ? "This substitution was skipped and not made"
                  : selectedSub.sub.executed
                  ? "This substitution has already been completed"
                  : gameFinished
                  ? "This substitution was not made before the game ended"
                  : undefined}
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            
            {!selectedSub.isDue && !selectedSub.sub.executed && !selectedSub.sub.skipped && !gameFinished && (
              <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
                <Clock className="h-5 w-5 text-primary animate-pulse" />
                <div className="text-center">
                  <div className="text-lg font-bold text-primary">
                    {Math.floor(selectedSub.secondsUntil / 60)}:{(selectedSub.secondsUntil % 60).toString().padStart(2, '0')}
                  </div>
                  <div className="text-xs text-muted-foreground">until sub is due</div>
                </div>
              </div>
            )}
            
            <div className="space-y-3 py-3">
              {(() => {
                const sub = selectedSub.sub;
                const outPos = actualPlayerOut?.currentPitchPosition || sub.playerOut.currentPitchPosition;
                const specificOutPos = outPos ? getSpecificPositionLabel(actualPlayerOut?.position?.x, outPos) : 'Unknown';
                const inTargetPos = sub.positionSwap ? sub.positionSwap.fromPosition : outPos;
                const specificInPos = inTargetPos ? getSpecificPositionLabel(
                  sub.positionSwap ? sub.positionSwap.player.position?.x : actualPlayerOut?.position?.x,
                  inTargetPos
                ) : 'Unknown';
                const inPosColors = inTargetPos ? POSITION_COLORS[inTargetPos] : null;
                return (
                  <>
                    {/* Player coming off */}
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-destructive text-destructive-foreground text-xs font-bold flex-shrink-0">
                        {actualPlayerOut?.number || actualPlayerOut?.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm">{actualPlayerOut?.name}</div>
                        <div className="text-xs text-muted-foreground">{specificOutPos} → Bench</div>
                      </div>
                      <span className="text-sm font-bold text-destructive flex-shrink-0">OUT</span>
                    </div>
                    
                    {/* Player coming on */}
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500 text-white text-xs font-bold flex-shrink-0">
                        {actualPlayerIn?.number || actualPlayerIn?.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm">{actualPlayerIn?.name}</div>
                        <div className="text-xs text-muted-foreground">Bench → {specificInPos}</div>
                      </div>
                      {inPosColors && (
                        <span className={cn("text-xs font-bold flex-shrink-0 uppercase", inPosColors.text)}>{specificInPos}</span>
                      )}
                    </div>
                    
                    {/* Position swap */}
                    {sub.positionSwap && (() => {
                      const swapFromSpecific = getSpecificPositionLabel(sub.positionSwap!.player.position?.x, sub.positionSwap!.fromPosition);
                      const swapToSpecific = getSpecificPositionLabel(actualPlayerOut?.position?.x, sub.positionSwap!.toPosition);
                      const toColors = POSITION_COLORS[sub.positionSwap!.toPosition];
                      return (
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex-shrink-0">
                            {sub.positionSwap!.player.number || sub.positionSwap!.player.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-sm">{sub.positionSwap!.player.name}</div>
                            <div className="text-xs text-muted-foreground">{swapFromSpecific} → {swapToSpecific}</div>
                          </div>
                          <span className={cn("text-xs font-bold flex-shrink-0 uppercase", toColors.text)}>{swapToSpecific}</span>
                        </div>
                      );
                    })()}
                  </>
                );
              })()}
            </div>

            <ResponsiveDialogFooter className="flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => setShowConfirmDialog(false)} className="h-12 text-base sm:order-1">
                <X className="h-4 w-4 mr-2" />Close
              </Button>
              {isSelectedSubActionable && (
                <>
                  <Button variant="outline" onClick={skipSubstitution} className="h-12 text-base sm:order-2">
                    <SkipForward className="h-4 w-4 mr-2" />Skip
                  </Button>
                  <Button onClick={executeSubstitution} className="h-12 text-base sm:order-3">
                    <UserRoundCheck className="h-4 w-4 mr-2" />
                    {selectedSub.isDue ? "Confirm Sub" : "Sub Now"}
                  </Button>
                </>
              )}
            </ResponsiveDialogFooter>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )}
    </>
  );
}
