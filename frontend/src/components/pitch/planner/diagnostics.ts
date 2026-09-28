export interface FairnessDiagnosticForecast {
  player: { id: string };
  predictedMinutes: number;
  gkRole?: "full" | "1h" | "2h" | null;
}

export interface FairnessDiagnosticSummary {
  targetMinutes: number;
  minimumMinutes: number;
  maximumMinutes: number;
  spreadMinutes: number;
  maximumDeviationMinutes: number;
  fairnessPercentage: number;
  mathematicalFloorMinutes: 0 | 1;
  tone: "good" | "warn" | "info";
  message: string;
  hasRotatingGoalkeeper: boolean;
}

export function analyzeFairnessDiagnostics({
  forecasts,
  teamSize,
  squadSize,
  matchMinutes,
  minShiftSeconds,
  rotateGkAtHalftime,
  mode,
}: {
  forecasts: FairnessDiagnosticForecast[];
  teamSize: number;
  squadSize: number;
  matchMinutes: number;
  minShiftSeconds: number;
  rotateGkAtHalftime: boolean;
  mode: "Standard" | "Frequent";
}): FairnessDiagnosticSummary | null {
  if (!forecasts.length || squadSize <= teamSize) return null;

  const fullGameGoalkeepers = new Set(
    forecasts.filter((forecast) => forecast.gkRole === "full")
      .map((forecast) => forecast.player.id),
  );
  const outfieldSlots = Math.max(0, teamSize - (fullGameGoalkeepers.size > 0 ? 1 : 0));
  const outfieldSquad = squadSize - fullGameGoalkeepers.size;
  const outfieldForecasts = forecasts.filter(
    (forecast) => !fullGameGoalkeepers.has(forecast.player.id),
  );
  if (outfieldSquad <= 0 || outfieldSlots <= 0 || outfieldForecasts.length === 0) return null;

  const targetMinutes = (outfieldSlots * matchMinutes) / outfieldSquad;
  const minutes = outfieldForecasts.map((forecast) => forecast.predictedMinutes);
  const minimumMinutes = Math.min(...minutes);
  const maximumMinutes = Math.max(...minutes);
  const spreadMinutes = maximumMinutes - minimumMinutes;
  const maximumDeviationMinutes = minutes.reduce(
    (maximum, value) => Math.max(maximum, Math.abs(value - targetMinutes)),
    0,
  );
  const fairnessPercentage = targetMinutes > 0
    ? Math.max(0, Math.min(100, 100 - (maximumDeviationMinutes / targetMinutes) * 100))
    : 100;
  const totalPlayerMinutes = outfieldSlots * matchMinutes;
  const mathematicalFloorMinutes = totalPlayerMinutes % outfieldSquad === 0 ? 0 : 1;
  const benchSize = squadSize - teamSize;
  const isLargeBench = benchSize >= Math.ceil(teamSize / 2);
  const minimumShiftMinutes = minShiftSeconds / 60;
  const constrainedByMinimumShift = spreadMinutes > 3 &&
    targetMinutes < minimumShiftMinutes * 1.5;

  let tone: FairnessDiagnosticSummary["tone"] = "good";
  let message = `Fair plan: all players are within ${Math.ceil(spreadMinutes)} min of each other.`;
  if (spreadMinutes <= 3) {
    message = `Fair plan: all outfielders are within ${Math.ceil(spreadMinutes)} min of target game time.`;
  } else if (spreadMinutes <= 6) {
    tone = "info";
    message = `Slightly uneven: spread of ${spreadMinutes.toFixed(1)} min between most- and least-played outfielder.`;
    if (constrainedByMinimumShift) {
      message += " Minimum time on field is preventing a tighter rotation.";
    } else if (isLargeBench && mode === "Standard") {
      message += " Try Frequent mode or lower “How often to suggest subs”.";
    }
  } else {
    tone = "warn";
    message = `Uneven plan: ${spreadMinutes.toFixed(1)} min between most- and least-played outfielder.`;
    if (isLargeBench) {
      message += " Large bench — try Frequent mode or lower “How often to suggest subs”.";
    } else if (constrainedByMinimumShift) {
      message += " Lower “Minimum time on field” to allow shorter shifts.";
    } else {
      message += " Lower “Minimum gap between sub moments” to allow more rotations.";
    }
  }

  return {
    targetMinutes,
    minimumMinutes,
    maximumMinutes,
    spreadMinutes,
    maximumDeviationMinutes,
    fairnessPercentage,
    mathematicalFloorMinutes,
    tone,
    message,
    hasRotatingGoalkeeper: rotateGkAtHalftime &&
      fullGameGoalkeepers.size === 0 &&
      forecasts.some((forecast) => forecast.gkRole === "1h" || forecast.gkRole === "2h"),
  };
}
