import { useState, useEffect } from "react";

const SYNC_STATUS_KEY = "pitch-board-sync-status";

export type SyncStatus = "idle" | "syncing" | "synced" | "error";

export interface SyncState {
  status: SyncStatus;
  lastSyncTime: number | null;
  error?: string;
}

export function setSyncStatus(state: SyncState) {
  try {
    localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(state));
    // Dispatch storage event for same-tab updates
    window.dispatchEvent(new StorageEvent('storage', {
      key: SYNC_STATUS_KEY,
      newValue: JSON.stringify(state),
    }));
  } catch (e) {
    console.error("Failed to set sync status:", e);
  }
}

export function useSyncStatus(): SyncState {
  const [state, setState] = useState<SyncState>(() => {
    try {
      const saved = localStorage.getItem(SYNC_STATUS_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return { status: "idle", lastSyncTime: null };
  });

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === SYNC_STATUS_KEY && e.newValue) {
        try {
          setState(JSON.parse(e.newValue));
        } catch {}
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return state;
}
