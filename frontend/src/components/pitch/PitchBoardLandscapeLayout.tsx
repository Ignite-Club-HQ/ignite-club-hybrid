import { Suspense } from "react";
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
import { Pencil, Eraser, Trash2, ArrowLeft, RotateCcw, MoveRight, X, Users, Settings2, BarChart3, Play, Eye, ArrowLeftRight, Undo2, Shield, Circle, Swords, Pin, Link2, Link2Off, Settings, UserCog, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import PlayerToken from "./PlayerToken";
import SoccerBall from "./SoccerBall";
import GameTimer from "./GameTimer";
import PitchToolbar from "./PitchToolbar";
import { EventLinkSelector } from "./EventLinkSelector";
import { LinkedEventHeader } from "./LinkedEventHeader";
import { LandscapeEventSelector } from "./LandscapeEventSelector";
import { PitchPosition } from "./PositionBadge";

import TacticalModeSelector from "./TacticalModeSelector";
import { useAutoSubs } from "@/hooks/useAutoSubs";
import { usePitchSettings } from "@/hooks/usePitchSettings";
import { useDraggableTimer } from "@/hooks/useDraggableTimer";
import { useWakeLock } from "@/hooks/useWakeLock";
import { requestEndGameAndSave } from "./endGameRequest";
import { PitchSettingsDialog } from "./PitchSettingsDialog";

import { useToast } from "@/hooks/use-toast";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSwipeGesture } from "@/hooks/useSwipeGesture";
import { usePitchBoardNotifications } from "@/hooks/usePitchBoardNotifications";
import { useIsLandscape } from "@/hooks/useIsLandscape";
import { useEventGroupSync } from "@/hooks/useEventGroupSync";

import { useEventGoingAttendees } from "@/hooks/useEventGoingAttendees";
import { hapticImpactMedium, hapticImpactLight } from "@/lib/haptics";

// Import types and utils from extracted files
import { FORMATIONS } from "./types";
import ScoreTracker from "./ScoreTracker";
import {
  savePitchState,
  clearPitchState,
  loadTimerStateForMinutes,
  recalculateRemainingPlanTeamAware as recalculateRemainingPlan,
  validateAndFixRemainingPlan
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
import { usePitchBoardInitialState, isSavedDefaultTeamSize } from "./hooks/usePitchBoardInitialState";
import { TacticalMode, TACTICAL_MODE_LABELS } from "./tacticalMode";

import { Download } from "lucide-react";

import { usePitchBoardLayoutContext } from "./PitchBoardLayoutContext";
import type { PitchBoardLayoutContextValue } from "./PitchBoardLayoutContext";
import { PitchBoardBenchPlayers } from "./PitchBoardBenchPlayers";
import { PitchBoardPositionDialogs } from "./PitchBoardPositionDialogs";
import {
  AutoSubControlPanel,
  AutoSubPlanDialog,
  DialogLoader,
  FormationChangeDialog,
  MatchStatsPanel,
  ManualSubConfirmDialog,
  PitchBoardLoading,
  PitchPlayerActionMenu,
  PitchSwapConfirmDialog,
  PreGameLineupScreen,
  SubConfirmDialog,
} from "./PitchBoardSharedPresentation";

export default function PitchBoardLandscapeLayout() {
  const ctx: PitchBoardLayoutContextValue = usePitchBoardLayoutContext();
  const {
    autoSubActive,
    autoSubFromPreGame,
    autoSubPanelOpen,
    autoSubPaused,
    autoSubPlan,
    autoSubPlanDialogOpen,
    autoSubPlanEditMode,
    ballOffset,
    ballPosition,
    benchDragPlayer,
    benchDragPos,
    benchInjuryConfirmOpen,
    benchInjuryTarget,
    benchLongPressTimer,
    benchPositionFilter,
    benchToSubOpen,
    benchToSubPlayer,
    canvasRef,
    clearDrawings,
    containerRef,
    disableAutoSubs,
    disableBatchSubs,
    disablePositionSwaps,
    draggedPlayer,
    drawingColor,
    drawingEnabled,
    drawingTool,
    elapsedGameTime,
    fillInDialogOpen,
    filteredPlayersOnPitch,
    floatingTimerPosition,
    floatingTimerScale,
    formationChangeDialogOpen,
    formationName,
    gameInProgress,
    gameTimerRef,
    getPlayerTeamColor,
    getValidBenchPlayerIds,
    getValidSwapPlayerIds,
    goals,
    handleAddFillInPlayer,
    handleAddGoal,
    handleApplyTacticalSuggestion,
    handleBallDrag,
    handleBallDragEnd,
    handleBallDragStart,
    handleBallTouchEnd,
    handleBallTouchMove,
    handleBallTouchStart,
    handleBenchDrop,
    handleBenchLongPressEnd,
    handleBenchLongPressMove,
    handleBenchLongPressStart,
    handleBenchToSubSelect,
    handleCancelManualSub,
    handleCancelPitchSwap,
    handleCancelSwapBasedSub,
    handleAcknowledgeHalftimePrompt,
    handleConfirmAutoSub,
    handleConfirmManualSub,
    handleConfirmPitchSwap,
    handleConfirmPitchSwapWithAccommodation,
    handleConfirmSubAfterSwap,
    handleConfirmSwapBeforeSub,
    handleDismissTacticalSuggestion,
    handleDragEnd,
    handleDragOver,
    handleDragStart,
    handleExecuteNow,
    handleFormationChange,
    handleFormationChangeCancel,
    handleFormationChangeConfirm,
    handleHalfChange,
    handleLineupConfirm,
    handleLineupSkip,
    handleLinkEvent,
    handleMarkInjuredOnPitch,
    handleMaxSpreadMinutesChange,
    handleMinutesPerHalfChange,
    handleMockModeChange,
    handleOpenEditPlan,
    handlePitchDrop,
    handlePitchTouchEnd,
    handlePitchTouchMove,
    handlePitchTouchStart,
    handlePlayerClick,
    handleRegeneratePlan,
    handleRemoveFillInPlayer,
    handleRemoveGoal,
    handleResetFormation,
    handleResetGame,
    handleRotationSpeedChange,
    handleSaveSettings,
    handleSetupGame,
    handleShowLineupPickerSettingChange,
    handleSkipAutoSub,
    handleSkipNextSub,
    handleStartAutoSubPlan,
    handleSubPreviewSelect,
    handleSwapAndSubstitute,
    handleTacticalModeChange,
    handleTeamSizeChange,
    handleTimerDragStart,
    handleTimerTouchStart,
    handleTimerUpdate,
    handleToggleLockPlayer,
    handleTogglePauseAutoSub,
    handleTouchStart,
    handleUndo,
    handleUnlinkEvent,
    handleUpdateGoal,
    handleUpdatePositions,
    handleWheel,
    hideScores,
    ignoreNextLandscapeBackdropClickRef,
    ignoreNextLandscapeBenchOpenRef,
    isDraggingBall,
    isDrawingArrowRef,
    isLandscape,
    isSavingSettings,
    isSubsManager,
    landscapeEventSelectorOpen,
    lastTapRef,
    linkedEventDetails,
    linkedEventId,
    lockedPlayerIds,
    manualSubConfirmOpen,
    maxSpreadMinutes,
    members,
    miniLeagueTeams,
    minutesPerHalf,
    mockMode,
    movablePitchPlayerIds,
    nextSubInfo,
    onClose,
    onUnlinkEvent,
    openAutoSubPlanDialog,
    opponentName,
    pendingAutoSub,
    pendingFormationChange,
    pendingManualSub,
    pendingSubBenchPlayer,
    pendingSwapBasedSub,
    pinDrawingToolbar,
    pitchPlayerActionOpen,
    pitchPlayerActionTarget,
    pitchSwapConfirmOpen,
    players,
    playersOnBench,
    playersOnPitch,
    positionEditorOpen,
    positionSwapDialogOpen,
    preferredSecondHalfGkId,
    previewSwapPlayers,
    readOnly,
    recentlyDraggedRef,
    requiredPosition,
    resetGameConfirmOpen,
    rotateGkAtHalftime,
    rotationSpeed,
    selectedFormation,
    selectedOnBench,
    selectedOnPitch,
    selectedTeamForSettings,
    setAutoSubPanelOpen,
    setAutoSubPlanDialogOpen,
    setBenchInjuryConfirmOpen,
    setBenchInjuryTarget,
    setBenchPositionFilter,
    setBenchToSubOpen,
    setBenchToSubPlayer,
    setBottomSheetTab,
    setCancelPlanConfirmOpen,
    setDisableBatchSubs,
    setDisablePositionSwaps,
    setDrawingColor,
    setDrawingTool,
    setFillInDialogOpen,
    setFormationChangeDialogOpen,
    setHideScores,
    setLandscapeEventSelectorOpen,
    setManualSubConfirmOpen,
    setPendingSubBenchPlayer,
    setPinDrawingToolbar,
    setPitchPlayerActionOpen,
    setPitchPlayerActionTarget,
    setPitchSwapConfirmOpen,
    setPlayers,
    setPositionEditorOpen,
    setPositionSwapDialogOpen,
    setPreviewSwapPlayers,
    setRequiredPosition,
    setResetGameConfirmOpen,
    setRotateGkAtHalftime,
    setRotationSpeed,
    setSelectedFormation,
    setSelectedOnBench,
    setSelectedOnPitch,
    setSelectedTeamForSettings,
    setSettingsDialogOpen,
    setSettingsMenuOpen,
    setSheetHeightPct,
    setShowFloatingDrawToolbar,
    setShowLineupPicker,
    setShowMatchHeader,
    setStatsOpen,
    setSubConfirmDialogOpen,
    setSubPreviewOpen,
    setTeamSize,
    setTimerFormationDropdownOpen,
    setTimerTacticalDropdownOpen,
    setToolbarCollapsed,
    setTouchDragPlayer,
    setTouchOffset,
    settingsDialogOpen,
    settingsMenuOpen,
    sheetDragRef,
    sheetHeightPct,
    showFloatingDrawToolbar,
    showFloatingUndo,
    showLineupPicker,
    showLineupPickerSetting,
    showMatchHeader,
    statsOpen,
    subAfterSwapDialogOpen,
    subAnimationPlayers,
    subConfirmDialogOpen,
    subDuePlayerIds,
    subMode,
    subPreviewOpen,
    swapBeforeSubDialogOpen,
    swapFlashIds,
    swapMode,
    swapPlayer1,
    swapPlayer2,
    tacticalFormationSuggestion,
    tacticalMode,
    tacticalOffsets,
    teamId,
    teamName,
    teamSize,
    timerFormationDropdownOpen,
    timerResetKey,
    timerTacticalDropdownOpen,
    togglePlayerInjury,
    toggleSubMode,
    toggleSwapMode,
    toolbarCollapsed,
    touchDragPlayer,
    touchHandledRef,
    touchIdRef,
    undoHistory,
    zoom,
    pitchZoomScrollRef
  } = ctx;

    return createPortal(
      <div
        className={cn(
          "fixed inset-0 w-screen h-screen bg-background flex flex-col overflow-hidden pl-safe pr-safe",
          // On native we call StatusBar.hide() in landscape, so the OS status bar
          // is gone and pt-safe would leave a stale gap above the header. Only
          // apply top safe-area padding on web (browser chrome / display cutouts).
          !Capacitor.isNativePlatform() && "pt-safe",
        )}
        style={{ height: '100dvh', zIndex: 99999 }}
      >
        {/* Landscape header bar — sits flush at the top on native (status bar
            hidden) and below the safe area on web. */}
        <div className="shrink-0 h-12 bg-background border-b border-border flex items-center px-3 gap-2 z-[60]">
          {/* Left: Back + Team name */}
          <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={onClose}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <span className="text-sm font-semibold truncate">{teamName}</span>
          {readOnly && (
            <Badge variant="secondary" className="text-[10px] shrink-0">
              <Eye className="h-3 w-3 mr-1" />
              View Only
            </Badge>
          )}
          {!readOnly && isSubsManager && (
            <Badge variant="default" className="text-[10px] shrink-0 bg-primary/90">
              <UserCog className="h-3 w-3 mr-1" />
              Subs Manager
            </Badge>
          )}
          {linkedEventId && (
            <div className="min-w-0 flex-1 max-w-md overflow-hidden">
              <LinkedEventHeader
                eventId={linkedEventId}
                teamId={teamId}
                teamName={teamName}
                compact
                isGameInProgress={gameInProgress}
              />
            </div>
          )}
          
          <div className="flex-1" />

          {/* Sub-related controls group - centered */}
          <div className="flex items-center gap-3">

            {/* Bench button removed — use bench drawer / drag-to-sub instead */}
            {!readOnly && (subMode || swapMode) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-10 shrink-0 gap-1.5 px-3 text-sm text-destructive"
                onClick={() => { if (subMode) toggleSubMode(); else toggleSwapMode(); }}
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
            )}

          </div>

          <div className="flex-1" />

          {/* Right: Utility controls */}
          <div className="flex items-center gap-1">
            {!readOnly && !linkedEventId && !subMode && !swapMode && (
              <Button
                variant="ghost"
                size="sm"
                className="h-10 shrink-0 gap-1.5 px-3 text-sm"
                onClick={() => setLandscapeEventSelectorOpen(true)}
              >
                <Link2 className="h-4 w-4" />
                Link
              </Button>
            )}
            {!readOnly && !subMode && !swapMode && !(gameInProgress && gameTimerRef.current?.isRunning() && !gameTimerRef.current?.isGameFinished()) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-10 shrink-0 gap-1.5 px-3 text-sm text-muted-foreground"
                onClick={handleSetupGame}
              >
                <Play className="h-4 w-4" />
                Setup
              </Button>
            )}
            {gameInProgress && (
              <Button
                variant="ghost"
                size="sm"
                className="h-10 shrink-0 gap-1.5 px-3 text-sm"
                onClick={() => setStatsOpen(true)}
                aria-label="Match Stats"
              >
                <BarChart3 className="h-4 w-4" />
                Stats
              </Button>
            )}
            {!readOnly && (
              <>
                <div className="w-px h-6 bg-border mx-1" />
                <div className="relative">
                  <Button variant="ghost" size="icon" className="h-12 w-12 shrink-0" onClick={() => setSettingsMenuOpen(prev => !prev)}>
                    <Settings className="h-6 w-6" />
                  </Button>
                  {settingsMenuOpen && createPortal(
                    <>
                      <div className="fixed inset-0 z-[99998]" onClick={() => setSettingsMenuOpen(false)} />
                      <div className="fixed top-12 right-2 bg-background border rounded-lg shadow-xl z-[99999] min-w-[200px] py-1">
                        <button className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2" onClick={() => { setStatsOpen(true); setSettingsMenuOpen(false); }}>
                          <BarChart3 className="h-4 w-4" />
                          Match Stats
                        </button>
                        {linkedEventId && (
                          <button className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2" onClick={() => { handleUnlinkEvent(); setSettingsMenuOpen(false); }}>
                            <Link2Off className="h-4 w-4" />
                            Unlink from Game
                          </button>
                        )}
                        <div className="h-px bg-border mx-2 my-1" />
                        <button className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2" onClick={() => { setResetGameConfirmOpen(true); setSettingsMenuOpen(false); }}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                          <span className="text-destructive">Reset Game</span>
                        </button>
                        <div className="h-px bg-border mx-2 my-1" />
                        <button className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2" onClick={() => { setSettingsDialogOpen(true); setSettingsMenuOpen(false); }}>
                          <Settings2 className="h-4 w-4" />
                          All Settings
                        </button>
                      </div>
                    </>,
                    document.body
                  )}
                </div>
                <PitchSettingsDialog
                  teamId={teamId}
                  selectedFormation={selectedFormation}

                  onFormationChange={handleFormationChange}
                  formations={FORMATIONS[teamSize]}
                  teamSize={teamSize}
                  onTeamSizeChange={handleTeamSizeChange}
                  minutesPerHalf={minutesPerHalf}
                  onMinutesPerHalfChange={handleMinutesPerHalfChange}
                  rotationSpeed={rotationSpeed}
                  onRotationSpeedChange={handleRotationSpeedChange}
                  disablePositionSwaps={disablePositionSwaps}
                  onDisablePositionSwapsChange={setDisablePositionSwaps}
                  disableBatchSubs={disableBatchSubs}
                  onDisableBatchSubsChange={setDisableBatchSubs}
                  rotateGkAtHalftime={rotateGkAtHalftime}
                  onRotateGkAtHalftimeChange={setRotateGkAtHalftime}
                  maxSpreadMinutes={maxSpreadMinutes}
                  onMaxSpreadMinutesChange={handleMaxSpreadMinutesChange}
                  onOpenPositionEditor={() => setPositionEditorOpen(true)}
                  mockMode={mockMode}
                  onMockModeChange={handleMockModeChange}
                  readOnly={readOnly}
                  gameInProgress={gameInProgress}
                  gameTimerRunning={!!gameTimerRef.current?.isRunning()}
                  gameFinished={!!gameTimerRef.current?.isGameFinished()}
                  onResetGame={handleResetGame}
                  linkedEventId={linkedEventId}
                  onUnlinkEvent={handleUnlinkEvent}
                  onResetFormation={handleResetFormation}
                  onOpenStats={() => setStatsOpen(true)}
                onEndGameAndSave={() => requestEndGameAndSave(teamId)}
                  onSaveSettings={handleSaveSettings}
                  isSaving={isSavingSettings}
                  showMatchHeader={showMatchHeader}
                  onShowMatchHeaderChange={setShowMatchHeader}
                  hideScores={hideScores}
                  onHideScoresChange={setHideScores}
                  showLineupPicker={showLineupPickerSetting}
                  onShowLineupPickerChange={handleShowLineupPickerSettingChange}
                   onOpenLineupPicker={handleSetupGame}
                  onAddFillInPlayer={() => {
                    setToolbarCollapsed(false);
                    setSheetHeightPct(50);
                    setFillInDialogOpen(true);
                  }}
                  hideTrigger
                  externalOpen={settingsDialogOpen}
                  onExternalOpenChange={setSettingsDialogOpen}
                />
              </>
            )}
            {readOnly && (
              <div className="relative">
                <Button variant="ghost" size="icon" className="h-12 w-12 shrink-0" onClick={() => setSettingsMenuOpen(prev => !prev)}>
                  <Settings className="h-6 w-6" />
                </Button>
                {settingsMenuOpen && createPortal(
                  <>
                    <div className="fixed inset-0 z-[99998]" onClick={() => setSettingsMenuOpen(false)} />
                    <div className="fixed top-12 right-2 bg-background border rounded-lg shadow-xl z-[99999] min-w-[180px] py-1">
                      <button className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2" onClick={() => { setStatsOpen(true); setSettingsMenuOpen(false); }}>
                        <BarChart3 className="h-4 w-4" />
                        Match Stats
                      </button>
                    </div>
                  </>,
                  document.body
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Mini-league team selector strip - landscape */}
        {miniLeagueTeams && !readOnly && (
          <div className="shrink-0 flex items-center gap-1.5 px-3 py-1 border-b border-border bg-background z-[60]">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Team:</span>
            {(["a", "b", "both"] as const).map((team) => (
              <button
                key={team}
                className={cn(
                  "h-7 px-3 text-xs font-semibold rounded-md transition-colors",
                  selectedTeamForSettings === team
                    ? "text-white shadow-sm"
                    : "bg-muted hover:bg-muted/80 text-foreground"
                )}
                style={selectedTeamForSettings === team ? {
                  backgroundColor: team === "a" ? miniLeagueTeams.teamAColor 
                    : team === "b" ? miniLeagueTeams.teamBColor 
                    : 'hsl(var(--primary))',
                } : undefined}
                onClick={(e) => { e.stopPropagation(); setSelectedTeamForSettings(team); }}
              >
                {team === "a" ? (miniLeagueTeams.teamAName || "Team A")
                  : team === "b" ? (miniLeagueTeams.teamBName || "Team B")
                  : "Both"}
              </button>
            ))}
          </div>
        )}

        {/* Main content area */}
        <div className="flex-1 flex overflow-visible">
          {/* Main pitch area - full height */}
          <div className="flex-1 h-full relative overflow-visible z-[65]">
          
          {/* Floating draggable timer */}
          <div 
            className="absolute z-[70] cursor-move touch-none select-none origin-top-left"
            style={{ 
              left: floatingTimerPosition.x, 
              top: floatingTimerPosition.y,
              transform: `scale(${floatingTimerScale})`,
            }}
            onMouseDown={handleTimerDragStart}
            onTouchStart={handleTimerTouchStart}
          >
             <div className="flex flex-col items-center bg-zinc-800 rounded-lg px-3 py-1.5 shadow-lg">
               {/* Main row: Score | Timer | Play */}
               <div className="flex items-center gap-2 w-full justify-center">
                {gameInProgress && !hideScores && (
                  <ScoreTracker
                    goals={goals}
                    onAddGoal={handleAddGoal}
                    onRemoveGoal={handleRemoveGoal}
                    onUpdateGoal={handleUpdateGoal}
                    players={players}
                    currentHalf={gameTimerRef.current?.getCurrentHalf() || 1}
                    elapsedSeconds={gameTimerRef.current?.getElapsedSeconds() || 0}
                    teamName={teamName}
                    opponentName={opponentName}
                    readOnly={readOnly}
                    isGameFinished={gameTimerRef.current?.isGameFinished() || false}
                    miniLeagueTeams={miniLeagueTeams}
                    mini
                  />
                )}
                <GameTimer 
                  key={timerResetKey}
                  ref={gameTimerRef} 
                  compact
                  compactLarge={!(gameInProgress && !hideScores)}
                  teamId={teamId} 
                  teamName={teamName} 
                  onTimeUpdate={handleTimerUpdate} 
                  onHalfChange={handleHalfChange} 
                  readOnly={readOnly}
                  hideExtras
                  minutesPerHalf={minutesPerHalf}
                  onMinutesPerHalfChange={handleMinutesPerHalfChange}
                  kickoffTime={linkedEventDetails?.start_time ?? null}
                />
                {!readOnly && !disableAutoSubs && autoSubActive && (
                  <button
                    className="flex items-center justify-center w-5 h-5 rounded-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAutoSubPanelOpen(true);
                    }}
                    title="Auto Subs active"
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
                  </button>
                )}
              </div>
              {/* Bottom row: Formation • Tactical */}
              <div className="flex items-center gap-1.5 mt-0.5 relative">
                <button
                  className="text-sm text-white/70 font-medium hover:text-white/90 transition-colors px-2 py-1 rounded hover:bg-white/10 active:bg-white/20 min-h-[32px] flex items-center"
                  onClick={(e) => { e.stopPropagation(); if (!readOnly) setTimerFormationDropdownOpen(prev => !prev); }}
                >
                  {FORMATIONS[teamSize][selectedFormation]?.name} ▾
                </button>
                <span className="text-white/30 text-sm">•</span>
                <button
                  className="flex items-center gap-1.5 text-sm text-white/70 font-medium hover:text-white/90 transition-colors px-2 py-1 rounded hover:bg-white/10 active:bg-white/20 min-h-[32px]"
                  onClick={(e) => { e.stopPropagation(); if (!readOnly) setTimerTacticalDropdownOpen(prev => !prev); }}
                >
                  {tacticalMode === "defend" && <Shield className="h-4 w-4 text-blue-400" />}
                  {tacticalMode === "neutral" && <Circle className="h-4 w-4 text-white/60" />}
                  {tacticalMode === "attack" && <Swords className="h-4 w-4 text-orange-400" />}
                  {TACTICAL_MODE_LABELS[tacticalMode]} ▾
                </button>
                {/* Tactical dropdown */}
                {timerTacticalDropdownOpen && (
                  <>
                  <div className="fixed inset-0 z-[66]" onClick={(e) => { e.stopPropagation(); setTimerTacticalDropdownOpen(false); }} />
                  <div className="absolute top-full right-0 mt-1 bg-background border rounded-lg shadow-xl z-[60] min-w-[130px] py-1">
                    {(["defend", "neutral", "attack"] as TacticalMode[]).map((mode) => (
                      <button
                        key={mode}
                        className={cn(
                          "w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2",
                          mode === tacticalMode && "bg-muted font-semibold"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTacticalModeChange(mode);
                          setTimerTacticalDropdownOpen(false);
                        }}
                      >
                        {mode === "defend" && <Shield className="h-3.5 w-3.5 text-blue-500" />}
                        {mode === "neutral" && <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
                        {mode === "attack" && <Swords className="h-3.5 w-3.5 text-orange-500" />}
                        {TACTICAL_MODE_LABELS[mode]}
                      </button>
                    ))}
                  </div>
                  </>
                )}
                {/* Formation dropdown */}
                {timerFormationDropdownOpen && (
                  <>
                  <div className="fixed inset-0 z-[66]" onClick={(e) => { e.stopPropagation(); setTimerFormationDropdownOpen(false); }} />
                  <div className="absolute top-full left-0 mt-1 bg-background border rounded-lg shadow-xl z-[60] min-w-[160px] py-1 max-h-64 overflow-y-auto">
                    {/* Team selector moved to top strip */}
                    {FORMATIONS[teamSize].map((f, i) => (
                      <button
                        key={i}
                        className={cn(
                          "w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors",
                          i === selectedFormation && "bg-muted font-semibold"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFormationChange(String(i));
                          setTimerFormationDropdownOpen(false);
                        }}
                      >
                        {f.name}
                      </button>
                    ))}
                    {!readOnly && (
                      <>
                        <div className="h-px bg-border my-1" />
                        <button
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-muted-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleResetFormation();
                            setTimerFormationDropdownOpen(false);
                          }}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Reset Formation
                        </button>
                      </>
                    )}
                  </div>
                  </>
                )}
              </div>
            </div>
            {/* Undo button below widget */}
            {!readOnly && showFloatingUndo && undoHistory.length > 0 && (
              <div className="flex justify-center mt-1.5 animate-fade-in">
                <Button 
                  variant="secondary" 
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); handleUndo(); }}
                  className="shadow-md gap-1.5 opacity-90 hover:opacity-100 cursor-pointer"
                >
                  <Undo2 className="h-4 w-4" />
                  Undo
                </Button>
              </div>
            )}
          </div>

          {/* Score tracker now integrated into the floating timer widget above */}

          {/* Undo button now inside the floating timer widget above */}

          {/* Swap/Sub FABs moved to header - this section intentionally removed */}

          {/* Bench drag floating indicator - landscape */}
          {benchDragPlayer && benchDragPos && (
            <div 
              className="fixed z-[100] pointer-events-none animate-scale-in"
              style={{ left: benchDragPos.x - 30, top: benchDragPos.y - 40 }}
            >
              <div className="w-[60px] h-[60px] rounded-full bg-primary border-2 border-primary-foreground shadow-2xl flex items-center justify-center animate-pulse">
                <span className="text-primary-foreground text-xs font-bold text-center leading-tight px-1 truncate">
                  {players.find(p => p.id === benchDragPlayer)?.name?.split(' ')[0] || '?'}
                </span>
              </div>
              <div className="text-center mt-0.5">
                <span className="text-[9px] font-semibold bg-primary text-primary-foreground px-2 py-0.5 rounded-full shadow-lg">
                  Drop on pitch
                </span>
              </div>
            </div>
          )}

          {/* Formation suggestion floating popup - landscape */}
          {tacticalFormationSuggestion && !readOnly && (
            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] animate-fade-in">
              <div className="flex flex-col items-center gap-3 bg-card border border-border rounded-2xl px-6 py-5 shadow-xl max-w-[280px]">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
                  {tacticalFormationSuggestion.mode === "attack"
                    ? <Swords className="h-5 w-5 text-primary" />
                    : <Shield className="h-5 w-5 text-primary" />}
                </div>
                <div className="text-center space-y-1">
                  <p className="text-base font-bold">
                    Try {tacticalFormationSuggestion.formationName}?
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {tacticalFormationSuggestion.mode === "attack"
                      ? "More forwards for attacking play"
                      : "Extra defenders for solid cover"}
                  </p>
                </div>
                <div className="flex items-center gap-2 w-full mt-1">
                  <Button type="button" className="flex-1 h-10" onClick={handleApplyTacticalSuggestion}>
                    Apply
                  </Button>
                  <Button type="button" variant="outline" className="flex-1 h-10" onClick={handleDismissTacticalSuggestion}>
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div
            id="landscape-pitch-area"
            ref={pitchZoomScrollRef}
            className={cn("w-full h-full", zoom > 1 ? "overflow-auto" : "overflow-hidden")}
            style={{ zIndex: 0 }}
            onDrop={handlePitchDrop}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
          >
            <div 
              className={cn(
              "transition-transform duration-100 w-full h-full",
              drawingTool === "none" && zoom <= 1 ? "touch-none" : ""
            )}
              onDrop={handlePitchDrop}
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onTouchStart={drawingTool === "none" ? handlePitchTouchStart : undefined}
              onTouchMove={drawingTool === "none" ? handlePitchTouchMove : undefined}
              onTouchEnd={drawingTool === "none" ? handlePitchTouchEnd : undefined}
              style={{
                background: `linear-gradient(to bottom, 
                  hsl(var(--pitch-green) / 0.85) 0%, 
                  hsl(var(--pitch-green)) 50%, 
                  hsl(var(--pitch-green) / 0.85) 100%)`,
                width: `${zoom * 100}%`,
                height: `${zoom * 100}%`,
                position: 'relative',
              }}
            >
              {/* Pitch markings */}
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                <rect x="2" y="2" width="96" height="96" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
                <line x1="2" y1="50" x2="98" y2="50" stroke="white" strokeWidth="0.3" opacity="0.7" />
                <circle cx="50" cy="50" r="12" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
                <circle cx="50" cy="50" r="0.5" fill="white" opacity="0.7" />
                <rect x="25" y="2" width="50" height="18" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
                <rect x="25" y="80" width="50" height="18" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
                <rect x="35" y="2" width="30" height="8" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
                <rect x="35" y="90" width="30" height="8" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
                <circle cx="50" cy="12" r="0.5" fill="white" opacity="0.7" />
                <circle cx="50" cy="88" r="0.5" fill="white" opacity="0.7" />
                <path d="M 2 5 A 3 3 0 0 0 5 2" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
                <path d="M 98 5 A 3 3 0 0 1 95 2" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
                <path d="M 2 95 A 3 3 0 0 1 5 98" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
                <path d="M 98 95 A 3 3 0 0 0 95 98" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
              </svg>

              {/* Swap mode connection line with arrows */}
              {swapMode && swapPlayer1 && swapPlayer2 && (() => {
                const p1 = players.find(p => p.id === swapPlayer1);
                const p2 = players.find(p => p.id === swapPlayer2);
                if (!p1?.position || !p2?.position) return null;
                
                // Calculate arrow positions along the line (at 30% and 70%)
                const midX1 = p1.position.x + (p2.position.x - p1.position.x) * 0.35;
                const midY1 = p1.position.y + (p2.position.y - p1.position.y) * 0.35;
                const midX2 = p1.position.x + (p2.position.x - p1.position.x) * 0.65;
                const midY2 = p1.position.y + (p2.position.y - p1.position.y) * 0.65;
                
                // Calculate angle for arrow rotation
                const angle = Math.atan2(p2.position.y - p1.position.y, p2.position.x - p1.position.x) * 180 / Math.PI;
                
                return (
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 35 }}>
                    <defs>
                      <linearGradient id="swapLineGradientLandscape" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#f59e0b" />
                        <stop offset="50%" stopColor="#fbbf24" />
                        <stop offset="100%" stopColor="#f59e0b" />
                      </linearGradient>
                    </defs>
                    <line
                      x1={`${p1.position.x}%`}
                      y1={`${p1.position.y}%`}
                      x2={`${p2.position.x}%`}
                      y2={`${p2.position.y}%`}
                      stroke="url(#swapLineGradientLandscape)"
                      strokeWidth="3"
                      strokeDasharray="8 4"
                      strokeLinecap="round"
                      className="animate-pulse"
                    />
                    {/* Arrow pointing from p1 to p2 */}
                    <g transform={`translate(${midX1}%, ${midY1}%)`}>
                      <polygon 
                        points="-6,-4 6,0 -6,4" 
                        fill="#f59e0b"
                        transform={`rotate(${angle})`}
                        className="animate-pulse"
                      />
                    </g>
                    {/* Arrow pointing from p2 to p1 */}
                    <g transform={`translate(${midX2}%, ${midY2}%)`}>
                      <polygon 
                        points="-6,-4 6,0 -6,4" 
                        fill="#f59e0b"
                        transform={`rotate(${angle + 180})`}
                        className="animate-pulse"
                      />
                    </g>
                    <circle cx={`${p1.position.x}%`} cy={`${p1.position.y}%`} r="6" fill="#f59e0b" opacity="0.6" />
                    <circle cx={`${p2.position.x}%`} cy={`${p2.position.y}%`} r="6" fill="#f59e0b" opacity="0.6" />
                  </svg>
                );
              })()}

              {/* Drawing canvas layer */}
              <div 
                ref={isLandscape ? containerRef : undefined}
                className="absolute inset-0 w-full h-full"
                onPointerUp={() => {
                  if (showFloatingDrawToolbar && !pinDrawingToolbar && !isDrawingArrowRef.current && drawingTool === "none") {
                    setTimeout(() => {
                      setDrawingTool("none");
                      setShowFloatingDrawToolbar(false);
                    }, 50);
                  }
                }}
                style={{
                  zIndex: drawingTool !== "none" || showFloatingDrawToolbar ? 30 : 5,
                  pointerEvents: drawingTool !== "none" || showFloatingDrawToolbar ? "auto" : "none",
                  touchAction: "none",
                }}
              >
                <canvas 
                  ref={isLandscape ? canvasRef : undefined} 
                  className="w-full h-full"
                  style={{ touchAction: "none" }}
                />
              </div>

              {/* Ball */}
              <SoccerBall
                size={28}
                isDragging={isDraggingBall}
                draggable
                onDragStart={handleBallDragStart}
                onDrag={handleBallDrag}
                onDragEnd={handleBallDragEnd}
                onTouchStart={handleBallTouchStart}
                onTouchMove={handleBallTouchMove}
                onTouchEnd={handleBallTouchEnd}
                readOnly={readOnly}
                className="absolute"
                style={{
                  left: `${ballPosition.x + ballOffset.dx}%`,
                  top: `${ballPosition.y + ballOffset.dy}%`,
                  transform: "translate(-50%, -50%)",
                  zIndex: 40,
                  transition: isDraggingBall ? "none" : (tacticalMode !== "neutral" ? "left 0.4s ease, top 0.4s ease" : undefined),
                  pointerEvents: drawingEnabled ? "none" : "auto",
                }}
              />

              {/* Players on pitch */}
              {filteredPlayersOnPitch.map(player => (
                <PlayerToken
                  key={player.id}
                  player={player}
                  onDragStart={(e) => !readOnly && handleDragStart(player.id, e)}
                  onDragEnd={handleDragEnd}
                onTouchStart={(e) => {
                    if (readOnly) return;
                    touchHandledRef.current = true;
                    if (subMode || swapMode) {
                      handlePlayerClick(player.id, true);
                      return;
                    }
                    e.preventDefault();
                    // Double-tap to open substitution picker (replaces drag-to-bench)
                    const now = Date.now();
                    const last = lastTapRef.current;
                    if (last && last.playerId === player.id && now - last.time < 400) {
                      lastTapRef.current = null;
                      e.preventDefault();
                      setTouchDragPlayer(null);
                      setTouchOffset(null);
                      touchIdRef.current = null;
                      setSelectedOnPitch(player.id);
                      setSubPreviewOpen(true);
                    } else {
                      lastTapRef.current = { playerId: player.id, time: now };
                      handleTouchStart(player.id, e);
                    }
                  }}
                  onClick={!readOnly ? () => { if (touchHandledRef.current) { touchHandledRef.current = false; return; } handlePlayerClick(player.id, true); } : undefined}
                  onDoubleClick={!readOnly ? () => { setSelectedOnPitch(player.id); setSubPreviewOpen(true); } : undefined}
                  isDragging={draggedPlayer === player.id || touchDragPlayer === player.id}
                   isSelected={(subMode && selectedOnPitch === player.id) || (swapMode && (swapPlayer1 === player.id || swapPlayer2 === player.id))}
                  isSubTarget={subMode && !selectedOnPitch && selectedOnPitch !== player.id}
                  isInvalidTarget={swapMode && swapPlayer1 !== null && swapPlayer1 !== player.id && !getValidSwapPlayerIds.has(player.id)}
                  isMovable={movablePitchPlayerIds.has(player.id)}
                  isPreviewHighlight={previewSwapPlayers.sourceId === player.id || previewSwapPlayers.targetId === player.id}
                  previewHighlightType={previewSwapPlayers.sourceId === player.id ? "source" : previewSwapPlayers.targetId === player.id ? "target" : null}
                  subAnimation={subAnimationPlayers.in === player.id ? "in" : (subAnimationPlayers.swap === player.id || swapFlashIds.includes(player.id)) ? "swap" : null}
                  readOnly={readOnly}
                  teamColor={getPlayerTeamColor(player)}
                  isNextSub={nextSubInfo?.playerOutId === player.id}
                  nextSubCountdown={nextSubInfo?.playerOutId === player.id ? nextSubInfo.countdown : null}
                  isSubDue={subDuePlayerIds.has(player.id)}
                  style={{
                    position: "absolute",
                    ...(() => {
                      const isDragging = draggedPlayer === player.id || touchDragPlayer === player.id;
                      const recentlyDropped = recentlyDraggedRef.current.has(player.id);
                      // Suppress both transition AND tactical offset for recently-dropped players
                      const offset = (!isDragging && !recentlyDropped) ? tacticalOffsets.get(player.id) : undefined;
                      const tx = offset?.dx ?? 0;
                      const ty = offset?.dy ?? 0;
                      return {
                        left: `${player.position!.x + tx}%`,
                        top: `${player.position!.y + ty}%`,
                        transform: "translate(-50%, -50%)",
                        transition: (isDragging || recentlyDropped || touchDragPlayer !== null || draggedPlayer !== null) ? "none" : "left 0.6s cubic-bezier(0.4, 0, 0.2, 1), top 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
                      };
                    })(),
                    zIndex: (subAnimationPlayers.in === player.id || subAnimationPlayers.swap === player.id) ? 40 : previewSwapPlayers.sourceId === player.id || previewSwapPlayers.targetId === player.id ? 30 : (touchDragPlayer === player.id ? 50 : 10),
                    cursor: readOnly ? "default" : ((subMode || swapMode) ? "pointer" : "grab"),
                    pointerEvents: drawingEnabled ? "none" : "auto",
                  }}
                />
              ))}

              {/* Preview swap arrow overlay */}
              {previewSwapPlayers.sourceId && previewSwapPlayers.targetId && (() => {
                const sourcePlayer = playersOnPitch.find(p => p.id === previewSwapPlayers.sourceId);
                const targetPlayer = playersOnPitch.find(p => p.id === previewSwapPlayers.targetId);
                if (!sourcePlayer?.position || !targetPlayer?.position) return null;
                
                const x1 = targetPlayer.position.x;
                const y1 = targetPlayer.position.y;
                const x2 = sourcePlayer.position.x;
                const y2 = sourcePlayer.position.y;
                
                // Calculate arrow angle
                const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
                const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
                
                return (
                  <svg 
                    className="absolute inset-0 w-full h-full pointer-events-none z-20"
                    style={{ overflow: 'visible' }}
                  >
                    <defs>
                      <marker
                        id="preview-arrowhead"
                        markerWidth="10"
                        markerHeight="7"
                        refX="9"
                        refY="3.5"
                        orient="auto"
                      >
                        <polygon
                          points="0 0, 10 3.5, 0 7"
                          fill="#22d3ee"
                        />
                      </marker>
                    </defs>
                    {/* Animated dashed line with arrow */}
                    <line
                      x1={`${x1}%`}
                      y1={`${y1}%`}
                      x2={`${x2}%`}
                      y2={`${y2}%`}
                      stroke="#22d3ee"
                      strokeWidth="3"
                      strokeDasharray="8 4"
                      markerEnd="url(#preview-arrowhead)"
                      className="animate-pulse"
                      style={{ 
                        strokeLinecap: 'round',
                        filter: 'drop-shadow(0 0 4px rgba(34, 211, 238, 0.6))'
                      }}
                    />
                    {/* Label showing position */}
                    <text
                      x={`${(x1 + x2) / 2}%`}
                      y={`${(y1 + y2) / 2 - 2}%`}
                      textAnchor="middle"
                      className="fill-cyan-400 text-[10px] font-bold"
                      style={{ 
                        paintOrder: 'stroke',
                        stroke: 'rgba(0,0,0,0.8)',
                        strokeWidth: '3px'
                      }}
                    >
                      → {sourcePlayer.currentPitchPosition}
                    </text>
                  </svg>
                );
              })()}
            </div>
          </div>
        </div>
        </div>
        {/* Swipe-up zone at bottom edge to open sheet */}
        {toolbarCollapsed && (
          <div
            className="absolute bottom-0 left-0 right-0 z-[66] flex justify-center items-end pointer-events-auto"
            style={{ height: 56 }}
            onTouchStart={(e) => {
              const el = e.currentTarget;
              if (ignoreNextLandscapeBenchOpenRef.current || drawingTool !== "none" || showFloatingDrawToolbar) {
                delete el.dataset.swipeStartY;
                delete el.dataset.swipeStartT;
                return;
              }
              el.dataset.swipeStartY = String(e.touches[0].clientY);
              el.dataset.swipeStartT = String(Date.now());
            }}
            onTouchEnd={(e) => {
              const startY = Number(e.currentTarget.dataset.swipeStartY || 0);
              const startT = Number(e.currentTarget.dataset.swipeStartT || 0);
              delete e.currentTarget.dataset.swipeStartY;
              delete e.currentTarget.dataset.swipeStartT;
              if (ignoreNextLandscapeBenchOpenRef.current || drawingTool !== "none" || showFloatingDrawToolbar) return;
              if (!startY || !startT) return;
              const deltaY = startY - e.changedTouches[0].clientY;
              const elapsed = Date.now() - startT;
              const velocity = deltaY / Math.max(elapsed, 1);
              // Open on fast flick (velocity > 0.3px/ms) or sufficient distance (>20px)
              if (deltaY > 20 || velocity > 0.3) { setSheetHeightPct(50); setToolbarCollapsed(false); }
            }}
            onTouchCancel={(e) => {
              delete e.currentTarget.dataset.swipeStartY;
              delete e.currentTarget.dataset.swipeStartT;
            }}
          >
            <div className="w-10 h-1 rounded-full bg-foreground/30 mb-1.5" />
          </div>
        )}

        {/* Floating settings button - always visible in landscape when sheet closed */}
        {toolbarCollapsed && !readOnly && (
          <>
            {/* Floating settings button - always visible in landscape when sheet closed */}
            <button
              className={cn(
                "absolute bottom-3 right-3 z-[70] w-12 h-12 rounded-full bg-background/95 backdrop-blur-md border-2 border-border shadow-xl flex items-center justify-center",
                showFloatingDrawToolbar && "pointer-events-none opacity-70"
              )}
              onPointerDown={(e) => { e.stopPropagation(); }}
              onClick={(e) => {
                e.stopPropagation();
                if (showFloatingDrawToolbar) return;
                ignoreNextLandscapeBackdropClickRef.current = true;
                setBottomSheetTab("bench");
                setSheetHeightPct(50);
                setToolbarCollapsed(false);
                window.setTimeout(() => {
                  ignoreNextLandscapeBackdropClickRef.current = false;
                }, 0);
              }}
            >
              <Users className="h-6 w-6 text-foreground" />
            </button>


            <button
              className={cn(
                "absolute bottom-3 z-[70] w-12 h-12 rounded-full backdrop-blur-md border-2 shadow-xl flex items-center justify-center",
                drawingTool !== "none"
                  ? "bg-primary text-primary-foreground border-primary"
                  : showFloatingDrawToolbar
                    ? "bg-accent text-accent-foreground border-accent"
                    : "bg-background/95 border-border text-foreground"
              )}
              style={{ right: 76 }}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                ignoreNextLandscapeBenchOpenRef.current = true;
                window.setTimeout(() => {
                  ignoreNextLandscapeBenchOpenRef.current = false;
                }, 300);
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                ignoreNextLandscapeBenchOpenRef.current = true;
                window.setTimeout(() => {
                  ignoreNextLandscapeBenchOpenRef.current = false;
                }, 300);
              }}
              onClick={(e) => {
                e.stopPropagation();
                setShowFloatingDrawToolbar(prev => !prev);
              }}
            >
              <Pencil className="h-6 w-6" />
            </button>

            {/* Floating Draw Toolbar */}
            {showFloatingDrawToolbar && (
              <div className="absolute bottom-[4.5rem] z-[71] animate-fade-in" style={{ right: 12 }} onPointerDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
                <div className="bg-background/95 backdrop-blur border border-border rounded-xl shadow-xl p-3 flex flex-col gap-3">
                  <div className="flex gap-2">
                    <Button 
                      variant={drawingTool === "pen" ? "default" : "outline"} 
                      size="icon"
                      className="h-12 w-12"
                      onTouchStart={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        ignoreNextLandscapeBenchOpenRef.current = true;
                        window.setTimeout(() => {
                          ignoreNextLandscapeBenchOpenRef.current = false;
                        }, 300);
                      }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        ignoreNextLandscapeBenchOpenRef.current = true;
                        window.setTimeout(() => {
                          ignoreNextLandscapeBenchOpenRef.current = false;
                        }, 300);
                        const nextTool = drawingTool === "pen" ? "none" : "pen";
                        setDrawingTool(nextTool);
                        if (nextTool !== "none" && !pinDrawingToolbar) setShowFloatingDrawToolbar(false);
                      }}
                    >
                      <Pencil className="h-5 w-5" />
                    </Button>
                    <Button 
                      variant={drawingTool === "arrow" ? "default" : "outline"} 
                      size="icon"
                      className="h-12 w-12"
                      onTouchStart={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        ignoreNextLandscapeBenchOpenRef.current = true;
                        window.setTimeout(() => {
                          ignoreNextLandscapeBenchOpenRef.current = false;
                        }, 300);
                      }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        ignoreNextLandscapeBenchOpenRef.current = true;
                        window.setTimeout(() => {
                          ignoreNextLandscapeBenchOpenRef.current = false;
                        }, 300);
                        const nextTool = drawingTool === "arrow" ? "none" : "arrow";
                        setDrawingTool(nextTool);
                        if (nextTool !== "none" && !pinDrawingToolbar) setShowFloatingDrawToolbar(false);
                      }}
                    >
                      <MoveRight className="h-5 w-5" />
                    </Button>
                    <Button 
                      variant="outline" 
                      size="icon" 
                      className="h-12 w-12"
                      onClick={clearDrawings}
                    >
                      <Eraser className="h-5 w-5" />
                    </Button>
                    <Button 
                      variant={pinDrawingToolbar ? "default" : "outline"} 
                      size="icon" 
                      className="h-12 w-12"
                      onClick={() => setPinDrawingToolbar(prev => !prev)}
                      title={pinDrawingToolbar ? "Unpin drawing tools" : "Pin drawing tools"}
                    >
                      <Pin className={cn("h-5 w-5", pinDrawingToolbar && "rotate-45")} />
                    </Button>
                  </div>
                  <div className="flex gap-2 justify-center">
                    {["#ffffff", "#ef4444", "#3b82f6", "#22c55e", "#eab308"].map(color => (
                      <button
                        key={color}
                        className={cn(
                          "w-8 h-8 rounded-full border-2",
                          drawingColor === color ? "border-primary ring-2 ring-primary/50" : "border-muted-foreground/30"
                        )}
                        style={{ backgroundColor: color }}
                        onClick={() => setDrawingColor(color)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Bottom Sheet Overlay for landscape controls */}
        {!toolbarCollapsed && (
          <div className="absolute inset-0 z-[68] flex flex-col pointer-events-none" style={{ height: '100%' }}>
            {/* Backdrop - pass through when drawing. Forward drag events to pitch
                so dragging bench players over the backdrop still allows drop. */}
            <div 
              className={cn("flex-1", drawingTool === "none" ? "pointer-events-auto" : "pointer-events-none")}
              onClick={drawingTool === "none" ? () => {
                if (ignoreNextLandscapeBackdropClickRef.current) return;
                setToolbarCollapsed(true);
              } : undefined}
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDrop={handlePitchDrop}
            />
            {/* Sheet */}
            <div className="pointer-events-auto bg-background border-t border-border shadow-2xl animate-in slide-in-from-bottom duration-200 flex flex-col"
              style={{ maxHeight: `${sheetHeightPct}%`, height: 'auto' }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDrop={handlePitchDrop}
            >
              {/* Draggable header area - handle + tabs */}
              <div
                className="cursor-grab touch-none"
                onTouchStart={(e) => {
                  sheetDragRef.current = { startY: e.touches[0].clientY, startPct: sheetHeightPct };
                  e.currentTarget.dataset.dragStartT = String(Date.now());
                }}
                onTouchMove={(e) => {
                  if (!sheetDragRef.current) return;
                  const containerH = window.innerHeight;
                  const deltaY = sheetDragRef.current.startY - e.touches[0].clientY;
                  const deltaPct = (deltaY / containerH) * 100;
                  const newPct = Math.min(85, Math.max(25, sheetDragRef.current.startPct + deltaPct));
                  setSheetHeightPct(newPct);
                }}
                onTouchEnd={(e) => {
                  const elapsed = Date.now() - Number(e.currentTarget.dataset.dragStartT || "0");
                  const deltaY = sheetDragRef.current ? sheetDragRef.current.startY - e.changedTouches[0].clientY : 0;
                  const velocity = deltaY / Math.max(elapsed, 1);
                  if (velocity < -0.4) {
                    setToolbarCollapsed(true);
                    setSheetHeightPct(35);
                  } else if (velocity > 0.4) {
                    // Fast upward flick → expand
                    if (sheetHeightPct > 55) {
                      setSheetHeightPct(80);
                    } else {
                      setSheetHeightPct(50);
                    }
                  } else if (sheetHeightPct < 30) {
                    setToolbarCollapsed(true);
                    setSheetHeightPct(35);
                  } else if (sheetHeightPct < 42) {
                    setSheetHeightPct(35);
                  } else if (sheetHeightPct < 65) {
                    setSheetHeightPct(50);
                  } else {
                    setSheetHeightPct(80);
                  }
                  sheetDragRef.current = null;
                }}
              >
                {/* Handle bar */}
                <div className="flex items-center justify-center gap-2 pt-2 pb-1">
                  {autoSubActive && autoSubPlan.length > 0 && (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                    </span>
                  )}
                  <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
                  {autoSubActive && autoSubPlan.length > 0 && (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                    </span>
                  )}
                </div>
      </div>


              {/* Tab content */}
              <div className="overflow-y-auto p-3 flex-1 min-h-0">
                {/* Bench content */}
                  <div className="space-y-3">
                    {/* Position Filter Chips - sticky */}
                    <div className="sticky top-[-12px] z-10 bg-background py-2 -mx-3 px-3 space-y-2">
                      <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
                        {(["GK", "DEF", "MID", "FWD"] as PitchPosition[]).map(pos => {
                          const count = playersOnBench.filter(p => p.assignedPositions?.includes(pos) || !p.assignedPositions?.length).length;
                          const totalCount = players.filter(p => p.assignedPositions?.includes(pos)).length;
                          return (
                            <button
                              key={pos}
                              onClick={() => setBenchPositionFilter(benchPositionFilter === pos ? null : pos)}
                              className={cn(
                                "rounded-md border font-medium text-sm px-3.5 py-2 transition-colors whitespace-nowrap min-h-[36px]",
                                benchPositionFilter === pos
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                              )}
                            >
                              {pos} ({count})
                            </button>
                          );
                        })}
                        {benchPositionFilter && (
                          <button
                            onClick={() => setBenchPositionFilter(null)}
                            className="rounded-md border font-medium text-sm px-3 py-2 bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20 min-h-[36px]"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                        {!readOnly && (
                          <button
                            onClick={() => setFillInDialogOpen(true)}
                            className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground text-xs font-medium px-2.5 py-2 min-h-[36px] whitespace-nowrap transition-colors"
                            aria-label="Add fill-in player"
                          >
                            <UserPlus className="h-3.5 w-3.5" />
                            Fill-in
                          </button>
                        )}
                      </div>
                      {/* Auto Subs Quick Access - Landscape (inside sticky area) */}
                      {!readOnly && !disableAutoSubs && (
                        <>
                          {autoSubPlan.length > 0 ? (
                            <button
                              className="w-full flex items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary/10 text-primary text-sm font-medium px-3 py-2 min-h-[36px] transition-colors hover:bg-primary/20"
                              onClick={() => {
                                setAutoSubPanelOpen(true);
                              }}
                            >
                              <ArrowLeftRight className="h-4 w-4" />
                              Auto Subs ({autoSubPlan.filter(s => s.executed).length}/{autoSubPlan.length})
                              <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                              </span>
                            </button>
                          ) : (
                            <button
                              className="w-full flex items-center justify-center gap-2 rounded-md border border-border bg-muted/50 text-muted-foreground text-sm font-medium px-3 py-2 min-h-[36px] transition-colors hover:bg-muted"
                              onClick={() => {
                                openAutoSubPlanDialog();
                              }}
                            >
                              <ArrowLeftRight className="h-4 w-4" />
                              Setup Auto Subs
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    {/* Bench Players - horizontal scroll */}
                    <div 
                      id="pitch-bench-landscape"
                      className="flex flex-nowrap overflow-x-auto scrollbar-none min-h-14 pb-1 gap-2"
                      style={{ touchAction: 'pan-x', WebkitOverflowScrolling: 'touch' }}
                      onDrop={!subMode ? handleBenchDrop : undefined}
                      onDragOver={!subMode ? handleDragOver : undefined}
                      onTouchMove={handleBenchLongPressMove}
                      onTouchEnd={handleBenchLongPressEnd}
                    >
                      <PitchBoardBenchPlayers
                        players={playersOnBench}
                        playersOnPitch={playersOnPitch}
                        miniLeagueTeams={miniLeagueTeams}
                        selectedTeam={selectedTeamForSettings}
                        subMode={subMode}
                        swapMode={swapMode}
                        selectedOnPitch={selectedOnPitch}
                        selectedOnBench={selectedOnBench}
                        validBenchPlayerIds={getValidBenchPlayerIds}
                        positionFilter={benchPositionFilter}
                        readOnly={readOnly}
                        gameInProgress={gameInProgress}
                        lastTapRef={lastTapRef}
                        touchHandledRef={touchHandledRef}
                        benchLongPressTimer={benchLongPressTimer}
                        setBenchInjuryTarget={setBenchInjuryTarget}
                        setBenchInjuryConfirmOpen={setBenchInjuryConfirmOpen}
                        onBenchLongPressStart={handleBenchLongPressStart}
                        onBenchLongPressMove={handleBenchLongPressMove}
                        onBenchLongPressEnd={handleBenchLongPressEnd}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onPlayerClick={handlePlayerClick}
                        onOpenBenchToSub={(playerId) => {
                          setBenchToSubPlayer(playerId);
                          setBenchToSubOpen(true);
                        }}
                        onRemoveFillInPlayer={handleRemoveFillInPlayer}
                        getPlayerTeamColor={getPlayerTeamColor}
                        nextSubInfo={nextSubInfo ? { playerInId: nextSubInfo.playerInId, countdown: nextSubInfo.countdown } : null}
                        subAnimationOut={subAnimationPlayers.out}
                        subDuePlayerIds={subDuePlayerIds}
                        isDragging={(player) => draggedPlayer === player.id || touchDragPlayer === player.id}
                        wrapperClassName="shrink-0"
                        emptyMessage="Drag here"
                        emptyMessageClassName="text-xs text-muted-foreground whitespace-nowrap"
                        noValidPlayerMessage="No players can fill this position"
                        noValidPlayerMessageClassName="text-[10px] text-muted-foreground whitespace-nowrap"
                      />
                    </div>
                  </div>
              </div>
            </div>
          </div>
        )}

        {/* Floating Pitch Shortcuts moved to landscape header bar */}

        {/* Tactical Mode moved to landscape header bar */}

        {/* Sub mode instruction banner */}
        {subMode && (
          <div className={cn(
            "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[75] px-5 py-2.5 rounded-full shadow-lg animate-fade-in pointer-events-none",
            "bg-primary text-primary-foreground"
          )}>
            <p className="text-sm font-medium whitespace-nowrap">
              {!selectedOnPitch 
                ? "Tap player on pitch to sub off" 
                : "Tap bench player to sub on"
              }
            </p>
          </div>
        )}

        {/* Swap mode instruction banner */}
        {swapMode && (
          <div className={cn(
            "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[75] px-5 py-2.5 rounded-full shadow-lg animate-fade-in pointer-events-none",
            swapPlayer1 && getValidSwapPlayerIds.size === 0 
              ? "bg-destructive text-destructive-foreground" 
              : "bg-primary text-primary-foreground"
          )}>
            <p className="text-sm font-medium whitespace-nowrap">
              {!swapPlayer1 
                ? "Tap first player to swap" 
                : getValidSwapPlayerIds.size === 0
                  ? "No players can swap to this position"
                  : "Tap second player to swap with"
              }
            </p>
          </div>
        )}

        <PitchBoardPositionDialogs
        positionEditorOpen={positionEditorOpen}
        setPositionEditorOpen={setPositionEditorOpen}
        players={players}
        onUpdatePositions={handleUpdatePositions}
        positionSwapDialogOpen={positionSwapDialogOpen}
        setPositionSwapDialogOpen={setPositionSwapDialogOpen}
        pendingSubBenchPlayer={pendingSubBenchPlayer}
        playersOnPitch={playersOnPitch}
        requiredPosition={requiredPosition}
        onSwapAndSubstitute={handleSwapAndSubstitute}
        onClearPositionSwap={() => {
          setPositionSwapDialogOpen(false);
          setPendingSubBenchPlayer(null);
          setRequiredPosition(null);
        }}
        miniLeagueTeams={miniLeagueTeams}
        subPreviewOpen={subPreviewOpen}
        setSubPreviewOpen={setSubPreviewOpen}
        setSelectedOnPitch={setSelectedOnPitch}
        setSelectedOnBench={setSelectedOnBench}
        setPreviewSwapPlayers={setPreviewSwapPlayers}
        pitchPlayer={players.find((player) => player.id === selectedOnPitch) || null}
        playersOnBench={playersOnBench}
        onSelectSubstitutionOption={handleSubPreviewSelect}
        benchToSubOpen={benchToSubOpen}
        setBenchToSubOpen={setBenchToSubOpen}
        benchToSubPlayer={benchToSubPlayer}
        setBenchToSubPlayer={setBenchToSubPlayer}
        onSelectBenchSubstitution={handleBenchToSubSelect}
        onAddFillInPlayer={handleAddFillInPlayer}
        existingNumbers={players.map((player) => player.number).filter((number): number is number => typeof number === "number")}
        fillInDialogOpen={fillInDialogOpen}
        setFillInDialogOpen={setFillInDialogOpen}
      />

        {/* Formation Change Dialog */}
        <FormationChangeDialog
          open={formationChangeDialogOpen}
          onOpenChange={setFormationChangeDialogOpen}
          currentFormation={FORMATIONS[teamSize][selectedFormation]?.name || ""}
          newFormation={pendingFormationChange ? FORMATIONS[pendingFormationChange.newTeamSize || teamSize][pendingFormationChange.index]?.name || "" : ""}
          positionSwaps={pendingFormationChange?.positionSwaps || []}
          benchMoves={pendingFormationChange?.benchMoves || []}
          onConfirm={handleFormationChangeConfirm}
          onCancel={handleFormationChangeCancel}
          isTeamSizeChange={!!pendingFormationChange?.newTeamSize}
          currentTeamSize={teamSize}
          newTeamSize={pendingFormationChange?.newTeamSize}
          minorAdjustments={pendingFormationChange?.minorAdjustments || []}
        />

        {/* Auto-Sub Plan Dialog */}
        <AutoSubPlanDialog
          open={autoSubPlanDialogOpen}
          onOpenChange={setAutoSubPlanDialogOpen}
          players={players.filter(p => !p.isInjured)}
          teamSize={parseInt(teamSize)}
          minutesPerHalf={minutesPerHalf}
          onStartPlan={handleStartAutoSubPlan}
          existingPlan={autoSubActive ? autoSubPlan : undefined}
          editMode={autoSubPlanEditMode}
          rotationSpeed={rotationSpeed}
          disablePositionSwaps={disablePositionSwaps}
          disableBatchSubs={disableBatchSubs}
          rotateGkAtHalftime={rotateGkAtHalftime}
          maxSpreadMinutes={maxSpreadMinutes}
          currentElapsedSeconds={autoSubFromPreGame ? 0 : (gameTimerRef.current?.getElapsedSeconds() || 0)}
          currentHalf={autoSubFromPreGame ? 1 : (gameTimerRef.current?.getCurrentHalf() || 1)}
          showStepper={autoSubFromPreGame}
          onBackToLineup={autoSubFromPreGame ? () => { setAutoSubPlanDialogOpen(false); setShowLineupPicker(true); } : undefined}
          miniLeagueTeams={miniLeagueTeams}
          preferredSecondHalfGkId={preferredSecondHalfGkId}
          onLineupChange={(updatedPlayers) => {
            // Sync priority-bias starter↔bench swaps back to the pitch so
            // the active lineup matches the plan that's about to run.
            setPlayers(prev => prev.map(p => {
              const u = updatedPlayers.find(x => x.id === p.id);
              if (!u) return p;
              if (u.position === p.position && u.currentPitchPosition === p.currentPitchPosition) return p;
              return { ...p, position: u.position, currentPitchPosition: u.currentPitchPosition };
            }));
          }}
        />

        {/* Sub Confirm Dialog */}
        <SubConfirmDialog
          open={subConfirmDialogOpen}
          onOpenChange={setSubConfirmDialogOpen}
          substitution={pendingAutoSub}
          onConfirm={handleConfirmAutoSub}
          onSkip={handleSkipAutoSub}
          onAcknowledgeHalftime={handleAcknowledgeHalftimePrompt}
          players={players}
        />

        {/* Manual Sub Confirm Dialog */}
        <ManualSubConfirmDialog
          open={manualSubConfirmOpen}
          onOpenChange={setManualSubConfirmOpen}
          playerOut={players.find(p => p.id === pendingManualSub?.pitchPlayerId) || null}
          playerIn={players.find(p => p.id === pendingManualSub?.benchPlayerId) || null}
          positionSwap={pendingManualSub?.swapPlayerId ? (() => {
            const pitchPlayer = players.find(p => p.id === pendingManualSub.pitchPlayerId);
            const swapPlayer = players.find(p => p.id === pendingManualSub.swapPlayerId);
            if (!swapPlayer || !pitchPlayer?.currentPitchPosition || !swapPlayer.currentPitchPosition) return null;
            return {
              player: swapPlayer,
              fromPosition: swapPlayer.currentPitchPosition,
              toPosition: pitchPlayer.currentPitchPosition,
            };
          })() : null}
          onConfirm={handleConfirmManualSub}
          onCancel={handleCancelManualSub}
        />

        {/* Pitch Position Swap Confirm Dialog */}
        <PitchSwapConfirmDialog
          open={pitchSwapConfirmOpen}
          onOpenChange={setPitchSwapConfirmOpen}
          player1={players.find(p => p.id === swapPlayer1) || null}
          player2={players.find(p => p.id === swapPlayer2) || null}
          allPitchPlayers={players.filter(p => p.position !== null)}
          onConfirm={handleConfirmPitchSwap}
          onCancel={handleCancelPitchSwap}
          onConfirmWithAccommodation={handleConfirmPitchSwapWithAccommodation}
        />

        {/* Swap Before Sub Dialog (step 1 of swap-based substitution) */}
        <PitchSwapConfirmDialog
          open={swapBeforeSubDialogOpen}
          onOpenChange={(open) => {
            // Don't cancel on close - only cancel via the Cancel button
            // This prevents clearing pendingSwapBasedSub when transitioning to next dialog
          }}
          player1={players.find(p => p.id === pendingSwapBasedSub?.swapPlayerId) || null}
          player2={players.find(p => p.id === pendingSwapBasedSub?.pitchPlayerId) || null}
          onConfirm={handleConfirmSwapBeforeSub}
          onCancel={handleCancelSwapBasedSub}
        />

        {/* Sub After Swap Dialog (step 2 of swap-based substitution) */}
        <ManualSubConfirmDialog
          open={subAfterSwapDialogOpen}
          onOpenChange={(open) => {
            // Don't cancel on close - only cancel via the Cancel button
            // This allows the substitution to complete before state is cleared
          }}
          playerOut={players.find(p => p.id === pendingSwapBasedSub?.pitchPlayerId) || null}
          playerIn={players.find(p => p.id === pendingSwapBasedSub?.benchPlayerId) || null}
          onConfirm={handleConfirmSubAfterSwap}
          onCancel={handleCancelSwapBasedSub}
        />

        {/* Landscape Event Selector Sheet - allow linking mid-game if no event linked */}
        {!readOnly && (!gameInProgress || !linkedEventId) && (
          <LandscapeEventSelector
            open={landscapeEventSelectorOpen}
            onOpenChange={setLandscapeEventSelectorOpen}
            teamId={teamId}
            currentEventId={linkedEventId}
            onSelectEvent={(eventId) => {
              handleLinkEvent(eventId);
              setLandscapeEventSelectorOpen(false);
            }}
          />
        )}

        {/* Pitch Player Action Menu (injury on pitch) - landscape */}
        <Suspense fallback={null}>
          <PitchPlayerActionMenu
            open={pitchPlayerActionOpen}
            onOpenChange={(open) => {
              setPitchPlayerActionOpen(open);
              if (!open) setPitchPlayerActionTarget(null);
            }}
            player={players.find(p => p.id === pitchPlayerActionTarget) || null}
            benchPlayers={players.filter(p => p.position === null)}
            onMarkInjured={handleMarkInjuredOnPitch}
          />
        </Suspense>

        {/* Bench Injury Confirmation - landscape */}
        <AlertDialog open={benchInjuryConfirmOpen} onOpenChange={(open) => { if (!open) { setBenchInjuryConfirmOpen(false); setBenchInjuryTarget(null); } }}>
          <AlertDialogContent className="z-[999999]">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {players.find(p => p.id === benchInjuryTarget)?.isInjured ? "Mark as Fit?" : "Mark as Injured?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {players.find(p => p.id === benchInjuryTarget)?.isInjured
                  ? `${players.find(p => p.id === benchInjuryTarget)?.name} will be available for substitutions again.`
                  : `${players.find(p => p.id === benchInjuryTarget)?.name} will not be available for substitutions.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => { setBenchInjuryConfirmOpen(false); setBenchInjuryTarget(null); }}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (benchInjuryTarget) togglePlayerInjury(benchInjuryTarget);
                  setBenchInjuryConfirmOpen(false);
                  setBenchInjuryTarget(null);
                }}
              >
                {players.find(p => p.id === benchInjuryTarget)?.isInjured ? "Mark Fit" : "Mark Injured"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Match Stats Panel */}
        <MatchStatsPanel
          open={statsOpen}
          onOpenChange={setStatsOpen}
          players={players}
          elapsedGameTime={elapsedGameTime}
          goals={goals}
          teamName={teamName}
          opponentName={opponentName}
          hideScores={hideScores}
        />

        {/* Reset Game Confirmation - landscape */}
        <AlertDialog open={resetGameConfirmOpen} onOpenChange={setResetGameConfirmOpen}>
          <AlertDialogContent className="z-[999999]">
            <AlertDialogHeader>
              <AlertDialogTitle>Reset Game?</AlertDialogTitle>
              <AlertDialogDescription>
                This will clear all player minutes, timer, substitutions, goals, and reset positions. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => { handleResetGame(); setResetGameConfirmOpen(false); }}
              >
                Reset Game
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Auto-Sub Control Panel - landscape */}
        {autoSubPanelOpen && autoSubActive && (
          <Suspense fallback={<DialogLoader />}>
            <AutoSubControlPanel
              autoSubPlan={autoSubPlan}
              autoSubPaused={autoSubPaused}
              players={players}
              lockedPlayerIds={lockedPlayerIds}
              currentElapsedSeconds={gameTimerRef.current?.getElapsedSeconds() || 0}
              currentHalf={gameTimerRef.current?.getCurrentHalf() || 1}
              minutesPerHalf={minutesPerHalf}
              onTogglePause={handleTogglePauseAutoSub}
              onCancelPlan={() => setCancelPlanConfirmOpen(true)}
              onSkipNext={handleSkipNextSub}
              onExecuteNow={handleExecuteNow}
              onEditPlan={() => { handleOpenEditPlan(); setAutoSubPanelOpen(false); }}
              onRegeneratePlan={handleRegeneratePlan}
              onToggleLockPlayer={handleToggleLockPlayer}
              onClose={() => setAutoSubPanelOpen(false)}
            />
          </Suspense>
        )}

        {/* Pre-Game Lineup Screen - landscape */}
        {showLineupPicker && (
          <Suspense fallback={<DialogLoader />}>
            <PreGameLineupScreen
              players={players}
              teamSize={teamSize}
              selectedFormation={selectedFormation}
              rotateGkAtHalftime={rotateGkAtHalftime}
              onConfirm={handleLineupConfirm}
              onSkip={handleLineupSkip}
              onClose={() => setShowLineupPicker(false)}
              onTeamSizeChange={(size) => setTeamSize(size)}
              onFormationChange={(index) => setSelectedFormation(index)}
              rotationSpeed={rotationSpeed}
              onRotationSpeedChange={setRotationSpeed}
            />
          </Suspense>
        )}
      </div>,
      document.body
    );
}
