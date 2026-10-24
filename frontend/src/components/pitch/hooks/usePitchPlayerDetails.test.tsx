import { useState } from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { usePitchPlayerDetails } from './usePitchPlayerDetails';
import type { Player } from '../types';

describe('late pitch-player metadata', () => {
  it('applies loaded jerseys and positions without moving players or losing game time', () => {
    const initial: Player[] = [{ id: 'child', name: 'Private name', number: 1, position: { x: 25, y: 40 }, minutesPlayed: 12, assignedPositions: [] }];
    const row = { user_id: 'child', child_id: null, preferred_positions: ['GK'] as Player['assignedPositions'], jersey_number: 8 };
    const { result, rerender } = renderHook(({ rows }) => {
      const [players, setPlayers] = useState(initial);
      usePitchPlayerDetails(rows, false, setPlayers);
      return players;
    }, { initialProps: { rows: undefined as typeof row[] | undefined } });
    act(() => rerender({ rows: [row] }));
    expect(result.current[0]).toEqual({ ...initial[0], number: 8, assignedPositions: ['GK'],childId:undefined });
  });
  it('retains exact child identity from the authorized position row',()=>{
    const initial:Player[]=[{id:'child',name:'Private',number:1,position:null}];
    const row={user_id:null,child_id:'child',preferred_positions:[] as Player['assignedPositions'],jersey_number:1};
    const {result}=renderHook(()=>{const [players,setPlayers]=useState(initial);usePitchPlayerDetails([row],false,setPlayers);return players});
    expect(result.current[0].childId).toBe('child');
  });
});