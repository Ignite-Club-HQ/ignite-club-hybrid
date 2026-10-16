import type { MemoryReport } from "../../lib/canisterMemoryReports";

export const CEILING_MB = 4096;
const WATCH_MB = 2560;
const ACT_MB = 3072;
const WATCH_DAYS = 90;
const ACT_DAYS = 30;

export type LiveMem = { key: string; memoryMb: number | null };
type Level = "ok" | "watch" | "act" | "unknown";

export type Forecast = {
  key: string;
  memoryMb: number | null;
  growthMbPerDay: number | null;
  daysToCeiling: number | null;
  level: Level;
};

/** Pure projection, exported for tests. */
export function forecastMemory(live: LiveMem[], history: MemoryReport[], now = Date.now()): Forecast[] {
  return live.map(({ key, memoryMb }) => {
    if (memoryMb === null) return { key, memoryMb, growthMbPerDay: null, daysToCeiling: null, level: "unknown" };
    // Oldest saved reading at least 1 day old gives the growth window.
    let oldest: { at: number; mb: number } | null = null;
    for (const r of history) {
      const at = Date.parse(r.at);
      if (!Number.isFinite(at) || now - at < 86_400_000) continue;
      const x = r.readings.find((v) => v.name === key && typeof v.memory_mb === "number");
      if (x && (!oldest || at < oldest.at)) oldest = { at, mb: x.memory_mb as number };
    }
    let growth: number | null = null;
    let days: number | null = null;
    if (oldest) {
      growth = (memoryMb - oldest.mb) / ((now - oldest.at) / 86_400_000);
      if (growth > 0.01) days = Math.max(0, (CEILING_MB - memoryMb) / growth);
    }
    let level: Level = "ok";
    if (memoryMb >= ACT_MB || (days !== null && days <= ACT_DAYS)) level = "act";
    else if (memoryMb >= WATCH_MB || (days !== null && days <= WATCH_DAYS)) level = "watch";
    return { key, memoryMb, growthMbPerDay: growth, daysToCeiling: days, level };
  });
}


export const SPIKE_MIN_MB = 100;
export const SPIKE_PCT = 0.15;

export type SeriesPoint = { at: number; mb: number };
export type Spike = { key: string; at: number; fromMb: number; toMb: number };

/** Per-canister memory series, oldest first, from saved reports + an optional live point. */
export function memorySeries(history: MemoryReport[], live: LiveMem[] = [], now = Date.now()): Record<string, SeriesPoint[]> {
  const out: Record<string, SeriesPoint[]> = {};
  for (const r of history) {
    const at = Date.parse(r.at);
    if (!Number.isFinite(at)) continue;
    for (const x of r.readings) {
      if (typeof x.memory_mb !== "number") continue;
      (out[x.name] ??= []).push({ at, mb: x.memory_mb });
    }
  }
  for (const l of live) if (l.memoryMb !== null) (out[l.key] ??= []).push({ at: now, mb: l.memoryMb });
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.at - b.at);
  return out;
}

/** A spike = jump between consecutive readings of at least 100 MB AND 15%. */
export function detectSpikes(series: Record<string, SeriesPoint[]>): Spike[] {
  const spikes: Spike[] = [];
  for (const [key, pts] of Object.entries(series)) {
    for (let i = 1; i < pts.length; i++) {
      const d = pts[i].mb - pts[i - 1].mb;
      if (d >= SPIKE_MIN_MB && d >= pts[i - 1].mb * SPIKE_PCT)
        spikes.push({ key, at: pts[i].at, fromMb: pts[i - 1].mb, toMb: pts[i].mb });
    }
  }
  return spikes.sort((a, b) => b.at - a.at);
}
