import { describe, expect, it } from 'vitest';
import { maskSharedPitchNames, sharedPitchNameRefs, resolveSharedPitchNames } from './sharedPitchPrivacy';
describe('shared pitch names stay opaque', () => {
  it('masks names in players, substitutions and goals, without changing coordinates or timers', () => {
    const source = { players: [{ id: 'p', name: 'Child A', position: { x: 12, y: 34 } }], autoSubPlan: [{ playerOut: { id: 'p', name: 'Child A' }, playerIn: { id: 'q', name: 'Child B' } }], goals: [{ name: 'Child C' }], elapsedSeconds: 75 };
    const masked = maskSharedPitchNames(source, 'pitch:team:');
    const wire = JSON.stringify(masked.pitch);
    for (const name of ['Child A','Child B','Child C']) expect(wire).not.toContain(name);
    expect(masked.pitch.players).toEqual([{ id: 'p', name: 'pitch:team:p', position: { x: 12, y: 34 } }]);
    expect(masked.pitch.elapsedSeconds).toBe(75);
    expect(sharedPitchNameRefs(masked.pitch)).toHaveLength(3);
    expect(resolveSharedPitchNames(masked.pitch, masked.names)).toEqual(source);
  });
  it('keeps existing refs opaque and displays an unreadable name neutrally', () => {
    const masked = maskSharedPitchNames({ players: [{ id: 'p', name: 'pitch:team:p' }] }, 'pitch:team:');
    expect(masked.names.size).toBe(0);
    expect(resolveSharedPitchNames(masked.pitch, new Map())).toEqual({ players: [{ id: 'p', name: 'Player' }] });
  });
});