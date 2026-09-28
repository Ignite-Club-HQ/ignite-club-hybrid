import { useEffect, useState, useSyncExternalStore } from "react";
import {
  clearNotifDebugBuffer,
  getNotifDebugBuffer,
  isNotifDebugEnabled,
  subscribeNotifDebug,
  type NotifDebugEntry,
} from "@/lib/notifDebugLog";

/**
 * Floating on-screen panel that displays captured notification/chat-jump
 * log lines. Enabled by visiting `?notifdebug=1` once (sticky in
 * localStorage). Disable with `?notifdebug=0`.
 *
 * Intentionally lightweight — no design tokens needed because this is a
 * debug-only surface that should be visually distinct from real UI.
 */
export function NotifDebugOverlay() {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    setEnabled(isNotifDebugEnabled());
  }, []);

  const entries = useSyncExternalStore(
    subscribeNotifDebug,
    () => getNotifDebugBuffer(),
    () => getNotifDebugBuffer(),
  );

  if (!enabled) return null;

  const copyAll = async () => {
    const text = entries
      .map((e: NotifDebugEntry) => `${new Date(e.ts).toISOString().slice(11, 23)} [${e.level}] ${e.text}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for older WebViews
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* noop */ }
      document.body.removeChild(ta);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        left: 8,
        right: 8,
        bottom: 8,
        zIndex: 2147483000,
        background: "rgba(0,0,0,0.88)",
        color: "#fff",
        fontFamily: "monospace",
        fontSize: 11,
        borderRadius: 8,
        border: "1px solid #444",
        boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 8px",
          borderBottom: open ? "1px solid #333" : "none",
        }}
      >
        <strong style={{ flex: 1 }}>Notif debug ({entries.length})</strong>
        <button
          onClick={copyAll}
          style={{ background: "#2563eb", color: "#fff", border: 0, borderRadius: 4, padding: "3px 8px" }}
        >Copy</button>
        <button
          onClick={() => clearNotifDebugBuffer()}
          style={{ background: "#374151", color: "#fff", border: 0, borderRadius: 4, padding: "3px 8px" }}
        >Clear</button>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{ background: "#374151", color: "#fff", border: 0, borderRadius: 4, padding: "3px 8px" }}
        >{open ? "Hide" : "Show"}</button>
        <button
          onClick={() => {
            try { localStorage.removeItem("ignite_notif_debug"); } catch { /* noop */ }
            setEnabled(false);
          }}
          style={{ background: "#7f1d1d", color: "#fff", border: 0, borderRadius: 4, padding: "3px 8px" }}
        >Off</button>
      </div>
      {open && (
        <div style={{ maxHeight: 220, overflowY: "auto", padding: "4px 8px" }}>
          {entries.length === 0 ? (
            <div style={{ opacity: 0.7 }}>No matching logs yet. Tap a notification.</div>
          ) : (
            entries.map((e, i) => (
              <div
                key={i}
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  borderTop: i === 0 ? "none" : "1px dashed #222",
                  padding: "3px 0",
                  color:
                    e.level === "error" ? "#fca5a5" :
                    e.level === "warn" ? "#fcd34d" :
                    "#e5e7eb",
                }}
              >
                <span style={{ opacity: 0.6 }}>{new Date(e.ts).toISOString().slice(11, 23)}</span>
                {" "}
                {e.text}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
