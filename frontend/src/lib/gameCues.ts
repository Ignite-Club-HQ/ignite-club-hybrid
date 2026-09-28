/**
 * Shared audio + haptic cues for live game boards (basketball + netball).
 *
 * Coaches running a noisy sideline want unmistakable feedback when:
 *   - a sub is due in the next ~10s
 *   - a quarter ends
 *   - a timeout is called
 *
 * We use the WebAudio API for short tones (no asset bundling) and the
 * Vibration API for haptics on Android. Both are no-ops where unsupported.
 *
 * A single `cuesEnabled` preference is persisted in localStorage so the coach
 * can mute the whole experience with one tap.
 */

const PREF_KEY = "ignite-game-cues-enabled";

let audioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!audioCtx) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    // Resume if a previous user gesture suspended it.
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

export function getCuesEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const v = window.localStorage.getItem(PREF_KEY);
  // Default ON — coaches expect feedback unless they mute.
  return v === null ? true : v === "1";
}

export function setCuesEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PREF_KEY, enabled ? "1" : "0");
}

interface ToneOpts {
  frequency: number;
  durationMs: number;
  volume?: number; // 0..1
  type?: OscillatorType;
}

function playTone({ frequency, durationMs, volume = 0.18, type = "sine" }: ToneOpts) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);
  // Tiny attack/release prevents the audible click that a hard start/stop produces.
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + durationMs / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + durationMs / 1000 + 0.02);
}

function vibrate(pattern: number | number[]) {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* no-op */
  }
}

/** A short double-beep — fired when a sub is about to be due. */
export function cueSubDue() {
  if (!getCuesEnabled()) return;
  playTone({ frequency: 880, durationMs: 120 });
  window.setTimeout(() => playTone({ frequency: 1175, durationMs: 140 }), 160);
  vibrate([60, 60, 60]);
}

/** Buzzer-style longer tone for end of quarter / period. */
export function cueQuarterEnd() {
  if (!getCuesEnabled()) return;
  playTone({ frequency: 220, durationMs: 600, volume: 0.22, type: "sawtooth" });
  vibrate([200, 80, 200]);
}

/** Single confirmation tone for timeouts / discrete actions. */
export function cueTimeout() {
  if (!getCuesEnabled()) return;
  playTone({ frequency: 660, durationMs: 180, type: "triangle" });
  vibrate(80);
}
