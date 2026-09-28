/**
 * Captures `[TimerAudit]` console entries into a ring buffer so coaches can
 * export them from the app after a freeze/revert to share for debugging.
 *
 * - Wraps `console.info` (kept in production by `prodConsoleSilencer`).
 * - Also captures `console.warn` / `console.error` entries that mention
 *   "Timer" so related failures show up alongside the audit trail.
 * - Persists the buffer to localStorage on a debounced cadence so a hard
 *   crash / WebView kill still leaves something to download.
 * - Survives across reloads (loads existing buffer on init).
 */

const STORAGE_KEY = "timer-audit-log-buffer";
const MAX_ENTRIES = 2000;
const PREFIX = "[TimerAudit]";

export interface TimerAuditEntry {
  t: string; // ISO timestamp
  level: "info" | "warn" | "error";
  message: string;
  data?: unknown;
}

let buffer: TimerAuditEntry[] = [];
let installed = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const loadFromStorage = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) buffer = parsed.slice(-MAX_ENTRIES);
    }
  } catch {
    // ignore
  }
};

const scheduleFlush = () => {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buffer));
    } catch {
      // Quota exceeded — trim aggressively and retry once.
      buffer = buffer.slice(-Math.floor(MAX_ENTRIES / 2));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(buffer));
      } catch {
        // give up
      }
    }
  }, 500);
};

const push = (level: TimerAuditEntry["level"], args: unknown[]) => {
  // args[0] is the prefixed message string; the rest are data payloads.
  const [first, ...rest] = args;
  const message = typeof first === "string" ? first : JSON.stringify(first);
  let data: unknown;
  if (rest.length === 1) data = rest[0];
  else if (rest.length > 1) data = rest;
  buffer.push({ t: new Date().toISOString(), level, message, data });
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
  scheduleFlush();
};

const matchesTimer = (args: unknown[]): boolean => {
  const first = args[0];
  if (typeof first !== "string") return false;
  return first.startsWith(PREFIX) || first.includes("[Timer]");
};

export function installTimerAuditCapture(): void {
  if (installed) return;
  installed = true;

  loadFromStorage();

  const origInfo = console.info.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.info = (...args: unknown[]) => {
    if (matchesTimer(args)) push("info", args);
    origInfo(...args);
  };
  console.warn = (...args: unknown[]) => {
    if (matchesTimer(args)) push("warn", args);
    origWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    if (matchesTimer(args)) push("error", args);
    origError(...args);
  };
}

export function getTimerAuditEntries(): TimerAuditEntry[] {
  return buffer.slice();
}

export function clearTimerAuditLog(): void {
  buffer = [];
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Build a plain-text dump of the captured entries (most readable for sharing).
 */
export function formatTimerAuditLog(): string {
  const header = [
    `Timer Audit Log`,
    `Exported: ${new Date().toISOString()}`,
    `Entries: ${buffer.length}`,
    `User Agent: ${typeof navigator !== "undefined" ? navigator.userAgent : "n/a"}`,
    `URL: ${typeof location !== "undefined" ? location.href : "n/a"}`,
    "",
    "----------------------------------------",
    "",
  ].join("\n");

  const lines = buffer.map((e) => {
    let dataStr = "";
    if (e.data !== undefined) {
      try {
        dataStr = " " + JSON.stringify(e.data);
      } catch {
        dataStr = " [unserializable]";
      }
    }
    return `${e.t} [${e.level.toUpperCase()}] ${e.message}${dataStr}`;
  });

  return header + lines.join("\n") + "\n";
}

/**
 * Trigger a browser download of the captured log as a .txt file.
 * Falls back to copying to clipboard if Blob URLs aren't available
 * (some Capacitor WebView contexts).
 */
export async function exportTimerAuditLog(): Promise<{ ok: boolean; method: string }> {
  const text = formatTimerAuditLog();
  const filename = `timer-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;

  try {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true, method: "download" };
  } catch {
    // Fallback: clipboard
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true, method: "clipboard" };
    } catch {
      return { ok: false, method: "none" };
    }
  }
}
