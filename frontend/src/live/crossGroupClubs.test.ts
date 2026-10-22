import { describe, expect, it } from 'vitest';
import { settleAll } from './crossGroupClubs';

describe('cross-group partial results', () => {
  it('keeps clubs that loaded when another club fails', async () => {
    const r = await settleAll([Promise.resolve('g1-club'), Promise.reject(new Error('g2 down'))]);
    expect(r).toEqual({ values: ['g1-club'], failed: 1 });
  });
  it('throws when every club fails so saved data is kept, not replaced by empty', async () => {
    await expect(settleAll([Promise.reject(new Error('a')), Promise.reject(new Error('b'))])).rejects.toThrow('a');
  });
  it('treats no clubs as an empty, successful result', async () => {
    expect(await settleAll([])).toEqual({ values: [], failed: 0 });
  });
});
