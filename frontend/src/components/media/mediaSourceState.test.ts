import { describe, expect, it } from 'vitest';
import { readMediaSources } from './mediaSourceState';
describe('media source completeness', () => {
  it('publishes ready sources without waiting and sorts/deduplicates late assets before a complete boundary', async () => {
    let finish: ((rows: { id: string; time: number }[]) => void) | undefined;
    const updates: { ids: string[]; complete: boolean; states: string[] }[] = [];
    const pending = readMediaSources(['fast', 'slow', 'fast'], async id => id === 'fast'
      ? [{ id: 'photo-1', time: 1 }]
      : await new Promise<{ id: string; time: number }[]>(resolve => { finish = resolve; }), snapshot => {
      const rows = [...new Map(snapshot.values.flat().map(row => [row.id, row])).values()].sort((a, b) => b.time - a.time);
      updates.push({ ids: rows.map(row => row.id), complete: snapshot.complete, states: snapshot.sources.map(s => s.state) });
    });
    await Promise.resolve(); await Promise.resolve();
    expect(updates[0]).toEqual({ ids: ['photo-1'], complete: false, states: ['ready', 'loading'] });
    finish?.([{ id: 'photo-2', time: 2 }, { id: 'photo-1', time: 1 }]);
    await pending;
    expect(updates.at(-1)).toEqual({ ids: ['photo-2', 'photo-1'], complete: true, states: ['ready', 'ready'] });
  });
  it('retains healthy club data without treating a failed source as empty', async () => {
    const result = await readMediaSources(['g1-club', 'g2-club'], async id => {
      if (id === 'g2-club') throw new Error('Network unavailable');
      return [{ id: 'photo-1' }];
    });
    expect(result.values.flat()).toEqual([{ id: 'photo-1' }]);
    expect(result.sources).toEqual([{ clubId: 'g1-club', state: 'ready' }, { clubId: 'g2-club', state: 'failed' }]);
  });
  it('distinguishes denied from successfully empty and preserves all-failed errors', async () => {
    const result = await readMediaSources(['empty', 'denied'], async id => {
      if (id === 'denied') throw new Error('Club access denied');
      return [];
    });
    expect(result.sources).toEqual([{ clubId: 'empty', state: 'ready' }, { clubId: 'denied', state: 'denied' }]);
    await expect(readMediaSources(['failed'], async () => { throw new Error('Unavailable'); })).rejects.toThrow('Unavailable');
  });
});