import { PitchPosition } from "./PositionBadge";

export interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null; // null = on bench
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
  minutesPlayed?: number; // Total seconds played (displayed as minutes)
  isInjured?: boolean; // Player is injured and cannot be subbed on
  isFillIn?: boolean; // Temporary fill-in player (not part of regular team roster)
  teamSide?: "a" | "b"; // For mini-league two-team mode
}

// Mini-league two-team configuration
export interface MiniLeagueTeams {
  teamAPlayerIds: string[];
  teamBPlayerIds: string[];
  teamAColor: string;
  teamBColor: string;
  teamAName?: string;
  teamBName?: string;
}

export interface SubstitutionEvent {
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

export type TeamSize = "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "11";
export type DrawingTool = "none" | "pen" | "arrow";

// Formation definitions
export const FORMATIONS: Record<TeamSize, { name: string; positions: { x: number; y: number }[] }[]> = {
  "3": [
    { name: "1-1-1", positions: [{ x: 50, y: 85 }, { x: 50, y: 55 }, { x: 50, y: 25 }] },
    { name: "2-1", positions: [{ x: 35, y: 80 }, { x: 65, y: 80 }, { x: 50, y: 30 }] },
    { name: "1-2", positions: [{ x: 50, y: 85 }, { x: 35, y: 30 }, { x: 65, y: 30 }] },
  ],
  "4": [
    { name: "1-2-1", positions: [{ x: 50, y: 85 }, { x: 25, y: 55 }, { x: 75, y: 55 }, { x: 50, y: 25 }] },
    { name: "2-1-1", positions: [{ x: 35, y: 85 }, { x: 65, y: 85 }, { x: 50, y: 55 }, { x: 50, y: 25 }] },
    { name: "1-1-2", positions: [{ x: 50, y: 85 }, { x: 50, y: 55 }, { x: 35, y: 25 }, { x: 65, y: 25 }] },
  ],
  "5": [
    { name: "1-2-1-1", positions: [{ x: 50, y: 88 }, { x: 30, y: 68 }, { x: 70, y: 68 }, { x: 50, y: 45 }, { x: 50, y: 22 }] },
    { name: "2-1-2", positions: [{ x: 35, y: 85 }, { x: 65, y: 85 }, { x: 50, y: 50 }, { x: 35, y: 22 }, { x: 65, y: 22 }] },
    { name: "1-3-1", positions: [{ x: 50, y: 88 }, { x: 25, y: 55 }, { x: 50, y: 55 }, { x: 75, y: 55 }, { x: 50, y: 22 }] },
    { name: "2-2-1", positions: [{ x: 35, y: 85 }, { x: 65, y: 85 }, { x: 35, y: 50 }, { x: 65, y: 50 }, { x: 50, y: 22 }] },
  ],
  "6": [
    { name: "2-2-1", positions: [{ x: 50, y: 90 }, { x: 30, y: 72 }, { x: 70, y: 72 }, { x: 30, y: 45 }, { x: 70, y: 45 }, { x: 50, y: 20 }] },
    { name: "1-3-1", positions: [{ x: 50, y: 90 }, { x: 50, y: 72 }, { x: 25, y: 48 }, { x: 50, y: 48 }, { x: 75, y: 48 }, { x: 50, y: 20 }] },
    { name: "2-1-2", positions: [{ x: 50, y: 90 }, { x: 30, y: 72 }, { x: 70, y: 72 }, { x: 50, y: 48 }, { x: 35, y: 20 }, { x: 65, y: 20 }] },
  ],
  "7": [
    { name: "2-3-1", positions: [{ x: 50, y: 90 }, { x: 30, y: 70 }, { x: 70, y: 70 }, { x: 20, y: 45 }, { x: 50, y: 45 }, { x: 80, y: 45 }, { x: 50, y: 20 }] },
    { name: "3-2-1", positions: [{ x: 50, y: 90 }, { x: 25, y: 70 }, { x: 50, y: 70 }, { x: 75, y: 70 }, { x: 35, y: 40 }, { x: 65, y: 40 }, { x: 50, y: 18 }] },
    { name: "2-2-2", positions: [{ x: 50, y: 90 }, { x: 30, y: 70 }, { x: 70, y: 70 }, { x: 30, y: 40 }, { x: 70, y: 40 }, { x: 35, y: 18 }, { x: 65, y: 18 }] },
  ],
  "8": [
    { name: "3-3-1", positions: [{ x: 50, y: 90 }, { x: 25, y: 72 }, { x: 50, y: 72 }, { x: 75, y: 72 }, { x: 25, y: 48 }, { x: 50, y: 48 }, { x: 75, y: 48 }, { x: 50, y: 20 }] },
    { name: "2-3-2", positions: [{ x: 50, y: 90 }, { x: 30, y: 72 }, { x: 70, y: 72 }, { x: 25, y: 48 }, { x: 50, y: 48 }, { x: 75, y: 48 }, { x: 35, y: 20 }, { x: 65, y: 20 }] },
    { name: "3-2-2", positions: [{ x: 50, y: 90 }, { x: 25, y: 72 }, { x: 50, y: 72 }, { x: 75, y: 72 }, { x: 35, y: 48 }, { x: 65, y: 48 }, { x: 35, y: 20 }, { x: 65, y: 20 }] },
  ],
  "9": [
    { name: "3-3-2", positions: [{ x: 50, y: 90 }, { x: 25, y: 72 }, { x: 50, y: 72 }, { x: 75, y: 72 }, { x: 25, y: 48 }, { x: 50, y: 48 }, { x: 75, y: 48 }, { x: 35, y: 20 }, { x: 65, y: 20 }] },
    { name: "3-2-3", positions: [{ x: 50, y: 90 }, { x: 25, y: 72 }, { x: 50, y: 72 }, { x: 75, y: 72 }, { x: 35, y: 48 }, { x: 65, y: 48 }, { x: 25, y: 20 }, { x: 50, y: 20 }, { x: 75, y: 20 }] },
    { name: "2-4-2", positions: [{ x: 50, y: 90 }, { x: 30, y: 72 }, { x: 70, y: 72 }, { x: 20, y: 48 }, { x: 40, y: 48 }, { x: 60, y: 48 }, { x: 80, y: 48 }, { x: 35, y: 20 }, { x: 65, y: 20 }] },
  ],
  "10": [
    { name: "3-4-2", positions: [{ x: 50, y: 90 }, { x: 25, y: 74 }, { x: 50, y: 74 }, { x: 75, y: 74 }, { x: 20, y: 50 }, { x: 40, y: 50 }, { x: 60, y: 50 }, { x: 80, y: 50 }, { x: 35, y: 22 }, { x: 65, y: 22 }] },
    { name: "4-3-2", positions: [{ x: 50, y: 90 }, { x: 20, y: 74 }, { x: 40, y: 74 }, { x: 60, y: 74 }, { x: 80, y: 74 }, { x: 30, y: 50 }, { x: 50, y: 50 }, { x: 70, y: 50 }, { x: 35, y: 22 }, { x: 65, y: 22 }] },
    { name: "3-3-3", positions: [{ x: 50, y: 90 }, { x: 25, y: 74 }, { x: 50, y: 74 }, { x: 75, y: 74 }, { x: 25, y: 50 }, { x: 50, y: 50 }, { x: 75, y: 50 }, { x: 25, y: 22 }, { x: 50, y: 22 }, { x: 75, y: 22 }] },
  ],
  "11": [
    { name: "4-4-2", positions: [{ x: 50, y: 92 }, { x: 20, y: 75 }, { x: 40, y: 75 }, { x: 60, y: 75 }, { x: 80, y: 75 }, { x: 20, y: 50 }, { x: 40, y: 50 }, { x: 60, y: 50 }, { x: 80, y: 50 }, { x: 35, y: 22 }, { x: 65, y: 22 }] },
    { name: "4-3-3", positions: [{ x: 50, y: 92 }, { x: 20, y: 75 }, { x: 40, y: 75 }, { x: 60, y: 75 }, { x: 80, y: 75 }, { x: 30, y: 50 }, { x: 50, y: 50 }, { x: 70, y: 50 }, { x: 25, y: 22 }, { x: 50, y: 22 }, { x: 75, y: 22 }] },
    { name: "3-5-2", positions: [{ x: 50, y: 92 }, { x: 25, y: 75 }, { x: 50, y: 75 }, { x: 75, y: 75 }, { x: 15, y: 50 }, { x: 35, y: 50 }, { x: 50, y: 50 }, { x: 65, y: 50 }, { x: 85, y: 50 }, { x: 35, y: 22 }, { x: 65, y: 22 }] },
    { name: "4-2-3-1", positions: [{ x: 50, y: 92 }, { x: 20, y: 75 }, { x: 40, y: 75 }, { x: 60, y: 75 }, { x: 80, y: 75 }, { x: 35, y: 55 }, { x: 65, y: 55 }, { x: 25, y: 35 }, { x: 50, y: 35 }, { x: 75, y: 35 }, { x: 50, y: 18 }] },
  ],
};

// Map formation positions to pitch positions based on Y coordinate
export const getPositionFromCoords = (y: number, teamSize: TeamSize): PitchPosition => {
  // 3-a-side, 4-a-side, 5-a-side, and 6-a-side have no goalkeeper - all outfield positions
  if (teamSize === "3" || teamSize === "4" || teamSize === "5" || teamSize === "6") {
    if (y > 70) return "DEF";
    if (y > 40) return "MID";
    return "FWD";
  }
  // GK is always at the back (y > 80) for other team sizes
  if (y > 80) return "GK";
  // Defenders (y > 60)
  if (y > 60) return "DEF";
  // Midfielders (y > 30)
  if (y > 30) return "MID";
  // Forwards (y <= 30)
  return "FWD";
};

// Get a specific position label based on x and y coordinates (e.g., "Left Mid", "Centre Def")
export const getSpecificPositionLabel = (
  x: number | undefined | null,
  basePosition: PitchPosition
): string => {
  if (basePosition === "GK") return "Goalkeeper";
  if (x == null) return basePosition;
  const side = x < 35 ? "Left" : x > 65 ? "Right" : "Centre";
  const posName = basePosition === "DEF" ? "Back" : basePosition === "MID" ? "Mid" : "Forward";
  return `${side} ${posName}`;
};

// Local storage keys
export const PITCH_STATE_KEY = "ignite-pitch-board-state"; // Base key / active game key
export const PITCH_STATE_KEY_BASE = "ignite-pitch-board-state-team";
export const getPitchStateKey = (teamId: string) => `${PITCH_STATE_KEY_BASE}-${teamId}`;
export const PITCH_BOARD_OPEN_KEY = "ignite-pitch-board-open";
export const PITCH_BOARD_OPEN_PATH_KEY = "ignite-pitch-board-open-path";
// Epoch ms of the last time a pitch board was mounted. Used by
// PitchBoardResumeRedirect to decide whether the persisted open flag is a
// genuine "board was open when the OS suspended us" signal (recent) or stale
// leftovers from an older run — replaces the brittle performance.now() < 8s
// cold-start heuristic, which failed on slow cold starts (auth + theme +
// legal gate) where the redirect only mounts after 8s have already elapsed.
export const PITCH_BOARD_OPEN_AT_KEY = "ignite-pitch-board-open-at";
// JSON-encoded {teamId, teamName, readOnly} of the most recently opened
// pitch board. Used to re-open the modal after a WebView cold restart
// (phone lock/unlock) when the board was opened as an overlay on the
// home page (no dedicated route to restore).
export const PITCH_BOARD_LAST_CONTEXT_KEY = "ignite-pitch-board-last-context";
// Epoch ms of the last time the app was backgrounded / hidden (phone lock,
// app switch). A route change observed while backgrounded — or shortly after
// resuming — is native WebView route drift, NOT a deliberate user navigation,
// so it must never clear the pitch-board open marker.
export const PITCH_BOARD_BACKGROUNDED_AT_KEY = "ignite-pitch-board-backgrounded-at";
export const TIMER_STORAGE_KEY = 'pitch-board-timer-state';

// Goal tracking interface
export interface Goal {
  id: string;
  scorerId?: string; // Player ID who scored (optional for opponent goals)
  scorerName?: string; // Player name (for display)
  time: number; // Game seconds when scored
  half: 1 | 2;
  isOpponentGoal: boolean;
  isOwnGoal?: boolean; // Goal credited to opposing side but scored by one of our players
  teamSide?: "a" | "b"; // For mini-league mode: which team scored
}

// Pitch board state persistence interface
export interface PitchBoardState {
  teamId: string;
  players: Player[];
  teamSize: TeamSize;
  selectedFormation: number;
  ballPosition: { x: number; y: number };
  autoSubPlan: SubstitutionEvent[];
  autoSubActive: boolean;
  autoSubPaused: boolean;
  mockMode: boolean;
  lastUpdateTime: number;
  lastTimerSeconds?: number;
  linkedEventId?: string | null; // Link to a game event for stats tracking
  executedSubs?: SubstitutionEvent[]; // Track executed substitutions for stats
  goals?: Goal[]; // Track goals scored during the game
}

export interface TimerState {
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
