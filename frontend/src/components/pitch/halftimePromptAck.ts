type TimerLike = {
  teamId?: string | null;
  minutesPerHalf?: number | null;
  currentHalf?: number | null;
  elapsedSeconds?: number | null;
  isRunning?: boolean | null;
  lastUpdateTime?: number | null;
};

type PitchLike = {
  teamId?: string | null;
  linkedEventId?: string | null;
  lastUpdateTime?: number | null;
};

const STORAGE_KEY = "pitch-board-halftime-ack-v1";
const MAX_ACKS = 200;
const MAX_ACK_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const readAcks = (): Record<string, number> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeAcks = (acks: Record<string, number>) => {
  try {
    const now = Date.now();
    const pruned = Object.fromEntries(
      Object.entries(acks)
        .filter(([, ts]) => typeof ts === "number" && now - ts <= MAX_ACK_AGE_MS)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_ACKS)
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
  } catch {
    // ignore storage failures
  }
};

const safePart = (value: unknown) => String(value ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");

export const getHalftimePromptAckKey = (
  timerState: TimerLike | null | undefined,
  pitchState: PitchLike | null | undefined
): string | null => {
  const teamId = timerState?.teamId || pitchState?.teamId;
  if (!teamId) return null;

  const eventId = pitchState?.linkedEventId;
  const minutes = timerState?.minutesPerHalf || "na";
  const halfMs = (Number(minutes) || 0) * 60_000;
  const lastUpdate = timerState?.lastUpdateTime || pitchState?.lastUpdateTime || 0;
  const elapsedMs = (timerState?.elapsedSeconds || 0) * 1000;
  const estimatedKickoff = timerState?.currentHalf === 2 && timerState?.elapsedSeconds === 0 && !timerState?.isRunning
    ? lastUpdate - halfMs
    : lastUpdate - elapsedMs;
  const kickoffBucket = estimatedKickoff > 0 ? Math.round(estimatedKickoff / 60_000) : 0;
  const gamePart = eventId ? `event-${eventId}` : `local-${kickoffBucket}`;

  return `half-time:${safePart(teamId)}:${safePart(gamePart)}:${safePart(minutes)}`;
};

export const hasAcknowledgedHalftimePrompt = (key: string | null | undefined): boolean => {
  if (!key) return false;
  const ts = readAcks()[key];
  return typeof ts === "number" && Date.now() - ts <= MAX_ACK_AGE_MS;
};

export const acknowledgeHalftimePrompt = (key: string | null | undefined): void => {
  if (!key) return;
  const acks = readAcks();
  acks[key] = Date.now();
  writeAcks(acks);
};

/**
 * Single source of truth for whether the informational "Half Time" prompt
 * (or any halftime-only auto-sub dialog) is allowed to open right now.
 *
 * Returns true only when:
 *   1. The user has NOT already acknowledged this game's halftime prompt
 *   2. The timer is actually parked on the genuine halftime boundary —
 *      currentHalf === 2, elapsedSeconds <= 5, isRunning === false
 *
 * Every site that opens the halftime dialog (PitchBoard handleHalfChange,
 * useAutoSubScheduler.checkHalftimeSubs, GlobalSubMonitor) MUST call this
 * before flipping `subConfirmDialogOpen = true` so stale mid-game prompts
 * cannot leak through (e.g. on reconcile, push-launch, or a delayed
 * setTimeout firing after the second half has resumed).
 */
export const canShowHalftimePrompt = (
  timerState: TimerLike | null | undefined,
  pitchState: PitchLike | null | undefined
): boolean => {
  if (!timerState) return false;
  if (timerState.currentHalf !== 2) return false;
  if ((timerState.elapsedSeconds || 0) > 5) return false;
  if (timerState.isRunning) return false;
  const ackKey = getHalftimePromptAckKey(timerState, pitchState);
  if (hasAcknowledgedHalftimePrompt(ackKey)) return false;
  return true;
};