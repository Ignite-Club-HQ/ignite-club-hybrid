/**
 * Cheap stable signature for board + timer state used by the sync hooks
 * (basketball + netball) to skip writes when nothing meaningful has changed.
 *
 * We deliberately ignore `lastUpdateTime` (changes every state mutation
 * without representing real game change) and only fingerprint the fields
 * that the spectator / Subs Manager UI actually needs to react to.
 */

export interface SignatureInput {
  // Board
  players?: Array<{
    id: string;
    position?: string | null;
    minutesPlayed?: number;
    points?: number;
    fouls?: number;
    isInjured?: boolean;
    isFouledOut?: boolean;
  }>;
  currentQuarter?: number;
  rotationMode?: string;
  validationMode?: string;
  // Timer
  elapsedSeconds?: number;
  isRunning?: boolean;
  isGameFinished?: boolean;
  homeScore?: number;
  awayScore?: number;
  scoreLogLength?: number;
  subLogLength?: number;
  centrePass?: string;
}

export function buildGameSignature(input: SignatureInput): string {
  // Bucket elapsedSeconds to 5s windows — coaches don't need sub-5s spectator
  // updates and this dramatically cuts write volume during normal play.
  const bucket = Math.floor((input.elapsedSeconds ?? 0) / 5);
  const players = (input.players ?? [])
    .map(
      (p) =>
        `${p.id}:${p.position ?? "b"}:${Math.floor((p.minutesPlayed ?? 0) / 10)}:${p.points ?? 0}:${p.fouls ?? 0}:${p.isInjured ? "i" : ""}${p.isFouledOut ? "f" : ""}`
    )
    .sort()
    .join("|");
  return [
    players,
    input.currentQuarter ?? 0,
    input.rotationMode ?? "",
    input.validationMode ?? "",
    bucket,
    input.isRunning ? 1 : 0,
    input.isGameFinished ? 1 : 0,
    input.homeScore ?? 0,
    input.awayScore ?? 0,
    input.scoreLogLength ?? 0,
    input.subLogLength ?? 0,
    input.centrePass ?? "",
  ].join("#");
}
