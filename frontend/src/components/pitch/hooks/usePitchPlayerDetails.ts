import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { Player } from '../types';

interface PositionRow {
  user_id: string | null;
  child_id: string | null;
  preferred_positions: Player['assignedPositions'];
  jersey_number: number | null;
}

/** Apply late roster metadata without resetting placement, timers or the saved match. */
export function usePitchPlayerDetails(rows: PositionRow[] | undefined, mockMode: boolean, setPlayers: Dispatch<SetStateAction<Player[]>>) {
  useEffect(() => {
    if (!rows || mockMode) return;
    setPlayers(previous => {
      let changed = false;
      const next = previous.map(player => {
        const row = rows.find(item => item.user_id === player.id || item.child_id === player.id);
        if (!row || player.isFillIn) return player;
        const number = row.jersey_number ?? player.number;
        const assignedPositions = row.preferred_positions ?? [];
        const childId=row.child_id===player.id?player.id:undefined;
        if (childId===player.childId && number === player.number && JSON.stringify(assignedPositions) === JSON.stringify(player.assignedPositions ?? [])) return player;
        changed = true;
        return { ...player, number, assignedPositions, childId };
      });
      return changed ? next : previous;
    });
  }, [rows, mockMode, setPlayers]);
}