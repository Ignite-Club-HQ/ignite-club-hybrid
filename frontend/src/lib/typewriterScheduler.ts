/**
 * Shared rAF-driven typewriter scheduler.
 *
 * Before: every <Typed> / <TypewriterLine> in the Chat Recap created its own
 * setInterval(16ms). With 20–40 lines streaming concurrently that meant
 * 20–40 timers + React state updates per frame, which OOM'd Android WebView
 * to a white screen.
 *
 * After: ONE requestAnimationFrame loop drives all active typewriters. Each
 * subscriber gets a callback with the number of characters that should be
 * visible at the current timestamp (computed from its start time, delay,
 * and charMs). React state updates only happen when the visible character
 * count actually changes for that subscriber.
 *
 * The loop self-stops when no subscribers remain and resumes lazily on the
 * next subscription.
 */

type Subscriber = {
  startAt: number; // performance.now() when the first character should appear
  charMs: number;
  length: number;
  lastN: number;
  onTick: (n: number) => void;
};

let subs = new Set<Subscriber>();
let rafId: number | null = null;

function frame() {
  rafId = null;
  if (subs.size === 0) return;
  const now = performance.now();
  // Iterate a snapshot so onTick callers can unsubscribe safely.
  const snapshot = Array.from(subs);
  for (const s of snapshot) {
    const elapsed = now - s.startAt;
    const n = elapsed <= 0 ? 0 : Math.min(s.length, Math.floor(elapsed / s.charMs));
    if (n !== s.lastN) {
      s.lastN = n;
      try { s.onTick(n); } catch { /* ignore */ }
    }
    if (n >= s.length) subs.delete(s);
  }
  if (subs.size > 0) rafId = requestAnimationFrame(frame);
}

function ensureLoop() {
  if (rafId == null && subs.size > 0) {
    rafId = requestAnimationFrame(frame);
  }
}

export interface TypewriterHandle {
  cancel: () => void;
}

export function scheduleTypewriter(opts: {
  delayMs: number;
  charMs: number;
  length: number;
  onTick: (n: number) => void;
}): TypewriterHandle {
  if (opts.length <= 0 || opts.charMs <= 0) {
    opts.onTick(opts.length);
    return { cancel: () => {} };
  }
  const sub: Subscriber = {
    startAt: performance.now() + Math.max(0, opts.delayMs),
    charMs: opts.charMs,
    length: opts.length,
    lastN: -1,
    onTick: opts.onTick,
  };
  subs.add(sub);
  ensureLoop();
  return {
    cancel: () => { subs.delete(sub); },
  };
}
