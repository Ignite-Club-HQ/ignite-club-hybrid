import { useEffect, useRef } from 'react';
import { readSharedPitchBoard, writeSharedPitchBoard, sharedPitchSignature, type SharedBoardSnapshot } from '@/lib/sharedPitchBoard';

/** One writer per open board; serial read/CAS loop, no blind retry after failure. */
export function useIcpSharedPitchBoard({ teamId, userId, enabled, readOnly, apply }: {
  teamId: string; userId?: string; enabled: boolean; readOnly: boolean;
  apply: (pitch: Record<string, unknown>) => void;
}) {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    if (!enabled || !teamId.startsWith('event-group-')) return;
    function remote(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.source === 'icp-remote' && detail.teamId === teamId && detail.pitch) applyRef.current(detail.pitch);
    }
    window.addEventListener('game-state-changed', remote);
    return () => window.removeEventListener('game-state-changed', remote);
  }, [enabled, teamId]);
  useEffect(() => {
    if (!enabled || !userId || teamId.startsWith('event-group-')) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let revision: bigint | null = null;
    let hydrated = false;
    let signature = '';
    let uncertain = false;
    const session = crypto.randomUUID();
    const key = `ignite-pitch-board-state-team-${teamId}`;
    function local(): Record<string, unknown> | null {
      try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
    }
    function adopt(snapshot: SharedBoardSnapshot | null) {
      if (disposed) return;
      revision = snapshot?.revision ?? null;
      if (snapshot) {
        const pitch = { ...snapshot.pitch, teamId };
        signature = sharedPitchSignature(pitch);
        localStorage.setItem(key, JSON.stringify(pitch));
        localStorage.setItem('ignite-pitch-board-state', JSON.stringify(pitch));
        applyRef.current(pitch);
      } else signature = sharedPitchSignature(local() ?? {});
      hydrated = true;
    }
    async function tick() {
      if (disposed) return;
      try {
        if (document.visibilityState === 'hidden' || !navigator.onLine) return;
        const remote = await readSharedPitchBoard(teamId);
        if (disposed) return;
        if (!hydrated || uncertain || (remote?.revision ?? null) !== revision) {
          adopt(remote);
          uncertain = false;
          return;
        }
        const pitch = local();
        if (readOnly || !pitch) return;
        const next = sharedPitchSignature(pitch);
        if (next === signature && remote) return;
        // Preserve the loaded CAS token even if another client commits while
        // preparing PII: the canister refuses that stale write atomically.
        const ack = await writeSharedPitchBoard(teamId, revision, pitch, session);
        if (disposed) return;
        revision = ack.revision;
        signature = next;
      } catch (error) {
        // Conflict/unknown write: reload instead of replaying the payload.
        uncertain = true;
        console.warn('[PitchBoard] Shared state refresh failed', error);
      } finally {
        if (!disposed) timer = setTimeout(tick, 5000);
      }
    }
    void tick();
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [enabled, userId, teamId, readOnly]);
}