import { createContext, useContext } from "react";
import type React from "react";
import type {
  Player,
  SubstitutionEvent,
  TeamSize,
  DrawingTool,
  Goal,
  MiniLeagueTeams,
} from "./types";
import type { PitchPosition } from "./PositionBadge";
import type { GameTimerRef } from "./GameTimer";

/**
 * Shared context bag passed from PitchBoard to its landscape & portrait
 * layout children. ~272 fields. Generated semi-automatically: state vars,
 * refs, and props are typed; values destructured from custom hooks
 * (useAutoSubs, useDragSwapHintToast, etc) fall back to `any` and can be
 * tightened individually as needed.
 */
export interface PitchBoardLayoutContextValue {
  autoSubActive: boolean;
  autoSubFromPreGame: boolean;
  autoSubPanelOpen: boolean;
  autoSubPaused: boolean;
  autoSubPlan: SubstitutionEvent[];

  autoSubPlanDialogOpen: boolean;
  autoSubPlanEditMode: boolean;
  ballOffset: any;
  ballPosition: any;
  benchDragPlayer: string | null;
  benchDragPos: { x: number; y: number } | null;
  benchInjuryConfirmOpen: boolean;
  benchInjuryTarget: string | null;
  benchLongPressTimer: any;
  benchPositionFilter: PitchPosition | null;
  benchToSubOpen: any;
  benchToSubPlayer: any;
  cancelPlanConfirmOpen: boolean;
  canvasRef: React.MutableRefObject<HTMLCanvasElement>;
  clearDrawings: any;
  containerRef: React.MutableRefObject<HTMLDivElement>;
  disableAutoSubs: boolean;
  disableBatchSubs: any;
  disablePositionSwaps: any;
  draggedPlayer: any;
  drawingColor: string;
  drawingEnabled: any;
  drawingTool: DrawingTool;
  elapsedGameTime: number;
  fillInDialogOpen: any;
  filteredPlayersOnPitch: any;
  floatingTimerPosition: any;
  floatingTimerScale: any;
  formationChangeDialogOpen: any;
  formationName: string;
  gameInProgress: any;
  gameTimerRef: React.MutableRefObject<GameTimerRef>;
  getPlayerTeamColor: (...args: any[]) => any;
  getValidBenchPlayerIds: any;
  getValidSwapPlayerIds: any;
  goals: Goal[];
  handleAddFillInPlayer: any;
  handleAddGoal: (...args: any[]) => any;
  handleApplyTacticalSuggestion: any;
  handleBallDrag: any;
  handleBallDragEnd: any;
  handleBallDragStart: any;
  handleBallTouchEnd: any;
  handleBallTouchMove: any;
  handleBallTouchStart: any;
  handleBenchDrop: any;
  handleBenchLongPressEnd: (...args: any[]) => any;
  handleBenchLongPressMove: (...args: any[]) => any;
  handleBenchLongPressStart: (...args: any[]) => any;
  handleBenchToSubSelect: any;
  handleCancelAutoSubPlan: () => void;
  handleCancelManualSub: any;
  handleCancelPitchSwap: (...args: any[]) => any;
  handleCancelSwapBasedSub: (...args: any[]) => any;
  handleConfirmAutoSub: () => void;
  handleAcknowledgeHalftimePrompt: () => void;
  handleConfirmManualSub: any;
  handleConfirmPitchSwap: (...args: any[]) => any;
  handleConfirmPitchSwapWithAccommodation: (...args: any[]) => any;
  handleConfirmSubAfterSwap: (...args: any[]) => any;
  handleConfirmSwapBeforeSub: (...args: any[]) => any;
  handleDismissTacticalSuggestion: any;
  handleDragEnd: any;
  handleDragOver: any;
  handleDragStart: any;
  handleExecuteNow: () => void;
  handleFormationChange: any;
  handleFormationChangeCancel: any;
  handleFormationChangeConfirm: any;
  handleHalfChange: (...args: any[]) => any;
  handleLineupConfirm: any;
  handleLineupSkip: any;
  handleLinkEvent: any;
  handleMarkInjuredOnPitch: (...args: any[]) => any;
  handleMaxSpreadMinutesChange: (...args: any[]) => any;
  handleMinutesPerHalfChange: (...args: any[]) => any;
  handleMockModeChange: (...args: any[]) => any;
  handleOpenEditPlan: (...args: any[]) => any;
  handlePitchDrop: any;
  handlePitchTouchEnd: (...args: any[]) => any;
  handlePitchTouchMove: (...args: any[]) => any;
  handlePitchTouchStart: (...args: any[]) => any;
  handlePlayerClick: (...args: any[]) => any;
  handlePortraitTimerTouchStart: any;
  handleRegeneratePlan: () => void;
  handleRemoveFillInPlayer: any;
  handleRemoveGoal: (...args: any[]) => any;
  handleResetFormation: (...args: any[]) => any;
  handleResetGame: (...args: any[]) => any;
  handleRotationSpeedChange: (...args: any[]) => any;
  handleSaveSettings: any;
  handleSetupGame: (...args: any[]) => any;
  handleShowLineupPickerSettingChange: (...args: any[]) => any;
  handleSkipAutoSub: () => void;
  handleSkipNextSub: () => void;
  handleStartAutoSubPlan: (plan: SubstitutionEvent[]) => void;

  handleSubPreviewSelect: (...args: any[]) => any;
  handleSwapAndSubstitute: (...args: any[]) => any;
  handleTacticalModeChange: any;
  handleTeamSizeChange: (...args: any[]) => any;
  handleTimerDragStart: any;
  handleTimerTouchStart: any;
  handleTimerUpdate: any;
  handleToggleLockPlayer: (playerId: string) => void;
  handleTogglePauseAutoSub: () => void;

  handleTouchStart: any;
  handleUndo: (...args: any[]) => any;
  handleUnlinkEvent: (...args: any[]) => any;
  handleUpdateGoal: (...args: any[]) => any;
  handleUpdatePositions: (...args: any[]) => any;
  handleWheel: any;
  hideScores: boolean;
  ignoreNextLandscapeBackdropClickRef: React.MutableRefObject<any>;
  ignoreNextLandscapeBenchOpenRef: React.MutableRefObject<any>;
  isDraggingBall: any;
  isDrawingArrowRef: any;
  isLandscape: any;
  isSavingSettings: any;
  isSubsManager: boolean;
  landscapeEventSelectorOpen: boolean;
  lastTapRef: React.MutableRefObject<{ playerId: string; time: number } | null>;
  linkedEventDetails: any;
  linkedEventId: any;
  lockedPlayerIds: Set<string>;
  manualSubConfirmOpen: any;
  maxSpreadMinutes: any;
  members: any;
  miniLeagueTeams: MiniLeagueTeams;
  minutesPerHalf: any;
  mockMode: any;
  movablePitchPlayerIds: any;
  nextSubInfo: { playerInId: string; playerOutId: string; countdown: string } | null;
  onClose: () => void;
  onUnlinkEvent: () => void;
  openAutoSubPlanDialog: (...args: any[]) => any;
  opponentName: any;
  pendingAutoSub: SubstitutionEvent | null;
  pendingBatchSubs: SubstitutionEvent[];

  pendingFormationChange: any;
  pendingManualSub: any;
  pendingSubBenchPlayer: string | null;
  pendingSwapBasedSub: {
    pitchPlayerId: string;
    benchPlayerId: string;
    swapPlayerId: string;
  } | null;
  pinDrawingToolbar: boolean;
  pitchPlayerActionOpen: boolean;
  pitchPlayerActionTarget: string | null;
  pitchSwapConfirmOpen: boolean;
  players: Player[];
  playersOnBench: any;
  playersOnPitch: any;
  portraitSheetDragRef: React.MutableRefObject<{ startY: number; startPct: number } | null>;
  portraitSheetHeightPct: number;
  portraitSheetOpen: boolean;
  portraitTimerPosition: any;
  portraitTimerScale: any;
  positionEditorOpen: boolean;
  positionSwapDialogOpen: boolean;
  preferredSecondHalfGkId: string | undefined;
  previewSwapPlayers: { sourceId: string | null; targetId: string | null };
  readOnly: boolean;
  recentlyDraggedRef: any;
  requiredPosition: PitchPosition | null;
  resetGameConfirmOpen: boolean;
  rotateGkAtHalftime: any;
  rotationSpeed: any;
  selectedFormation: any;
  selectedOnBench: any;
  selectedOnPitch: any;
  selectedTeamForSettings: "a" | "b" | "both";
  setAutoSubPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setAutoSubPlanDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setBenchInjuryConfirmOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setBenchInjuryTarget: React.Dispatch<React.SetStateAction<string | null>>;
  setBenchPositionFilter: React.Dispatch<React.SetStateAction<PitchPosition | null>>;
  setBenchToSubOpen: any;
  setBenchToSubPlayer: any;
  setBottomSheetTab: React.Dispatch<React.SetStateAction<"bench" | "setup">>;
  setCancelPlanConfirmOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDisableBatchSubs: React.Dispatch<React.SetStateAction<any>>;
  setDisablePositionSwaps: React.Dispatch<React.SetStateAction<any>>;
  setDrawingColor: React.Dispatch<React.SetStateAction<string>>;
  setDrawingTool: React.Dispatch<React.SetStateAction<DrawingTool>>;
  setFillInDialogOpen: any;
  setFormationChangeDialogOpen: any;
  setHideScores: React.Dispatch<React.SetStateAction<boolean>>;
  setLandscapeEventSelectorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setManualSubConfirmOpen: any;
  setPendingSubBenchPlayer: React.Dispatch<React.SetStateAction<string | null>>;
  setPinDrawingToolbar: React.Dispatch<React.SetStateAction<boolean>>;
  setPitchPlayerActionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPitchPlayerActionTarget: React.Dispatch<React.SetStateAction<string | null>>;
  setPitchSwapConfirmOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPlayers: React.Dispatch<React.SetStateAction<Player[]>>;
  setPortraitSheetHeightPct: React.Dispatch<React.SetStateAction<number>>;
  setPortraitSheetOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPositionEditorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPositionSwapDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPreviewSwapPlayers: React.Dispatch<React.SetStateAction<{ sourceId: string | null; targetId: string | null }>>;
  setRequiredPosition: React.Dispatch<React.SetStateAction<PitchPosition | null>>;
  setResetGameConfirmOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setRotateGkAtHalftime: React.Dispatch<React.SetStateAction<any>>;
  setRotationSpeed: React.Dispatch<React.SetStateAction<any>>;
  setSelectedFormation: React.Dispatch<React.SetStateAction<any>>;
  setSelectedOnBench: any;
  setSelectedOnPitch: any;
  setSelectedTeamForSettings: React.Dispatch<React.SetStateAction<"a" | "b" | "both">>;
  setSettingsDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSettingsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSheetHeightPct: React.Dispatch<React.SetStateAction<number>>;
  setShowFloatingDrawToolbar: React.Dispatch<React.SetStateAction<boolean>>;
  setShowLineupPicker: React.Dispatch<React.SetStateAction<any>>;
  setShowMatchHeader: React.Dispatch<React.SetStateAction<any>>;
  setStatsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSubConfirmDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSubPreviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setTeamSize: React.Dispatch<React.SetStateAction<TeamSize>>;
  setTimerFormationDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setTimerTacticalDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setToolbarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setTouchDragPlayer: any;
  setTouchOffset: any;
  settingsDialogOpen: boolean;
  settingsMenuOpen: boolean;
  sheetDragRef: React.MutableRefObject<{ startY: number; startPct: number } | null>;
  sheetHeightPct: number;
  showFloatingDrawToolbar: boolean;
  showFloatingUndo: boolean;
  showLineupPicker: any;
  showLineupPickerSetting: any;
  showMatchHeader: any;
  showScoreInPortrait: boolean;
  statsOpen: boolean;
  subAfterSwapDialogOpen: boolean;
  subAnimationPlayers: { in: string | null; out: string | null; swap: string | null };
  subConfirmDialogOpen: boolean;
  subDuePlayerIds: Set<string>;

  subMode: any;
  subPreviewOpen: boolean;
  swapBeforeSubDialogOpen: boolean;
  swapFlashIds: string[];
  swapMode: boolean;
  swapPlayer1: string | null;
  swapPlayer2: string | null;
  tacticalFormationSuggestion: any;
  tacticalMode: any;
  tacticalOffsets: any;
  teamId: string;
  teamName: string;
  teamSize: TeamSize;
  timerFormationDropdownOpen: boolean;
  timerResetKey: any;
  timerTacticalDropdownOpen: boolean;
  togglePlayerInjury: (...args: any[]) => any;
  toggleSubMode: (...args: any[]) => any;
  toggleSwapMode: (...args: any[]) => any;
  toolbarCollapsed: boolean;
  touchDragPlayer: any;
  touchHandledRef: React.MutableRefObject<any>;
  touchIdRef: any;
  undoHistory: { players: Player[]; description: string }[];
  user: any;
  zoom: any;
  pitchZoomScrollRef: React.RefCallback<HTMLDivElement>;
}


export const PitchBoardLayoutContext =
  createContext<PitchBoardLayoutContextValue | null>(null);

export const usePitchBoardLayoutContext = (): PitchBoardLayoutContextValue => {
  const ctx = useContext(PitchBoardLayoutContext);
  if (!ctx) {
    throw new Error(
      "usePitchBoardLayoutContext must be used within a PitchBoardLayoutContext.Provider"
    );
  }
  return ctx;
};
