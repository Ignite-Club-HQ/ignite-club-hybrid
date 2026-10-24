import { describe, it, expect } from 'vitest';
import { nearestGame, recentGame } from './gameEventReads';
const now = Date.parse('2026-10-24T09:00:00Z');
const row = (id: string, delta: number, cancelled = false) => ({ id, time: now + delta * 60_000, cancelled, deleted: false });
describe('on-chain game selection', () => {
  it('selects nearest authorized game and favors future when distances tie', () => {
    expect(nearestGame([row('past', -10), row('future', 10), row('far', 80)], now)).toBe('future');
  });
  it('uses only a linked game inside the existing three-hour/two-hour window', () => {
    expect(nearestGame([row('linked', -181), row('near', 15)], now, 'linked')).toBe('near');
    expect(nearestGame([row('linked', -180), row('near', 15)], now, 'linked')).toBe('linked');
  });
  it('never opens cancelled or deleted games', () => {
    expect(nearestGame([row('cancelled', 1, true), { ...row('deleted', 2), deleted: true }], now)).toBeNull();
  });
  it('keeps the past 48-hour recent-match window and excludes future games', () => {
    expect(recentGame([row('boundary', -48 * 60)], now)).toBe(true);
    expect(recentGame([row('old', -48 * 60 - 1), row('future', 1)], now)).toBe(false);
  });
});