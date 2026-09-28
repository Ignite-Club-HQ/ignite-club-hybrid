import { useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { shouldApplyRemoteTimerState, shouldWriteLocalTimerState, type LocalEventGroupTimer } from "@/lib/eventGroupTimerGuard";


const SYNC_INTERVAL = 5000; // Fallback polling interval
const PITCH_STATE_KEY = "ignite-pitch-board-state";
const PITCH_STATE_KEY_BASE = "ignite-pitch-board-state-team";
const getPitchStateKeyForTeam = (teamId: string) => `${PITCH_STATE_KEY_BASE}-${teamId}`;
const TIMER_STORAGE_KEY_BASE = "pitch-board-timer-state-team";

const getTeamTimerStorageKey = (teamId: string) => {
  return `${TIMER_STORAGE_KEY_BASE}-${teamId}`;
};

/**
 * Hook to sync event group pitch board state to the database.
 * Uses a lightweight Supabase Realtime channel to broadcast "state-changed"
 * signals so other clients can fetch fresh state immediately, while keeping
 * the existing polling sync as a safety-net fallback.
 *
 * `readOnly` MUST be set for spectator surfaces (e.g. `BoardViewerDialog`).
 * A spectator mirrors the remote state into its own localStorage; if it is
 * also allowed to write, then once its copy goes stale (backgrounded tab, or
 * simply a 5s tick landing before its next read) the interval — and the
 * unmount flush — blind-`UPDATE`s the shared row with a stale clock and
 * broadcasts `state-changed`, dragging every other client to re-read it.
 * Spectators must only ever read.
 */
export function useEventGroupSync(
  teamId: string,
  eventGroupId: string | null,
  options?: { readOnly?: boolean },
) {
  const readOnly = options?.readOnly === true;

  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSyncedStateRef = useRef<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSignalVersionRef = useRef<number>(0);

  // Extract the actual event group ID from teamId (format: "event-group-{uuid}")
  const actualGroupId = teamId.startsWith("event-group-")
    ? teamId.replace("event-group-", "")
    : eventGroupId;

  const loadLocalState = useCallback(() => {
    try {
      const pitchStateRaw = localStorage.getItem(getPitchStateKeyForTeam(teamId)) || localStorage.getItem(PITCH_STATE_KEY);
      const timerStateRaw = localStorage.getItem(getTeamTimerStorageKey(teamId));

      return {
        pitchState: pitchStateRaw ? JSON.parse(pitchStateRaw) : null,
        timerState: timerStateRaw ? JSON.parse(timerStateRaw) : null,
      };
    } catch {
      return { pitchState: null, timerState: null };
    }
  }, [teamId]);

  /**
   * Broadcast a lightweight "state-changed" signal on the Realtime channel.
   * Other clients receive this and fetch the latest state from the DB.
   */
  const broadcastSignal = useCallback(() => {
    if (!channelRef.current) return;
    const version = Date.now();
    lastSignalVersionRef.current = version;
    channelRef.current.send({
      type: "broadcast",
      event: "state-changed",
      payload: { version, updatedBy: teamId },
    }).catch(() => {
      // Silently ignore broadcast errors – polling fallback will cover it
    });
  }, [teamId]);

  /**
   * Load state from the database and apply it to localStorage.
   * When `force` is true (triggered by a Realtime signal), always overwrite
   * local state. Otherwise, only load when localStorage is empty (initial load).
   */
  const loadFromDatabase = useCallback(async (force = false) => {
    if (!actualGroupId) return;

    try {
      const { data, error } = await supabase
        .from("event_groups")
        .select("pitch_state, timer_state")
        .eq("id", actualGroupId)
        .single();

      if (error) {
        console.error("[EventGroupSync] Failed to load:", error);
        return;
      }

      const { pitchState: localPitch, timerState: localTimer } = loadLocalState();

      if (data.pitch_state && (force || !localPitch)) {
        const dbPitchState = data.pitch_state as Record<string, unknown>;
        if (typeof dbPitchState === "object" && dbPitchState !== null) {
          dbPitchState.teamId = teamId;
        }
        localStorage.setItem(getPitchStateKeyForTeam(teamId), JSON.stringify(dbPitchState));
        localStorage.setItem(PITCH_STATE_KEY, JSON.stringify(dbPitchState));
        console.log("[EventGroupSync] Applied pitch state from database", force ? "(realtime)" : "(initial)");
      }

      // Never let a remote timer payload move this board's clock backwards.
      // `event_groups.timer_state` defaults to `{}` (truthy!) and peers can
      // broadcast stale snapshots — both used to hydrate the board at 00:00.
      const timerDecision = shouldApplyRemoteTimerState({
        remote: data.timer_state,
        local: localTimer as LocalEventGroupTimer | null,
        force,
      });
      if (timerDecision.apply) {
        const dbTimerState = data.timer_state as Record<string, unknown>;
        if (typeof dbTimerState === "object" && dbTimerState !== null) {
          dbTimerState.teamId = teamId;
        }
        localStorage.setItem(getTeamTimerStorageKey(teamId), JSON.stringify(dbTimerState));
        localStorage.setItem("pitch-board-timer-state", JSON.stringify(dbTimerState));
        console.log("[EventGroupSync] Applied timer state from database", force ? "(realtime)" : "(initial)");
      } else {
        console.info("[EventGroupSync] Skipped remote timer state:", timerDecision.reason);
      }


      // Dispatch event so same-tab components know state changed
      if (force) {
        window.dispatchEvent(new CustomEvent("game-state-changed"));
      }
    } catch (err) {
      console.error("[EventGroupSync] Load error:", err);
    }
  }, [actualGroupId, loadLocalState, teamId]);

  const syncToDatabase = useCallback(async () => {
    if (!actualGroupId) return;
    if (readOnly) return; // spectators never write

    const { pitchState, timerState } = loadLocalState();

    if (!pitchState && !timerState) return;

    const stateHash = JSON.stringify({ pitchState, timerState });
    if (stateHash === lastSyncedStateRef.current) return;

    try {
      // Compare-and-swap. Read the row we are about to overwrite so we can
      // (a) refuse to publish a snapshot older than what's already there, and
      // (b) scope the UPDATE to that exact `updated_at`, so a peer that wrote
      // in between wins and our stale write is dropped instead of clobbering.
      const { data: current, error: readError } = await supabase
        .from("event_groups")
        .select("timer_state, updated_at")
        .eq("id", actualGroupId)
        .maybeSingle();

      if (readError) {
        console.error("[EventGroupSync] CAS pre-read failed, skipping write:", readError);
        return;
      }

      const writeDecision = shouldWriteLocalTimerState({
        local: timerState,
        remote: current?.timer_state,
      });

      // `pitch_state` (formation, auto-sub plan) is still worth publishing even
      // when our clock is behind — only the timer column is withheld.
      const timerPatch = writeDecision.apply
        ? { timer_state: (timerState || {}) as unknown as Json }
        : {};
      if (!writeDecision.apply) {
        console.info("[EventGroupSync] Withholding timer_state:", writeDecision.reason);
      }

      let update = supabase
        .from("event_groups")
        .update({
          pitch_state: (pitchState || {}) as unknown as Json,
          ...timerPatch,
          updated_at: new Date().toISOString(),
        })
        .eq("id", actualGroupId);

      update = current?.updated_at
        ? update.eq("updated_at", current.updated_at)
        : update.is("updated_at", null);

      const { data: updated, error } = await update.select("id");

      if (error) {
        console.error("[EventGroupSync] Failed to sync:", error);
      } else if (!updated || updated.length === 0) {
        // CAS lost: a peer wrote between our read and write. Pull their state
        // in rather than retrying, so we converge instead of ping-ponging.
        console.info("[EventGroupSync] CAS conflict — adopting peer state");
        await loadFromDatabase(true);
      } else {
        lastSyncedStateRef.current = stateHash;
        console.log("[EventGroupSync] Synced state to database");
        // Broadcast a signal so other clients pick up the change
        broadcastSignal();
      }
    } catch (err) {
      console.error("[EventGroupSync] Sync error:", err);
    }
  }, [actualGroupId, readOnly, loadLocalState, broadcastSignal, loadFromDatabase]);


  /**
   * Subscribe to a lightweight Realtime broadcast channel for this event group.
   */
  const subscribeToChannel = useCallback(() => {
    if (!actualGroupId || channelRef.current) return;

    const channel = supabase.channel(`event-group:${actualGroupId}`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: "state-changed" }, (payload) => {
        const version = payload?.payload?.version as number | undefined;
        if (version && version > lastSignalVersionRef.current) {
          lastSignalVersionRef.current = version;
          console.log("[EventGroupSync] Received state-changed signal, fetching latest…");
          loadFromDatabase(true);
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("[EventGroupSync] Realtime channel subscribed for:", actualGroupId);
        }
      });

    channelRef.current = channel;
  }, [actualGroupId, loadFromDatabase]);

  const unsubscribeFromChannel = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  const startSync = useCallback(() => {
    if (syncIntervalRef.current || !actualGroupId) return;

    // Subscribe to Realtime channel for instant cross-user updates
    subscribeToChannel();

    // Load from database first (in case another user started the game)
    loadFromDatabase(false);

    // Fallback polling sync (writers only — spectators just read)
    if (!readOnly) {
      syncIntervalRef.current = setInterval(syncToDatabase, SYNC_INTERVAL);
    }
    console.log("[EventGroupSync] Started sync for event group:", actualGroupId, readOnly ? "(read-only)" : "");
  }, [actualGroupId, readOnly, loadFromDatabase, syncToDatabase, subscribeToChannel]);

  const stopSync = useCallback(async () => {
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }

    // Final sync before stopping
    await syncToDatabase();

    // Tear down Realtime channel
    unsubscribeFromChannel();
    console.log("[EventGroupSync] Stopped sync");
  }, [syncToDatabase, unsubscribeFromChannel]);

  // Force sync on demand
  const forceSync = useCallback(() => {
    syncToDatabase();
  }, [syncToDatabase]);

  // Auto-start sync when component mounts with an event group
  useEffect(() => {
    if (actualGroupId) {
      startSync();
    }

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
      unsubscribeFromChannel();
      // Don't await in cleanup - just fire and forget
      syncToDatabase();
    };
  }, [actualGroupId, startSync, syncToDatabase, unsubscribeFromChannel]);

  return {
    startSync,
    stopSync,
    forceSync,
    loadFromDatabase,
    isEventGroup: !!actualGroupId,
  };
}
