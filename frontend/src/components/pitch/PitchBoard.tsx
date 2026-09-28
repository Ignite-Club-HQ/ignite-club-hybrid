import { useState, useRef, useEffect, useCallback, useMemo, Suspense } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { StatusBar } from "@capacitor/status-bar";
import { refreshStatusBar } from "@/lib/statusBarControl";
import { useLazyFabric, prefetchFabric } from "@/hooks/useLazyFabric";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import PlayerToken from "./PlayerToken";
import SoccerBall from "./SoccerBall";
import { GameTimerRef, playSubAlertBeep } from "./GameTimer";
import PitchToolbar from "./PitchToolbar";
import { EventLinkSelector } from "./EventLinkSelector";
import { LinkedEventHeader } from "./LinkedEventHeader";
import { LandscapeEventSelector } from "./LandscapeEventSelector";
import { PitchPosition } from "./PositionBadge";

// Lazy load heavy dialog components for better initial load performance
const AutoSubPlanDialog = lazyWithRetry(() => import("./AutoSubPlanDialog"));
const SubstitutionPreviewDialog = lazyWithRetry(() => import("./SubstitutionPreviewDialog"));
const BenchToSubDialog = lazyWithRetry(() => import("./BenchToSubDialog"));
const MatchStatsPanel = lazyWithRetry(() => import("./MatchStatsPanel"));
const PlayerPositionEditor = lazyWithRetry(() => import("./PlayerPositionEditor"));
const PositionSwapDialog = lazyWithRetry(() => import("./PositionSwapDialog"));
const PitchSwapConfirmDialog = lazyWithRetry(() => import("./PitchSwapConfirmDialog"));
const ManualSubConfirmDialog = lazyWithRetry(() => import("./ManualSubConfirmDialog"));
const FormationChangeDialog = lazyWithRetry(() => import("./FormationChangeDialog"));
const PitchPlayerActionMenu = lazyWithRetry(() => import("./PitchPlayerActionMenu"));
const SubConfirmDialog = lazyWithRetry(() => import("./SubConfirmDialog"));
const AddFillInPlayerDialog = lazyWithRetry(() => import("./AddFillInPlayerDialog"));
const AutoSubManager = lazyWithRetry(() => import("./AutoSubManager"));
const AutoSubControlPanel = lazyWithRetry(() => import("./AutoSubControlPanel"));
const PreGameLineupScreen = lazyWithRetry(() => import("./PreGameLineupScreen"));
import TacticalModeSelector from "./TacticalModeSelector";
import { useAutoSubs } from "@/hooks/useAutoSubs";
import { usePitchSettings } from "@/hooks/usePitchSettings";
import { useDraggableTimer } from "@/hooks/useDraggableTimer";
import { useWakeLock } from "@/hooks/useWakeLock";
import { PitchSettingsDialog } from "./PitchSettingsDialog";

import { useToast } from "@/hooks/use-toast";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSwipeGesture } from "@/hooks/useSwipeGesture";
import { usePitchBoardNotifications } from "@/hooks/usePitchBoardNotifications";
import { useIsLandscape } from "@/hooks/useIsLandscape";
import { useEventGroupSync } from "@/hooks/useEventGroupSync";

import { useEventGoingAttendees } from "@/hooks/useEventGoingAttendees";
import { useEventLineupHydration } from "./hooks/useEventLineupHydration";

// Import types and utils from extracted files
import {
  Player,
  SubstitutionEvent,
  TeamSize,
  DrawingTool,
  Goal,
  getSpecificPositionLabel,
  MiniLeagueTeams,
} from "./types";
import ScoreTracker from "./ScoreTracker";
import {
  clearPitchState,
  loadTimerStateForMinutes,
} from "./pitchStateUtils";
import { getCurrentGameSeconds } from "./timerUtils";
import { usePitchBoardTimer } from "./hooks/usePitchBoardTimer";
import { usePitchBoardEventLink } from "./hooks/usePitchBoardEventLink";
import { usePitchBoardFillIn } from "./hooks/usePitchBoardFillIn";
import { usePitchBoardBall } from "./hooks/usePitchBoardBall";
import { usePitchBoardFormationChangeDialog, type FormationChangeDialogDeps } from "./hooks/usePitchBoardFormationChangeDialog";
import { usePitchBoardLineup, type LineupDeps } from "./hooks/usePitchBoardLineup";
import { usePitchBoardPinchZoom } from "./hooks/usePitchBoardPinchZoom";
import { usePitchBoardDragDrop, type DragDropDeps } from "./hooks/usePitchBoardDragDrop";
import { usePitchBoardTactical } from "./hooks/usePitchBoardTactical";
import { usePitchBoardSubSelection } from "./hooks/usePitchBoardSubSelection";
import { usePitchBoardManualSub } from "./hooks/usePitchBoardManualSub";
import { usePitchBoardBenchToSub } from "./hooks/usePitchBoardBenchToSub";
import { usePitchBoardPropSync } from "./hooks/usePitchBoardPropSync";
import { usePitchBoardPersistence } from "./hooks/usePitchBoardPersistence";
import { usePitchBoardPlayerBootstrap } from "./hooks/usePitchBoardPlayerBootstrap";
import { usePitchBoardLifecycle } from "./hooks/usePitchBoardLifecycle";
import { usePitchBoardDrawing } from "./hooks/usePitchBoardDrawing";
import { usePitchBoardPlanRepair } from "./hooks/usePitchBoardPlanRepair";
import { usePitchBoardInitialState } from "./hooks/usePitchBoardInitialState";
import { usePitchBoardFormationLibrary } from "./hooks/usePitchBoardFormationLibrary";
import { usePitchBoardUndo } from "./hooks/usePitchBoardUndo";
import { usePitchBoardSubAnimation } from "./hooks/usePitchBoardSubAnimation";
import { usePitchBoardBenchLongPress } from "./hooks/usePitchBoardBenchLongPress";
import { usePitchBoardSwapMode } from "./hooks/usePitchBoardSwapMode";
import { usePitchBoardSwapSubstitution } from "./hooks/usePitchBoardSwapSubstitution";
import { usePitchBoardResetGame } from "./hooks/usePitchBoardResetGame";
import { usePitchBoardUnlinkEvent } from "./hooks/usePitchBoardUnlinkEvent";
import { usePitchBoardFormationManagement } from "./hooks/usePitchBoardFormationManagement";
import { usePitchBoardPitchGeometry } from "./hooks/usePitchBoardPitchGeometry";
import { usePitchBoardMockPlayers } from "./hooks/usePitchBoardMockPlayers";
import { usePitchBoardInjuries } from "./hooks/usePitchBoardInjuries";
import {
  usePitchBoardLiveRosterSync,
  usePitchBoardRosterReconciliation,
} from "./hooks/usePitchBoardRosterReconciliation";
import { usePitchBoardPlayerPlacement } from "./hooks/usePitchBoardPlayerPlacement";
import { TacticalMode, computeTacticalOffsets, computeBallOffset, TACTICAL_MODE_LABELS, RECOMMENDED_FORMATIONS } from "./tacticalMode";
import { PitchBoardLayoutContext } from "./PitchBoardLayoutContext";
import type { PitchBoardLayoutContextValue } from "./PitchBoardLayoutContext";
import { acknowledgeHalftimePrompt, canShowHalftimePrompt, getHalftimePromptAckKey, hasAcknowledgedHalftimePrompt } from "./halftimePromptAck";

import { Download } from "lucide-react";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
// Only one orientation layout is ever rendered at a time (~3.9k combined lines);
// lazy-load both so a device only downloads/parses the one it actually needs.
const PitchBoardLandscapeLayout = lazyWithRetry(() => import("./PitchBoardLandscapeLayout"));
const PitchBoardPortraitLayout = lazyWithRetry(() => import("./PitchBoardPortraitLayout"));




interface PitchBoardProps {
  teamId: string;
  teamName: string;
  members: Array<{
    id: string;
    user_id: string;
    role: string;
    profiles: { display_name: string | null; avatar_url: string | null } | null;
  }>;
  onClose: () => void;
  disableAutoSubs?: boolean;
  initialRotationSpeed?: number;
  initialDisablePositionSwaps?: boolean;
  initialDisableBatchSubs?: boolean;
  initialRotateGkAtHalftime?: boolean;
  initialMinutesPerHalf?: number;
  initialMaxSpreadMinutes?: number;
  initialTeamSize?: number;
  initialFormation?: string;
  readOnly?: boolean;
  isSubsManager?: boolean;
  initialLinkedEventId?: string | null;
  initialShowMatchHeader?: boolean;
  initialShowLineupPicker?: boolean;
  // Mini-league two-team mode configuration
  miniLeagueTeams?: MiniLeagueTeams;
  onUnlinkEvent?: () => void;
}

// Loading fallback for lazy-loaded dialogs
const DialogLoader = () => (
  <div className="flex items-center justify-center p-4">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

// Pitch board loading component with soccer ball and Ignite logo
const PitchBoardLoading = ({ message = "Loading..." }: { message?: string }) => (
  <div className="flex-1 flex flex-col items-center justify-center gap-4 py-12 bg-pitch-green min-h-[300px]">
    <div className="flex items-center gap-3">
      <div className="p-3 rounded-xl bg-primary">
        <Flame className="h-8 w-8 text-primary-foreground" />
      </div>
      <span className="text-4xl" role="img" aria-label="soccer ball">⚽</span>
    </div>
    <Loader2 className="h-6 w-6 animate-spin text-white" />
    <p className="text-sm text-white/80">{message}</p>
  </div>
);

function PitchBoardInner({ teamId, teamName, members, onClose, disableAutoSubs = false, initialRotationSpeed = 1, initialDisablePositionSwaps = false, initialDisableBatchSubs = false, initialRotateGkAtHalftime = true, initialMinutesPerHalf = 10, initialMaxSpreadMinutes = 5, initialTeamSize, initialFormation, readOnly = false, isSubsManager = false, initialLinkedEventId, initialShowMatchHeader = true, initialShowLineupPicker = true, miniLeagueTeams, onUnlinkEvent }: PitchBoardProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { pitchBoardNotificationsEnabled } = usePitchBoardNotifications();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { isLandscape, isMobileLandscape } = useIsLandscape();

  // One-time discovery hint: now that the Swap button is gone, surface drag-to-swap once.
  useEffect(() => {
    if (readOnly) return;
    try {
      const KEY = "pitchboard.dragSwapHintShown.v1";
      if (localStorage.getItem(KEY)) return;
      const t = setTimeout(() => {
        toast({
          title: "Quick tip",
          description: "Tap a player on the pitch to sub or swap them. Drag also works.",
        });
        try { localStorage.setItem(KEY, "1"); } catch {}
      }, 1200);
      return () => clearTimeout(t);
    } catch {}
  }, [readOnly, toast]);

  // Hide status bar in landscape on native to fill the whole screen
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const hideOrShow = async () => {
      try {
        if (isLandscape) {
          await StatusBar.hide();
        } else {
          // refreshStatusBar internally calls StatusBar.show() and re-applies
          // the correct theme-aware style/background in the right order.
          refreshStatusBar();
        }
      } catch (e) {
        console.warn('[PitchBoard] StatusBar toggle error:', e);
      }
    };
    hideOrShow();
    return () => {
      if (Capacitor.isNativePlatform()) {
        // Always restore the theme-aware status bar on unmount.
        refreshStatusBar();
      }
    };
  }, [isLandscape]);

  // Event group sync - syncs pitch board state to database for mini-league matches
  // readOnly (spectator / BoardViewerDialog) must never write back: its mirrored
  // localStorage copy goes stale while the coach's clock advances.
  const { forceSync: forceEventGroupSync, isEventGroup } = useEventGroupSync(teamId, null, { readOnly });
  
  // State initialization flag
  const [hasInitialized, setHasInitialized] = useState(false);
  
  // Step 9b: one-shot saved-state load + initial team-size/formation getters.
  const { savedState, getInitialTeamSize, getInitialFormationIndex } =
    usePitchBoardInitialState({ teamId, initialTeamSize, initialFormation });
  
  // Timer state + per-tick minute math live in usePitchBoardTimer (audit #9
  // step 1 of the PitchBoard split). Setters/callbacks that are created
  // later in the component body are wired in via refs — see assignments
  // after `useState<Player[]>`, after `useAutoSubs`, and after the
  // `elapsedGameTime` state declaration further down.
  const setPlayersRef = useRef<React.Dispatch<React.SetStateAction<Player[]>> | null>(null);
  const setElapsedGameTimeRef = useRef<React.Dispatch<React.SetStateAction<number>> | null>(null);
  const updateNextSubInfoRef_timer = useRef<((elapsedSeconds: number, currentHalf: 1 | 2) => void) | null>(null);
  const checkForDueSubsRef_timer = useRef<((elapsedSeconds: number, currentHalf: 1 | 2) => void) | null>(null);
  const minutesPerHalfRef = useRef<number>(initialMinutesPerHalf);
  const gameTimerRef = useRef<GameTimerRef>(null);
  const {
    gameInProgress,
    setGameInProgress,
    timerResetKey,
    setTimerResetKey,
    lastTimeUpdateRef,
    hasInitializedTimeRef,
    handleTimerUpdate,
  } = usePitchBoardTimer({
    teamId,
    savedState,
    minutesPerHalfRef,
    gameTimerRef,
    setPlayersRef,
    setElapsedGameTimeRef,
    updateNextSubInfoRef: updateNextSubInfoRef_timer,
    checkForDueSubsRef: checkForDueSubsRef_timer,
  });
  
  

  
  const [teamSize, setTeamSize] = useState<TeamSize>(getInitialTeamSize);
  const [selectedFormation, setSelectedFormation] = useState(() => getInitialFormationIndex(getInitialTeamSize()));
  const [drawingTool, setDrawingTool] = useState<DrawingTool>("none");
  const [drawingColor, setDrawingColor] = useState("#ffffff");
  
  // Lazy load Fabric.js - initialize when drawing mode is enabled
  const drawingEnabled = drawingTool !== "none";
  const drawingEverEnabledRef = useRef(false);
  if (drawingEnabled) drawingEverEnabledRef.current = true;
  const { 
    canvas: fabricCanvas, 
    isLoading: isFabricLoading, 
    isReady: isFabricReady,
    fabricModule,
    clearCanvas: clearFabricCanvas 
  } = useLazyFabric({
    canvasRef,
    containerRef,
    enabled: drawingEnabled || drawingEverEnabledRef.current,
    initialColor: drawingColor,
    dependencies: [isLandscape],
  });
  
  // Prefetch Fabric.js in background after initial render
  useEffect(() => {
    prefetchFabric();
  }, []);
  
  // Save/Load state
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [formationName, setFormationName] = useState("");
  
  // Position assignment editor state
  const [positionEditorOpen, setPositionEditorOpen] = useState(false);
  const [positionSwapDialogOpen, setPositionSwapDialogOpen] = useState(false);
  const [pendingSubBenchPlayer, setPendingSubBenchPlayer] = useState<string | null>(null);
  const [requiredPosition, setRequiredPosition] = useState<PitchPosition | null>(null);
  
  // Bench position filter
  const [benchPositionFilter, setBenchPositionFilter] = useState<PitchPosition | null>(null);
  
  // Substitution preview dialog
  const [subPreviewOpen, setSubPreviewOpen] = useState(false);
  const [previewSwapPlayers, setPreviewSwapPlayers] = useState<{ sourceId: string | null; targetId: string | null }>({ sourceId: null, targetId: null });

  // Formation/team-size change dialog state + handlers live in
  // usePitchBoardFormationChangeDialog. Dependencies are passed via a ref
  // (updated on every render below) so the hook can be declared early.
  const formationDialogDepsRef = useRef<FormationChangeDialogDeps | null>(null);
  const {
    formationChangeDialogOpen,
    setFormationChangeDialogOpen,
    pendingFormationChange,
    setPendingFormationChange,
    handleFormationChangeConfirm,
    handleFormationChangeCancel,
  } = usePitchBoardFormationChangeDialog(formationDialogDepsRef);

  // Lineup confirm/skip + formation change (preview & apply) live in
  // usePitchBoardLineup. Same ref-passing pattern as above.
  const lineupDepsRef = useRef<LineupDeps | null>(null);
  const {
    handleLineupConfirm,
    handleLineupSkip,
    handleFormationChange,
    applyFormationChange,
  } = usePitchBoardLineup(lineupDepsRef);

  // Auto-sub plan state (hook setup happens below after runSubAnimation is defined)
  // gameTimerRef is declared above as part of usePitchBoardTimer wiring.
  const [autoSubPlanDialogOpen, setAutoSubPlanDialogOpen] = useState(false);
  const [autoSubPlanEditMode, setAutoSubPlanEditMode] = useState(false);
  const [autoSubFromPreGame, setAutoSubFromPreGame] = useState(false);
  const [preferredSecondHalfGkId, setPreferredSecondHalfGkId] = useState<string | undefined>(undefined);

  // Keep `preferredSecondHalfGkId` in sync with the live roster. A nominated
  // 2H GK is allowed to start on pitch as an outfielder, so only clear the
  // preference when the player is gone, injured, or already the 1H GK.
  // Prefer the event the board was launched from. Falling back to savedState
  // first caused stale links (or no link at all) when entering from "Prepare
  // Lineup" on a different event than the previously-saved game.
  const {
    linkedEventId,
    setLinkedEventId,
    handleLinkEvent,
    linkedEventDetails,
    opponentName,
  } = usePitchBoardEventLink({
    initialLinkedEventId,
    savedLinkedEventId: savedState?.linkedEventId,
    teamId,
    teamName,
    userId: user?.id,
  });
  const [showMatchHeader, setShowMatchHeader] = useState(() => initialShowMatchHeader);
  const [goals, setGoals] = useState<Goal[]>(() => savedState?.goals || []);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(true); // Start collapsed by default
  const [bottomSheetTab, setBottomSheetTab] = useState<"bench" | "setup">("bench");
  const [showFloatingDrawToolbar, setShowFloatingDrawToolbar] = useState(false);
  const [pinDrawingToolbar, setPinDrawingToolbar] = useState(false);
  const [pinPitchShortcuts, setPinPitchShortcuts] = useState(true);
  const [sheetHeightPct, setSheetHeightPct] = useState(35);
  const sheetDragRef = useRef<{ startY: number; startPct: number } | null>(null);
  const ignoreNextLandscapeBackdropClickRef = useRef(false);
  const ignoreNextLandscapeBenchOpenRef = useRef(false);
  const [portraitSheetOpen, setPortraitSheetOpen] = useState(false);
  const [portraitSheetHeightPct, setPortraitSheetHeightPct] = useState(45);
  const portraitSheetDragRef = useRef<{ startY: number; startPct: number } | null>(null);
  // Track if game has started. Initialize from saved timer state so that
  // a page reload mid-match (or a parent re-render before the first timer
  // tick) cannot let the prop-sync effect below clobber the live
  // minutesPerHalf with a transient `|| 10` fallback from the parent.
  // gameInProgress + timerResetKey are owned by usePitchBoardTimer above.
  const [showScoreInPortrait, setShowScoreInPortrait] = useState(false); // Toggle score visibility in portrait
  const [hideScores, setHideScores] = useState(false); // Hide scores and disable scoring
  const [landscapeEventSelectorOpen, setLandscapeEventSelectorOpen] = useState(false); // Event selector for landscape toolbar
  const [minutesPerHalf, setMinutesPerHalf] = useState(() => {
    // If a game is already in progress for this team, the saved timer state
    // is the source of truth — using the parent prop here can land on a
    // transient `|| 10` fallback during a React Query refetch and silently
    // shorten the live half.
    try {
      const t = loadTimerStateForMinutes(teamId);
      if (t && t.minutesPerHalf && (t.isRunning || (t.elapsedSeconds && t.elapsedSeconds > 0) || t.currentHalf === 2 || t.isGameFinished)) {
        return t.minutesPerHalf;
      }
    } catch {}
    return initialMinutesPerHalf;
  }); // Time per half for settings
  const [rotationSpeed, setRotationSpeed] = useState(() => initialRotationSpeed); // Subs speed
  const [disablePositionSwaps, setDisablePositionSwaps] = useState(() => initialDisablePositionSwaps); // Disable position swaps in auto sub generation
  const [disableBatchSubs, setDisableBatchSubs] = useState(() => initialDisableBatchSubs); // Disable batch subs (multiple at once)
  const [rotateGkAtHalftime, setRotateGkAtHalftime] = useState(() => initialRotateGkAtHalftime); // Rotate GK at halftime
  const [maxSpreadMinutes, setMaxSpreadMinutes] = useState(() => initialMaxSpreadMinutes); // Max acceptable playing-time spread (minutes)
  const [showLineupPicker, setShowLineupPicker] = useState(() => {
    // Show lineup picker on mount only when launching into a fresh match context.
    // Skip the picker if:
    //  - saved state exists for the same event, OR
    //  - the user has already set up a lineup (any player placed on pitch) or
    //    configured auto-subs for this team — even if the saved event differs.
    //    Re-opening from the match should drop straight into the board, not setup.
    const savedForSameEvent = !!savedState && savedState.linkedEventId === initialLinkedEventId;
    const hasExistingLineup = !!savedState && (
      (savedState.players?.some(p => p && p.position !== null)) ||
      ((savedState.autoSubPlan?.length ?? 0) > 0)
    );
    return initialShowLineupPicker
      && !!initialLinkedEventId
      && !savedForSameEvent
      && !hasExistingLineup
      && !readOnly
      && !miniLeagueTeams;
  });
  const [showLineupPickerSetting, setShowLineupPickerSetting] = useState(() => initialShowLineupPicker); // Persist setting
  const halftimePromptAckKey = useMemo(
    () => getHalftimePromptAckKey(loadTimerStateForMinutes(teamId), savedState),
    [teamId, savedState]
  );
  const handleAcknowledgeHalftimePrompt = useCallback(() => {
    acknowledgeHalftimePrompt(getHalftimePromptAckKey(loadTimerStateForMinutes(teamId), savedState) ?? halftimePromptAckKey);
  }, [teamId, savedState, halftimePromptAckKey]);
  // Settings ref for usePitchSettings (avoids stale closures)
  const pitchSettingsRef = useRef({
    rotationSpeed,
    disablePositionSwaps,
    disableBatchSubs,
    rotateGkAtHalftime,
    minutesPerHalf,
    maxSpreadMinutes,
    teamSize,
    selectedFormation,
    showMatchHeader,
    showLineupPickerSetting: showLineupPickerSetting,
  });
  // Keep ref in sync
  pitchSettingsRef.current = {
    rotationSpeed,
    disablePositionSwaps,
    disableBatchSubs,
    rotateGkAtHalftime,
    minutesPerHalf,
    maxSpreadMinutes,
    teamSize,
    selectedFormation,
    showMatchHeader,
    showLineupPickerSetting: showLineupPickerSetting,
  };

  const {
    isSavingSettings,
    savedTeamDefaultsRef,
    persistTeamSizeToDb,
    persistFormationToDb,
    persistRotationSpeed,
    persistDisablePositionSwaps,
    persistDisableBatchSubs,
    persistRotateGkAtHalftime,
    persistMinutesPerHalf,
    persistMaxSpreadMinutes,
    persistShowLineupPicker,
    handleSaveSettings,
  } = usePitchSettings({
    teamId,
    readOnly,
    settingsRef: pitchSettingsRef,
  });

  // Initialize saved defaults ref with initial props
  if (!savedTeamDefaultsRef.current.formation) {
    savedTeamDefaultsRef.current = {
      minutesPerHalf: initialMinutesPerHalf,
      rotationSpeed: initialRotationSpeed,
      disablePositionSwaps: initialDisablePositionSwaps,
      disableBatchSubs: initialDisableBatchSubs,
      rotateGkAtHalftime: initialRotateGkAtHalftime,
      maxSpreadMinutes: initialMaxSpreadMinutes,
      teamSize: getInitialTeamSize(),
      formation: initialFormation || null,
    };
  }
  
  // Tactical mode state now lives in usePitchBoardTactical (declared below after handleFormationChange + ball state).

  
  // Mini-league team selector for formation/tactical changes
  const [selectedTeamForSettings, setSelectedTeamForSettings] = useState<"a" | "b" | "both">("both");

  // Step 9a — prop → state sync effects (7 effects + savedTeamDefaultsRef
  // refresh) now live in usePitchBoardPropSync.
  usePitchBoardPropSync({
    teamId,
    savedState,
    initialTeamSize,
    initialFormation,
    initialMinutesPerHalf,
    initialRotationSpeed,
    initialDisablePositionSwaps,
    initialDisableBatchSubs,
    initialRotateGkAtHalftime,
    initialMaxSpreadMinutes,
    gameInProgress,
    minutesPerHalf,
    setTeamSize,
    setSelectedFormation,
    setMinutesPerHalf,
    setRotationSpeed,
    setDisablePositionSwaps,
    setDisableBatchSubs,
    setRotateGkAtHalftime,
    setMaxSpreadMinutes,
    savedTeamDefaultsRef,
  });

  // Setting change handlers — update local state and persist via hook
  const handleRotationSpeedChange = useCallback(async (speed: number) => {
    setRotationSpeed(speed);
    await persistRotationSpeed(speed);
  }, [persistRotationSpeed]);

  const handleDisablePositionSwapsChange = useCallback(async (disabled: boolean) => {
    setDisablePositionSwaps(disabled);
    await persistDisablePositionSwaps(disabled);
  }, [persistDisablePositionSwaps]);

  const handleDisableBatchSubsChange = useCallback(async (disabled: boolean) => {
    setDisableBatchSubs(disabled);
    await persistDisableBatchSubs(disabled);
  }, [persistDisableBatchSubs]);

  const handleRotateGkAtHalftimeChange = useCallback(async (enabled: boolean) => {
    setRotateGkAtHalftime(enabled);
    await persistRotateGkAtHalftime(enabled);
  }, [persistRotateGkAtHalftime]);

  const handleMinutesPerHalfChange = useCallback(async (minutes: number) => {
    setMinutesPerHalf(minutes);
    await persistMinutesPerHalf(minutes);
  }, [persistMinutesPerHalf]);

  const handleMaxSpreadMinutesChange = useCallback(async (minutes: number) => {
    setMaxSpreadMinutes(minutes);
    await persistMaxSpreadMinutes(minutes);
  }, [persistMaxSpreadMinutes]);

  const handleShowLineupPickerSettingChange = useCallback(async (enabled: boolean) => {
    setShowLineupPickerSetting(enabled);
    await persistShowLineupPicker(enabled);
  }, [persistShowLineupPicker]);

  // handleLineupConfirm now lives in usePitchBoardLineup (declared at top).


  // handleLinkEvent now lives in usePitchBoardEventLink (top of component).



  const playersRef = useRef<Player[]>([]);
  const [benchCollapsed, setBenchCollapsed] = useState(true);
  
  // Swipe hint indicator state
  const [showSwipeHints, setShowSwipeHints] = useState(false);
  
  // Draggable floating subs button state
  const [floatingSubsPosition, setFloatingSubsPosition] = useState({ x: 16, y: 16 }); // bottom-left offset
  const floatingSubsDragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  
  // Draggable + resizable floating timer (landscape & portrait)
  const {
    floatingTimerPosition,
    floatingTimerScale,
    handleTimerDragStart,
    handleTimerTouchStart,
    portraitTimerPosition,
    portraitTimerScale,
    handlePortraitTimerTouchStart,
  } = useDraggableTimer();

  // Swipe gestures for bench in landscape mode
  const benchSwipeHandlers = useSwipeGesture({
    onSwipeLeft: () => setBenchCollapsed(true),
    onSwipeRight: () => setBenchCollapsed(false),
    threshold: 40,
  });
  
  // Auto-collapse toolbar and bench when switching to mobile landscape, show swipe hints
  useEffect(() => {
    if (isMobileLandscape) {
      setToolbarCollapsed(true);
      setBenchCollapsed(true);
      // Show swipe hints briefly when entering landscape
      setShowSwipeHints(true);
      const timer = setTimeout(() => setShowSwipeHints(false), 2500);
      return () => clearTimeout(timer);
    }
  }, [isMobileLandscape]);
  // Create database notification which triggers server-side push via database trigger
  const createSubNotification = useCallback(async (message: string) => {
    if (!user?.id) return;
    if (!pitchBoardNotificationsEnabled) return; // Check preference
    try {
      const { error } = await supabase
        .from('notifications')
        .insert({
          user_id: user.id,
          type: 'substitution',
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

  // Open auto-sub plan dialog with minutes from pitch settings
  const openAutoSubPlanDialog = useCallback((editMode?: boolean) => {
    const isFinished = gameTimerRef.current?.isGameFinished();
    const isRunning = gameTimerRef.current?.isRunning();
    const elapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
    // Only block new plans if game is truly finished (was started and completed)
    if (!editMode && isFinished && elapsed > 0 && !isRunning) {
      toast({ title: "Game has finished", description: "Auto-sub plans can only be created during an active game" });
      return;
    }
    setAutoSubPlanEditMode(editMode === true);
    setAutoSubFromPreGame(false);
    setAutoSubPlanDialogOpen(true);
  }, [toast]);

  const handleOpenNewPlan = useCallback(() => openAutoSubPlanDialog(false), [openAutoSubPlanDialog]);
  const handleOpenEditPlan = useCallback(() => openAutoSubPlanDialog(true), [openAutoSubPlanDialog]);

  // Fetch team player positions from database with caching
  const { data: teamPlayerPositions } = useQuery({
    queryKey: ["team-player-positions", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_player_positions")
        .select("*")
        .eq("team_id", teamId);
      if (error) throw error;
      return data || [];
    },
    staleTime: 30 * 1000, // Refetch after 30s to pick up jersey/position changes
    gcTime: 10 * 60 * 1000,
  });

  // linkedEventDetails, opponentName, and the 24h auto-unlink effect now live
  // in usePitchBoardEventLink (top of component).


  // Goal handlers
  const handleAddGoal = useCallback((goal: Goal) => {
    setGoals(prev => [...prev, goal]);
    // Auto-collapse score in portrait mode after adding a goal
    if (!isLandscape) {
      setShowScoreInPortrait(false);
    }
  }, [isLandscape]);

  const handleRemoveGoal = useCallback((goalId: string) => {
    setGoals(prev => prev.filter(g => g.id !== goalId));
  }, []);

  const handleUpdateGoal = useCallback((updatedGoal: Goal) => {
    setGoals(prev => prev.map(g => g.id === updatedGoal.id ? updatedGoal : g));
  }, []);

  const { data: goingAttendeeIds } = useEventGoingAttendees(linkedEventId);
  const {
    realPlayers,
    savedStateIsForDifferentEvent,
    savedPlayers,
    savedAutoSubPlan,
    isStrictMatchEventRoster,
    savedRosterMissingCurrentPlayers,
    savedRosterHasPlayersOutsideCurrentRoster,
    savedRosterHasNoPlayersOnPitch,
    applyStrictMatchRoster,
    hasSamePlayerOrder,
    shouldRebuildFromRealRoster,
  } = usePitchBoardRosterReconciliation({
    members,
    teamPlayerPositions,
    goingAttendeeIds,
    linkedEventId,
    initialLinkedEventId,
    savedState,
    miniLeagueTeams,
  });

  const {
    autoPlacePlayersOnPitch,
    autoPlaceMiniLeaguePlayers,
  } = usePitchBoardPlayerPlacement();

  // Initialize players - check localStorage first to preserve positions across navigation
  // IMPORTANT: Always prefer saved state when it exists, regardless of whether players have positions
  // This ensures players stay where they were placed even if game is not running
  // For mini-league mode, auto-place both teams on the pitch
  const [players, setPlayers] = useState<Player[]>(() => {
    console.log("[PitchState] useState init - savedState:", savedState ? "exists" : "null", "realPlayers count:", realPlayers.length);
    if (shouldRebuildFromRealRoster) {
      console.log("[PitchState] useState init - rebuilding stale saved roster from live team members");
      return miniLeagueTeams
        ? autoPlaceMiniLeaguePlayers(realPlayers, getInitialTeamSize())
        : autoPlacePlayersOnPitch(realPlayers, getInitialTeamSize(), getInitialFormationIndex(getInitialTeamSize()));
    }
    if (savedPlayers.length > 0) {
      console.log("[PitchState] useState init - using saved players", savedStateIsForDifferentEvent ? "(fill-ins stripped: different event)" : "");
      // For mini-league mode, we need to check if saved state has proper two-team layout
      // If Team B players are not on the top half (y < 50), re-place all players
      if (miniLeagueTeams) {
        // Apply teamSide to saved players first
        const playersWithTeamSide = savedPlayers.map(p => {
          let teamSide: "a" | "b" | undefined;
          if (miniLeagueTeams.teamAPlayerIds.includes(p.id)) {
            teamSide = "a";
          } else if (miniLeagueTeams.teamBPlayerIds.includes(p.id)) {
            teamSide = "b";
          }
          return { ...p, teamSide };
        });
        
        // Check if teams are correctly positioned (Team A bottom half, Team B top half)
        const teamAOnPitch = playersWithTeamSide.filter(p => p.teamSide === "a" && p.position);
        const teamBOnPitch = playersWithTeamSide.filter(p => p.teamSide === "b" && p.position);
        const teamACorrectlyPositioned = teamAOnPitch.length === 0 || teamAOnPitch.every(p => p.position!.y >= 50);
        const teamBCorrectlyPositioned = teamBOnPitch.length === 0 || teamBOnPitch.every(p => p.position!.y < 50);
        
        if ((!teamACorrectlyPositioned || !teamBCorrectlyPositioned) && (teamAOnPitch.length > 0 || teamBOnPitch.length > 0)) {
          console.log("[PitchState] Re-placing players for proper two-team half-pitch layout");
          // Saved state doesn't have correct two-team layout - re-place all players
          return autoPlaceMiniLeaguePlayers(playersWithTeamSide, getInitialTeamSize());
        }
        
        return playersWithTeamSide;
      }
      // NOTE: Player minute catchup removed — handleTimerUpdate is the single
      // source of truth for minute tracking. The catchup here was adding minutes
      // that handleTimerUpdate would ALSO add via its delta calculation, causing
      // double-counted player minutes (e.g. showing 15 min at 7 min game time).
      return applyStrictMatchRoster(savedPlayers);
    }
    if (savedState && !savedState.mockMode && realPlayers.length > 0) {
      console.log("[PitchState] useState init - ignoring stale empty saved state and using real players");
      return miniLeagueTeams
        ? autoPlaceMiniLeaguePlayers(realPlayers, getInitialTeamSize())
        : autoPlacePlayersOnPitch(realPlayers, getInitialTeamSize(), getInitialFormationIndex(getInitialTeamSize()));
    }
    // For mini-league mode, auto-place players on both halves
    if (miniLeagueTeams) {
      console.log("[PitchState] useState init - using miniLeagueTeams mode");
      return autoPlaceMiniLeaguePlayers(realPlayers, getInitialTeamSize());
    }
    console.log("[PitchState] useState init - using realPlayers as fallback");
    return realPlayers;
  });
  const {
    undoHistory,
    showFloatingUndo,
    isUndoingRef,
    pushToUndoHistory,
    handleUndo,
  } = usePitchBoardUndo({
    isLandscape,
    setPlayers,
    toast,
  });

  // Keep playersRef in sync with players state (for use in effects with stale closures)
  playersRef.current = players;
  // Player drag/drop is owned by usePitchBoardDragDrop. We declare it here
  // (before the rest of the component reads its state/refs) but pass deps via
  // a ref that is reassigned further down — same pattern as
  // usePitchBoardFormationChangeDialog / usePitchBoardLineup.
  const dragDropDepsRef = useRef<DragDropDeps>({} as DragDropDeps);
  const {
    draggedPlayer,
    touchDragPlayer,
    touchOffset,
    setTouchDragPlayer,
    setTouchOffset,
    touchIdRef,
    playerDragOffsetRef,
    playerDragStartRef,
    recentlyDraggedRef,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handlePitchDrop,
    handleBenchDrop,
    handleTouchStart,
    applyPitchTouchMove,
    finalizePitchTouchEnd,
    handleBenchTouchMove,
    handleBenchTouchEnd,
  } = usePitchBoardDragDrop(dragDropDepsRef);




  // Zoom state
  const {
    zoom,
    setZoom,
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
    handleWheel,
    tryPinchStart,
    tryPinchMove,
    tryPinchEnd,
    pitchZoomScrollRef,
  } = usePitchBoardPinchZoom();

  // Ball state + drag/touch handlers live in usePitchBoardBall
  const {
    ballPosition,
    setBallPosition,
    isDraggingBall,
    recentlyDraggedBallRef,
    handleBallDragStart,
    handleBallDrag,
    handleBallDragEnd,
    handleBallTouchStart,
    handleBallTouchMove,
    handleBallTouchEnd,
  } = usePitchBoardBall({
    containerRef,
    initialBallPosition: savedState?.ballPosition,
  });

  // Helper to get team color for a player in mini-league mode
  const getPlayerTeamColor = useCallback((player: Player): string | undefined => {
    if (!miniLeagueTeams || !player.teamSide) return undefined;
    return player.teamSide === "a" ? miniLeagueTeams.teamAColor : miniLeagueTeams.teamBColor;
  }, [miniLeagueTeams]);

  // Substitution feedback effects are isolated from the selection flow.
  const {
    subAnimationPlayers,
    swapFlashIds,
    flashSwapFeedback,
    runSubAnimation,
  } = usePitchBoardSubAnimation();

  // Refs for deferred dependencies (defined later, but used inside hook callbacks)
  const pushToUndoHistoryRef_autoSubs = useRef<((description: string, snapshot: Player[]) => void) | null>(null);
  const runSubAnimationRef_autoSubs = useRef<((playerOutId: string, playerInId: string, swapPlayerId?: string) => void) | null>(null);

  // ── Auto-sub hook (centralizes plan state & handlers) ──
  const {
    autoSubPlan, setAutoSubPlan,
    autoSubActive, setAutoSubActive,
    autoSubPaused, setAutoSubPaused,
    lockedPlayerIds,
    pendingAutoSub, setPendingAutoSub,
    pendingBatchSubs, setPendingBatchSubs,
    subConfirmDialogOpen, setSubConfirmDialogOpen,
    subDuePlayerIds, setSubDuePlayerIds,
    nextSubInfo,
    subDueTimerRef,
    handleStartAutoSubPlan,
    handleCancelAutoSubPlan,
    handleTogglePauseAutoSub,
    handleToggleLockPlayer,
    handleSkipNextSub,
    handleExecuteNow,
    handleRegeneratePlan,
    regeneratePlanRef,
    handleConfirmAutoSub,
    handleSkipAutoSub,
    checkForDueSubs,
    updateNextSubInfo,
    checkHalftimeSubs,
    skipCooldownRef,
  } = useAutoSubs({
    initialPlan: savedAutoSubPlan,
    initialActive: savedState?.autoSubActive || false,
    initialPaused: savedState?.autoSubPaused || false,
    gameTimerRef,
    playersRef,
    setPlayers,
    teamSize,
    halftimePromptAckKey,
    rotateGkAtHalftime,
    pushToUndoHistoryRef: pushToUndoHistoryRef_autoSubs,
    runSubAnimationRef: runSubAnimationRef_autoSubs,
  });

  // manualSubConfirmOpen + pendingManualSub now live in usePitchBoardManualSub (declared below).

  // Swap-mode state must be declared before selection derives compatible targets.
  const [swapMode, setSwapMode] = useState(false);
  const [swapPlayer1, setSwapPlayer1] = useState<string | null>(null);
  const [swapPlayer2, setSwapPlayer2] = useState<string | null>(null);
  const [pitchSwapConfirmOpen, setPitchSwapConfirmOpen] = useState(false);

  // Step 8a — substitution selection state + derived sets
  const {
    subMode,
    setSubMode,
    selectedOnPitch,
    setSelectedOnPitch,
    selectedOnBench,
    setSelectedOnBench,
    getValidBenchPlayerIds,
    getValidSwapPlayerIds,
    movablePitchPlayerIds,
  } = usePitchBoardSubSelection({
    players,
    swapMode,
    swapPlayer1,
    miniLeagueTeams,
  });
  const {
    handlePlayerClick,
    toggleSwapMode,
    handleConfirmPitchSwap,
    handleCancelPitchSwap,
    handleConfirmPitchSwapWithAccommodation,
    toggleSubMode,
  } = usePitchBoardSwapMode({
    readOnly,
    swapMode,
    setSwapMode,
    swapPlayer1,
    setSwapPlayer1,
    swapPlayer2,
    setSwapPlayer2,
    pitchSwapConfirmOpen,
    setPitchSwapConfirmOpen,
    players,
    playersRef,
    miniLeagueTeams,
    subMode,
    setSubMode,
    selectedOnPitch,
    setSelectedOnPitch,
    setSelectedOnBench,
    getValidSwapPlayerIds,
    setPlayers,
    pushToUndoHistory,
    autoSubActive,
    regeneratePlanRef,
    toast,
    setDrawingTool,
    setShowFloatingDrawToolbar,
    setPortraitSheetOpen,
    setBenchCollapsed,
    isLandscape,
    setSheetHeightPct,
    setToolbarCollapsed,
    setBottomSheetTab,
  });




  // Step 8c — Bench-to-pitch quick substitution sheet state
  const {
    benchToSubOpen,
    setBenchToSubOpen,
    benchToSubPlayer,
    setBenchToSubPlayer,
  } = usePitchBoardBenchToSub();
  const {
    benchDragPlayer,
    benchDragPos,
    benchLongPressTimer,
    handleBenchLongPressStart,
    handleBenchLongPressMove,
    handleBenchLongPressEnd,
  } = usePitchBoardBenchLongPress({
    readOnly,
    subMode,
    swapMode,
    setBenchToSubPlayer,
    setBenchToSubOpen,
    setPortraitSheetOpen,
    setToolbarCollapsed,
  });

  // Step 8b — manual-sub confirm dialog flow (state + handlers + trigger effect)
  const {
    manualSubConfirmOpen,
    setManualSubConfirmOpen,
    pendingManualSub,
    setPendingManualSub,
    handleConfirmManualSub,
    handleCancelManualSub,
    handleBenchToSubSelect,
    manualSubDepsRef,
  } = usePitchBoardManualSub();
  const {
    pendingSwapBasedSub,
    swapBeforeSubDialogOpen,
    subAfterSwapDialogOpen,
    handleSwapAndSubstitute,
    handleSubPreviewSelect,
    handlePreSwapFromDialog,
    handleConfirmSwapBeforeSub,
    handleCancelSwapBasedSub,
    handleConfirmSubAfterSwap,
  } = usePitchBoardSwapSubstitution({
    players,
    playersRef,
    playerDragStartRef,
    pendingSubBenchPlayer,
    requiredPosition,
    selectedOnPitch,
    setPlayers,
    setPendingSubBenchPlayer,
    setRequiredPosition,
    setPositionSwapDialogOpen,
    setSubPreviewOpen,
    setSelectedOnPitch,
    setSelectedOnBench,
    setSubMode,
    setPendingManualSub,
    setManualSubConfirmOpen,
    pushToUndoHistory,
    runSubAnimation,
    toast,
  });
  const [resetGameConfirmOpen, setResetGameConfirmOpen] = useState(false);
  const [cancelPlanConfirmOpen, setCancelPlanConfirmOpen] = useState(false);
  const [timerFormationDropdownOpen, setTimerFormationDropdownOpen] = useState(false);
  const [timerTacticalDropdownOpen, setTimerTacticalDropdownOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  // fillInDialogOpen state lives in usePitchBoardFillIn (declared below).
  const [autoSubPanelOpen, setAutoSubPanelOpen] = useState(false);
  const [pitchPlayerActionOpen, setPitchPlayerActionOpen] = useState(false);
  const [pitchPlayerActionTarget, setPitchPlayerActionTarget] = useState<string | null>(null);
  const [benchInjuryConfirmOpen, setBenchInjuryConfirmOpen] = useState(false);
  const [benchInjuryTarget, setBenchInjuryTarget] = useState<string | null>(null);
  const lastTapRef = useRef<{ playerId: string; time: number } | null>(null);
  const touchHandledRef = useRef(false);

  // Mock player mode state
  const [mockMode, setMockMode] = useState(() => savedState?.mockMode || false);

  usePitchBoardLiveRosterSync({
    realPlayers,
    players,
    mockMode,
    savedState,
    teamId,
    teamSize,
    selectedFormation,
    miniLeagueTeams,
    shouldRebuildFromRealRoster,
    savedPlayers,
    savedRosterMissingCurrentPlayers,
    savedRosterHasNoPlayersOnPitch,
    isStrictMatchEventRoster,
    applyStrictMatchRoster,
    hasSamePlayerOrder,
    autoPlacePlayersOnPitch,
    autoPlaceMiniLeaguePlayers,
    setPlayers,
  });

  // Shared-session fill-in sync moved into usePitchBoardFillIn (below).

  // Match stats panel state
  const [statsOpen, setStatsOpen] = useState(false);
  const [elapsedGameTime, setElapsedGameTime] = useState(0);

  // Keep the screen awake while the pitch board is open so iOS / Android
  // don't auto-lock mid-game and tear down the WebView (which causes a
  // 4-5s "Loading your profile..." reload when the user returns).
  useWakeLock(true);

  // Step 9e — open-flag/context lifecycle + expired-sub toast + auto-reset.
  const { autoResetDoneRef, shouldAutoReset } = usePitchBoardLifecycle({
    teamId,
    teamName,
    readOnly,
    subConfirmDialogOpen,
    toast,
  });

  // Step 9d — player bootstrap (saved-state merge / fresh auto-place).
  const { hasLoadedRef } = usePitchBoardPlayerBootstrap({
    savedState,
    realPlayers,
    teamId,
    teamSize,
    selectedFormation,
    miniLeagueTeams,
    isStrictMatchEventRoster,
    savedRosterHasPlayersOutsideCurrentRoster,
    applyStrictMatchRoster,
    autoPlacePlayersOnPitch,
    autoPlaceMiniLeaguePlayers,
    setPlayers,
    setHasInitialized,
  });

  // handleLineupSkip now lives in usePitchBoardLineup (declared at top).

  // Step 9c — persistence (localStorage debounced save + active_games auto-sub mirror)
  usePitchBoardPersistence({
    hasInitialized,
    teamId,
    userId: user?.id,
    players,
    teamSize,
    selectedFormation,
    ballPosition,
    autoSubPlan,
    autoSubActive,
    autoSubPaused,
    mockMode,
    linkedEventId,
    goals,
    isEventGroup,
    forceEventGroupSync,
    touchDragPlayer,
    draggedPlayer,
    readOnly,
  });



  const { handleUpdatePositions, handleMockModeChange } = usePitchBoardMockPlayers({
    teamPlayerPositions,
    teamSize,
    selectedFormation,
    members,
    mockMode,
    setMockMode,
    setPlayers,
    hasLoadedRef,
    setHasInitialized,
    autoPlacePlayersOnPitch,
  });

  // Arrow drawing state (refs owned by usePitchBoardDrawing below)

  const {
    savedFormations,
    loadingFormations,
    saveFormationMutation,
    deleteFormationMutation,
    loadFormation,
    handleSaveFormation,
  } = usePitchBoardFormationLibrary({
    teamId,
    teamSize,
    players,
    fabricCanvas,
    saveDialogOpen,
    loadDialogOpen,
    formationName,
    userId: user?.id,
    supabaseClient: supabase,
    setTeamSize,
    setPlayers,
    setSaveDialogOpen,
    setLoadDialogOpen,
    setFormationName,
  });

  // Step 9f — drawing/arrow lifecycle (refs, overlay-disable, arrow handlers, pen mode, clear).
  const {
    drawingToolRef,
    isDrawingArrowRef,
    createArrow,
    clearDrawings,
  } = usePitchBoardDrawing({
    drawingTool,
    setDrawingTool,
    drawingColor,
    setShowFloatingDrawToolbar,
    settingsMenuOpen,
    portraitSheetOpen,
    settingsDialogOpen,
    autoSubPanelOpen,
    toolbarCollapsed,
    fabricCanvas,
    fabricModule,
  });
  void createArrow; // currently unused outside the hook — keep handle for future external triggers

  // handleFormationChange now lives in usePitchBoardLineup (declared at top).

  const {
    tacticalMode,
    setTacticalMode,
    tacticalFormationSuggestion,
    setTacticalFormationSuggestion,
    handleTacticalModeChange,
    handleApplyTacticalSuggestion,
    handleDismissTacticalSuggestion,
    tacticalOffsets,
    ballOffset,
  } = usePitchBoardTactical({
    players,
    teamSize,
    selectedFormation,
    miniLeagueTeams,
    ballPosition,
    isDraggingBall,
    recentlyDraggedBallRef,
    handleFormationChange,
    setToolbarCollapsed,
    setPortraitSheetOpen,
  });

  // Send push notification to team coaches/admins and Subs Manager assignees when formation or team size changes
  const notifyFormationOrSizeChange = useCallback(async (
    changeType: 'formation' | 'team_size', 
    detail: string,
    changeDetails?: {
      positionSwaps: { player: Player; fromPosition: PitchPosition; toPosition: PitchPosition; fromX?: number; toX?: number }[];
      benchMoves: { player: Player; direction: "to-pitch" | "to-bench"; position?: PitchPosition }[];
    }
  ) => {
    // Notify whenever formation changes (during setup or active game), skip only for read-only or finished games
    if (!user?.id || readOnly || gameTimerRef.current?.isGameFinished()) return;
    try {
      const recipientIds = new Set<string>();
      // Always include the current user so they get a record of the change
      recipientIds.add(user.id);
      const isEventGroup = teamId.startsWith("event-group-");

      if (isEventGroup) {
        // Mini-league: notify Referee + Subs Manager of this specific match
        const groupId = teamId.replace("event-group-", "");
        const { data: matchDuties } = await supabase
          .from("event_group_duties")
          .select("assigned_to")
          .eq("group_id", groupId)
          .in("name", ["Referee", "Subs Manager"])
          .not("assigned_to", "is", null);
        matchDuties?.forEach(d => {
          if (d.assigned_to) recipientIds.add(d.assigned_to);
        });
      } else {
        // Regular team: notify coaches/admins
        const { data: staffRoles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("team_id", teamId)
          .in("role", ["coach", "team_admin"]);
        
        staffRoles?.forEach(r => {
          if (r.user_id) recipientIds.add(r.user_id);
        });

        // Also include Subs Manager assignees for regular events
        if (linkedEventId) {
          const { data: subsManagers } = await supabase
            .from("duties")
            .select("assigned_to")
            .eq("event_id", linkedEventId)
            .eq("name", "Subs Manager")
            .not("assigned_to", "is", null);
          subsManagers?.forEach(d => {
            if (d.assigned_to) recipientIds.add(d.assigned_to);
          });
        }
      }

      // Build detailed change description for notification body
      const changeParts: string[] = [];
      if (changeDetails) {
        const benchExits = changeDetails.benchMoves.filter(m => m.direction === "to-bench");
        const pitchEntries = changeDetails.benchMoves.filter(m => m.direction === "to-pitch");
        const swaps = changeDetails.positionSwaps;
        
        if (benchExits.length > 0) {
          changeParts.push(`📤 Off: ${benchExits.map(m => m.player.name).join(", ")}`);
        }
        if (pitchEntries.length > 0) {
          changeParts.push(`📥 On: ${pitchEntries.map(m => `${m.player.name} (${m.position || ""})`).join(", ")}`);
        }
        if (swaps.length > 0) {
          changeParts.push(`🔄 Moved: ${swaps.map(s => `${s.player.name} ${s.fromPosition}→${s.toPosition}`).join(", ")}`);
        }
      }

      const title = changeType === 'formation' 
        ? `⚽ ${teamName} - Formation Changed`
        : `⚽ ${teamName} - Team Size Changed`;
      const baseSummary = changeType === 'formation'
        ? `Formation changed to ${detail}`
        : `Team size changed to ${detail} players`;
      const body = changeParts.length > 0 
        ? `${baseSummary}\n${changeParts.join("\n")}`
        : baseSummary;

      // Create in-app notifications with details via SECURITY DEFINER RPC
      // (direct inserts fail RLS when the current user isn't a coach/admin in the same team)
      const notificationMessage = changeParts.length > 0
        ? `${baseSummary} — ${changeParts.join(" • ")}`
        : baseSummary;

      const recipientArray = Array.from(recipientIds);
      if (recipientArray.length > 0) {
        console.log("[Formation notify] Sending to", recipientArray.length, "recipients, teamId:", teamId);
        const { error: rpcError } = await supabase.rpc("notify_formation_change", {
          _recipient_ids: recipientArray,
          _message: notificationMessage,
          _related_id: teamId,
        });
        if (rpcError) {
          console.error("Formation notification RPC error:", JSON.stringify(rpcError));
        } else {
          console.log("[Formation notify] RPC success — notifications inserted");
        }
      } else {
        console.warn("[Formation notify] No recipients found");
      }
    } catch (e) {
      console.error("Failed to send formation change notification:", e);
    }
  }, [user?.id, teamId, teamName, readOnly, linkedEventId]);

  // applyFormationChange now lives in usePitchBoardLineup (declared at top).

  // Keep the formation-dialog hook's dependency ref in sync each render so its
  // confirm handler can call into late-defined functions like
  // applyFormationChange / notifyFormationOrSizeChange.
  formationDialogDepsRef.current = {
    players,
    setPlayers,
    setTeamSize,
    setSelectedFormation,
    autoPlacePlayersOnPitch,
    persistTeamSizeToDb,
    notifyFormationOrSizeChange,
    applyFormationChange,
    setToolbarCollapsed,
    setPortraitSheetOpen,
    autoSubActive,
    regeneratePlanRef,
    toast,
  };

  // Keep lineup hook's dep ref synced each render.
  lineupDepsRef.current = {
    players,
    teamSize,
    selectedFormation,
    miniLeagueTeams,
    autoSubActive,
    selectedTeamForSettings,
    setPlayers,
    setSelectedFormation,
    setPreferredSecondHalfGkId,
    setAutoSubPlanEditMode,
    setAutoSubFromPreGame,
    setAutoSubPlanDialogOpen,
    setShowLineupPicker,
    setPendingFormationChange,
    setFormationChangeDialogOpen,
    autoPlacePlayersOnPitch,
    autoPlaceMiniLeaguePlayers,
    persistFormationToDb,
    notifyFormationOrSizeChange,
    regeneratePlanRef,
    toast,
  };

  // Keep manual-sub hook's dep ref synced each render.
  manualSubDepsRef.current = {
    isUndoingRef,
    playersRef,
    subMode,
    selectedOnPitch,
    selectedOnBench,
    players,
    benchToSubPlayer,
    setPlayers,
    setSelectedOnPitch,
    setSelectedOnBench,
    setSubMode,
    setPendingSubBenchPlayer,
    setRequiredPosition,
    setPositionSwapDialogOpen,
    setBenchToSubOpen,
    runSubAnimation,
    pushToUndoHistory,
    toast,
  };


  // Preview, incompatible-position, and swap-then-substitution flows are
  // coordinated by usePitchBoardSwapSubstitution.
  // Keep refs in sync for the auto-sub hook
  pushToUndoHistoryRef_autoSubs.current = pushToUndoHistory;
  runSubAnimationRef_autoSubs.current = runSubAnimation;

  // Forward setters/callbacks into the timer hook (declared at the top of
  // the component, before these values exist).
  setPlayersRef.current = setPlayers;
  minutesPerHalfRef.current = minutesPerHalf;
  setElapsedGameTimeRef.current = setElapsedGameTime;
  updateNextSubInfoRef_timer.current = updateNextSubInfo;
  checkForDueSubsRef_timer.current = checkForDueSubs;

  // Half change callback - check for halftime subs (including batch)
  const handleHalfChange = useCallback((newHalf: 1 | 2, source: 'live' | 'reconcile' = 'live') => {
    // Guard: if the timer was reconciled on resume/cold-open and we're already
    // well into the 2nd half, the half-change callback can still fire as part
    // of the catch-up. In that case the user has already played past halftime
    // and should not see a stale "Half Time!" dialog they have to dismiss.
    if (newHalf === 2) {
      const elapsedInHalf2 = gameTimerRef.current?.getElapsedSeconds?.() ?? 0;
      if (elapsedInHalf2 > 30 || hasAcknowledgedHalftimePrompt(halftimePromptAckKey)) {
        return;
      }
    }

    // Delegate auto-sub halftime checks to the hook
    if (checkHalftimeSubs(newHalf)) return;

    // Case 2: No auto-sub plan, but a preferred 2nd half GK was selected — prompt GK swap
    if (newHalf === 2 && preferredSecondHalfGkId) {
      const currentGk = players.find(p => p.currentPitchPosition === "GK" && p.position !== null);
      const secondHalfGk = players.find(p => p.id === preferredSecondHalfGkId);
      
      if (currentGk && secondHalfGk && currentGk.id !== secondHalfGk.id) {
        const gkSwapEvent: SubstitutionEvent = {
          time: 0,
          half: 2,
          playerOut: currentGk,
          playerIn: secondHalfGk,
          executed: false,
        };
        
        setTimeout(() => {
          if (!canShowHalftimePrompt(loadTimerStateForMinutes(teamId), savedState)) return;
          const notificationBody = `Halftime GK swap: ${currentGk.name} ➜ ${secondHalfGk.name}`;
          playSubAlertBeep(notificationBody);
          setPendingAutoSub(gkSwapEvent);
          setPendingBatchSubs([]);
          setSubConfirmDialogOpen(true);
        }, 500);
        return;
      }
    }

    // Case 3: No subs and no GK swap — only show the informational halftime
    // dialog on a LIVE boundary crossing. On reconcile (cold-open / resume),
    // the user has typically already seen the push and there is nothing
    // actionable to confirm, so skip the empty prompt.
    if (newHalf === 2 && source === 'live') {
      setTimeout(() => {
        if (!canShowHalftimePrompt(loadTimerStateForMinutes(teamId), savedState)) return;
        playSubAlertBeep("Half Time!");
        setPendingAutoSub(null);
        setPendingBatchSubs([]);
        setSubConfirmDialogOpen(true);
      }, 500);
    }
  }, [checkHalftimeSubs, halftimePromptAckKey, preferredSecondHalfGkId, players, savedState, setPendingAutoSub, setPendingBatchSubs, setSubConfirmDialogOpen, teamId]);

  // Ball drag/touch handlers now live in usePitchBoardBall (top of component).






  const handleUnlinkEvent = usePitchBoardUnlinkEvent({
    teamId,
    userId: user?.id,
    players,
    teamSize,
    selectedFormation,
    ballPosition,
    autoSubPlan,
    autoSubActive,
    autoSubPaused,
    mockMode,
    goals,
    setLinkedEventId,
    onUnlinkEvent,
    invalidateTeamActiveGame: () => {
      queryClient.invalidateQueries({ queryKey: ["team-active-game", teamId] });
    },
    notifyUnlinked: () => {
      toast({
        title: "Game Unlinked",
        description: "This board is no longer linked to the match.",
      });
    },
  });

  const handleResetGame = usePitchBoardResetGame({
    teamId,
    players,
    gameTimerRef,
    savedTeamDefaultsRef,
    hasLoadedRef,
    autoPlacePlayersOnPitch,
    setMinutesPerHalf,
    setRotationSpeed,
    setDisablePositionSwaps,
    setDisableBatchSubs,
    setRotateGkAtHalftime,
    setMaxSpreadMinutes,
    setTeamSize,
    setSelectedFormation,
    setPlayers,
    setAutoSubPlan,
    setAutoSubActive,
    setAutoSubPaused,
    setSubMode,
    setSelectedOnPitch,
    setSelectedOnBench,
    setGameInProgress,
    setTimerResetKey,
    notifyReset: () => {
      toast({
        title: "Game Reset",
        description: "All player minutes and settings have been reset to defaults.",
      });
    },
  });

  // Helper: if the game is at full time, reset the clock before showing the
  // lineup picker — but never wipe the coach's positions or auto-sub plan, so
  // re-opening Set up game shows the current lineup rather than team defaults.
  const handleSetupGame = useCallback(() => {
    if (gameTimerRef.current?.isGameFinished()) {
      handleResetGame(true, { preserveLineup: true });
    }
    setShowLineupPicker(true);
  }, [handleResetGame]);


  // Execute deferred auto-reset after handleResetGame is available
  useEffect(() => {
    if (shouldAutoReset.current) {
      shouldAutoReset.current = false;
      handleResetGame();
    }
  }, [handleResetGame]);

  const { handleResetFormation, handleTeamSizeChange } =
    usePitchBoardFormationManagement({
      players,
      teamSize,
      selectedFormation,
      miniLeagueTeams,
      autoPlacePlayersOnPitch,
      autoPlaceMiniLeaguePlayers,
      persistTeamSizeToDb,
      setPlayers,
      setTeamSize,
      setSelectedFormation,
      setBallPosition,
      setPendingFormationChange,
      setFormationChangeDialogOpen,
      toast,
    });

  const {
    capturePlayerDragOffset,
    getClientPitchPosition,
    getClientPointFromPitchPosition,
    getPitchPlayerOverlappingDragged,
    updateDraggedPlayerPosition,
    swapPitchPlayers,
  } = usePitchBoardPitchGeometry({
    containerRef,
    playersRef,
    playerDragOffsetRef,
    playerDragStartRef,
    miniLeagueTeams,
    selectedTeamForSettings,
    teamSize,
    setPlayers,
    pushToUndoHistory,
    flashSwapFeedback,
  });

  const handlePitchTouchStart = (e: React.TouchEvent) => {
    // Don't handle if drawing tool is active
    if (drawingTool !== "none") return;

    // Pinch zoom (2 fingers) - zoom without moving pitch
    if (tryPinchStart(e)) return;
  };

  const handlePitchTouchMove = (e: React.TouchEvent) => {
    // Don't handle if drawing tool is active
    if (drawingTool !== "none") return;

    // Pinch zoom (2 fingers) — consumed by the hook
    if (tryPinchMove(e)) return;

    // Player touch-drag (1 finger) — owned by usePitchBoardDragDrop.
    applyPitchTouchMove(e);
  };

  const handlePitchTouchEnd = (e: React.TouchEvent) => {
    // Pinch end first — clears the pinch baseline if fingers lifted.
    tryPinchEnd(e);
    // Then finalise any in-flight player touch-drag (bench→pitch, swap, drop).
    finalizePitchTouchEnd(e);
  };




  // Drag/drop dependency wiring moved below playersOnPitch/playersOnBench
  // definitions (TDZ avoidance). See the assignment after those `useMemo`s.



  // Memoize derived player lists to prevent recalculation on every render
  const playersOnPitch = useMemo(() => players.filter(p => p.position !== null), [players]);
  const playersOnBench = useMemo(() => players.filter(p => p.position === null), [players]);

  // Wire the drag/drop hook's deps each render — the hook owns the handlers
  // (declared near the top of this component); we just point it at the
  // freshest helpers/state each render so identities stay stable while
  // closures see live values.
  dragDropDepsRef.current = {
    readOnly,
    players,
    playersOnPitch,
    playersRef,
    containerRef,
    capturePlayerDragOffset,
    getClientPitchPosition,
    getClientPointFromPitchPosition,
    getPitchPlayerOverlappingDragged,
    updateDraggedPlayerPosition,
    swapPitchPlayers,
    setBenchToSubPlayer,
    setBenchToSubOpen,
    setPortraitSheetOpen,
    setToolbarCollapsed,
    setSelectedOnPitch,
    setSubPreviewOpen,
  };

  // Plan repair: signature-based regen + orphan cancel + injury recalculator.
  const { recalcPlanForInjury } = usePitchBoardPlanRepair({
    players,
    playersOnPitch,
    playersRef,
    autoSubActive,
    autoSubPlan,
    setAutoSubPlan,
    regeneratePlanRef,
    handleCancelAutoSubPlan,
    gameTimerRef,
    teamSize,
    rotateGkAtHalftime,
    toast,
  });


  // Filtered on-pitch players for mini-league team selector (hides the other team)
  const filteredPlayersOnPitch = useMemo(() => {
    if (!miniLeagueTeams || selectedTeamForSettings === "both") return playersOnPitch;
    return playersOnPitch.filter(p => p.teamSide === selectedTeamForSettings);
  }, [playersOnPitch, miniLeagueTeams, selectedTeamForSettings]);

  // tacticalOffsets + ballOffset now live in usePitchBoardTactical (declared above).

  // getValidBenchPlayerIds + getValidSwapPlayerIds now live in usePitchBoardSubSelection.



  const { togglePlayerInjury, handleMarkInjuredOnPitch } = usePitchBoardInjuries({
    readOnly,
    players,
    setPlayers,
    pushToUndoHistory,
    recalcPlanForInjury,
    toast,
  });



  // Fill-in player state + handlers (add/remove, remote sync, dialog open, jersey numbers).
  const {
    fillInDialogOpen,
    setFillInDialogOpen,
    handleAddFillInPlayer,
    handleRemoveFillInPlayer,
    existingJerseyNumbers,
  } = usePitchBoardFillIn({
    readOnly,
    teamId,
    players,
    setPlayers,
    autoSubPlan,
    setAutoSubPlan,
    autoSubActive,
    handleCancelAutoSubPlan,
    teamSize,
    rotateGkAtHalftime,
    gameTimerRef,
    toast,
  });

  // Auto-open substitution preview dialog when a pitch player is selected in sub mode
  useEffect(() => {
    console.log('[AutoOpen] subMode:', subMode, 'selectedOnPitch:', selectedOnPitch, 'benchLength:', playersOnBench.length);
    if (subMode && selectedOnPitch && playersOnBench.length > 0) {
      const pitchPlayer = players.find(p => p.id === selectedOnPitch);
      console.log('[AutoOpen] pitchPlayer:', pitchPlayer?.name, 'currentPitchPosition:', pitchPlayer?.currentPitchPosition);
      if (pitchPlayer?.currentPitchPosition) {
        console.log('[AutoOpen] Opening dialog!');
        setSubPreviewOpen(true);
      } else {
        console.log('[AutoOpen] NOT opening - no currentPitchPosition');
      }
    } else {
      console.log('[AutoOpen] NOT opening - conditions not met');
    }
  }, [subMode, selectedOnPitch, playersOnBench.length, players]);

  // movablePitchPlayerIds now lives in usePitchBoardSubSelection.

  // handleConfirmManualSub / handleCancelManualSub / handleBenchToSubSelect
  // now live in usePitchBoardManualSub.

  // Calculate which positions on pitch are occupied by the filtered position type
  // (Position zone indicators removed)

  // Landscape layout: pitch full screen on left, controls stacked on right
  // ---- Layout context for landscape/portrait split ----
  const layoutCtx: PitchBoardLayoutContextValue = {
    autoSubActive, autoSubFromPreGame, autoSubPanelOpen, autoSubPaused, autoSubPlan,
    autoSubPlanDialogOpen, autoSubPlanEditMode, ballOffset, ballPosition, benchDragPlayer,
    benchDragPos, benchInjuryConfirmOpen, benchInjuryTarget, benchLongPressTimer,
    benchPositionFilter, benchToSubOpen, benchToSubPlayer, cancelPlanConfirmOpen,
    canvasRef, clearDrawings, containerRef, disableAutoSubs, disableBatchSubs,
    disablePositionSwaps, draggedPlayer, drawingColor, drawingEnabled, drawingTool,
    elapsedGameTime, fillInDialogOpen, filteredPlayersOnPitch, floatingTimerPosition,
    floatingTimerScale, formationChangeDialogOpen, formationName, gameInProgress, gameTimerRef,
    getPlayerTeamColor, getValidBenchPlayerIds, getValidSwapPlayerIds, goals,
    handleAddFillInPlayer, handleAddGoal, handleApplyTacticalSuggestion, handleBallDrag,
    handleBallDragEnd, handleBallDragStart, handleBallTouchEnd, handleBallTouchMove,
    handleBallTouchStart, handleBenchDrop, handleBenchLongPressEnd, handleBenchLongPressMove,
    handleBenchLongPressStart, handleBenchToSubSelect, handleCancelAutoSubPlan,
    handleCancelManualSub, handleCancelPitchSwap, handleCancelSwapBasedSub, handleConfirmAutoSub,
    handleAcknowledgeHalftimePrompt,
    handleConfirmManualSub, handleConfirmPitchSwap, handleConfirmPitchSwapWithAccommodation,
    handleConfirmSubAfterSwap, handleConfirmSwapBeforeSub, handleDismissTacticalSuggestion,
    handleDragEnd, handleDragOver, handleDragStart, handleExecuteNow, handleFormationChange,
    handleFormationChangeCancel, handleFormationChangeConfirm, handleHalfChange,
    handleLineupConfirm, handleLineupSkip, handleLinkEvent, handleMarkInjuredOnPitch,
    handleMaxSpreadMinutesChange, handleMinutesPerHalfChange, handleMockModeChange,
    handleOpenEditPlan, handlePitchDrop, handlePitchTouchEnd, handlePitchTouchMove,
    handlePitchTouchStart, handlePlayerClick, handlePortraitTimerTouchStart, handleRegeneratePlan,
    handleRemoveFillInPlayer, handleRemoveGoal, handleResetFormation, handleResetGame,
    handleRotationSpeedChange, handleSaveSettings, handleSetupGame,
    handleShowLineupPickerSettingChange, handleSkipAutoSub, handleSkipNextSub,
    handleStartAutoSubPlan, handleSubPreviewSelect, handleSwapAndSubstitute,
    handleTacticalModeChange, handleTeamSizeChange, handleTimerDragStart, handleTimerTouchStart,
    handleTimerUpdate, handleToggleLockPlayer, handleTogglePauseAutoSub, handleTouchStart,
    handleUndo, handleUnlinkEvent, handleUpdateGoal, handleUpdatePositions, handleWheel,
    hideScores, ignoreNextLandscapeBackdropClickRef, ignoreNextLandscapeBenchOpenRef,
    isDraggingBall, isDrawingArrowRef, isLandscape, isSavingSettings, isSubsManager,
    landscapeEventSelectorOpen, lastTapRef, linkedEventDetails, linkedEventId, lockedPlayerIds,
    manualSubConfirmOpen, maxSpreadMinutes, members, miniLeagueTeams, minutesPerHalf, mockMode,
    movablePitchPlayerIds, nextSubInfo, onClose, onUnlinkEvent, openAutoSubPlanDialog,
    opponentName, pendingAutoSub, pendingBatchSubs, pendingFormationChange, pendingManualSub,
    pendingSubBenchPlayer, pendingSwapBasedSub, pinDrawingToolbar, pitchPlayerActionOpen,
    pitchZoomScrollRef,
    pitchPlayerActionTarget, pitchSwapConfirmOpen, players, playersOnBench, playersOnPitch,
    portraitSheetDragRef, portraitSheetHeightPct, portraitSheetOpen, portraitTimerPosition,
    portraitTimerScale, positionEditorOpen, positionSwapDialogOpen, preferredSecondHalfGkId,
    previewSwapPlayers, readOnly, recentlyDraggedRef, requiredPosition, resetGameConfirmOpen,
    rotateGkAtHalftime, rotationSpeed, selectedFormation, selectedOnBench, selectedOnPitch,
    selectedTeamForSettings, setAutoSubPanelOpen, setAutoSubPlanDialogOpen,
    setBenchInjuryConfirmOpen, setBenchInjuryTarget, setBenchPositionFilter, setBenchToSubOpen,
    setBenchToSubPlayer, setBottomSheetTab, setCancelPlanConfirmOpen, setDisableBatchSubs,
    setDisablePositionSwaps, setDrawingColor, setDrawingTool, setFillInDialogOpen,
    setFormationChangeDialogOpen, setHideScores, setLandscapeEventSelectorOpen,
    setManualSubConfirmOpen, setPendingSubBenchPlayer, setPinDrawingToolbar,
    setPitchPlayerActionOpen, setPitchPlayerActionTarget, setPitchSwapConfirmOpen, setPlayers,
    setPortraitSheetHeightPct, setPortraitSheetOpen, setPositionEditorOpen,
    setPositionSwapDialogOpen, setPreviewSwapPlayers, setRequiredPosition, setResetGameConfirmOpen,
    setRotateGkAtHalftime, setRotationSpeed, setSelectedFormation, setSelectedOnBench,
    setSelectedOnPitch, setSelectedTeamForSettings, setSettingsDialogOpen, setSettingsMenuOpen,
    setSheetHeightPct, setShowFloatingDrawToolbar, setShowLineupPicker, setShowMatchHeader,
    setStatsOpen, setSubConfirmDialogOpen, setSubPreviewOpen, setTeamSize,
    setTimerFormationDropdownOpen, setTimerTacticalDropdownOpen, setToolbarCollapsed,
    setTouchDragPlayer, setTouchOffset,
    settingsDialogOpen, settingsMenuOpen, sheetDragRef, sheetHeightPct, showFloatingDrawToolbar,
    showFloatingUndo, showLineupPicker, showLineupPickerSetting, showMatchHeader,
    showScoreInPortrait, statsOpen, subAfterSwapDialogOpen, subAnimationPlayers,
    subConfirmDialogOpen, subDuePlayerIds, subMode, subPreviewOpen, swapBeforeSubDialogOpen,
    swapFlashIds, swapMode, swapPlayer1, swapPlayer2, tacticalFormationSuggestion, tacticalMode,
    tacticalOffsets, teamId, teamName, teamSize, timerFormationDropdownOpen, timerResetKey,
    timerTacticalDropdownOpen, togglePlayerInjury, toggleSubMode, toggleSwapMode, toolbarCollapsed,
    touchDragPlayer, touchHandledRef, touchIdRef,
    undoHistory, user, zoom,
  };

  return (
    <PitchBoardLayoutContext.Provider value={layoutCtx}>
      <Suspense fallback={null}>
        {isLandscape ? <PitchBoardLandscapeLayout /> : <PitchBoardPortraitLayout />}
      </Suspense>
    </PitchBoardLayoutContext.Provider>
  );
}

/**
 * Durable lineup gate: when the board is opened for a specific fixture we first
 * pull the saved lineup for that event from the database into localStorage, so
 * a lineup planned on another device (or before a cache clear) is restored.
 * The inner board reads localStorage synchronously on mount, so it must not
 * render until hydration has settled.
 */
export default function PitchBoard(props: PitchBoardProps) {
  const { ready } = useEventLineupHydration(
    props.initialLinkedEventId ?? null,
    props.teamId,
    { enabled: !props.readOnly && !props.miniLeagueTeams }
  );

  if (!ready) {
    return <PitchBoardLoading message="Restoring lineup..." />;
  }

  return <PitchBoardInner {...props} />;
}
