import { describe, expect, it } from 'vitest';
import { readMediaSources } from './mediaSourceState';
describe('media source completeness', () => {
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