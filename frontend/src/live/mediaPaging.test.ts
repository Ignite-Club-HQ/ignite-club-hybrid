import { describe, expect, it, vi } from 'vitest';
import { readCompatibleMediaPage } from './mediaPaging';
const cursor = { club_id: 'g1', revision: 2n, before: 'key' };
describe('bounded media compatibility', () => {
  it('returns just one bounded page without calling the complete-list API', async () => {
    const legacy = vi.fn();
    expect(await readCompatibleMediaPage(async () => ({ Ok: { assets: ['new'], next: [cursor] } }), legacy, true))
      .toEqual({ assets: ['new'], next: cursor, bounded: true });
    expect(legacy).not.toHaveBeenCalled();
  });
  it('preserves an empty nonterminal page', async () => {
    const value = await readCompatibleMediaPage(async () => ({ Ok: { assets: [], next: [cursor] } }), vi.fn(), false);
    expect(value.next).toEqual(cursor); expect(value.assets).toEqual([]);
  });
  it('supports an older canister without interpreting missing paging as an empty gallery', async () => {
    expect(await readCompatibleMediaPage(async () => { throw Error('has no query method list_assets_page'); }, async () => ['old'], true))
      .toEqual({ assets: ['old'], next: null, bounded: false });
  });
  it('supports explicit incomplete backfill only on the first page', async () => {
    expect((await readCompatibleMediaPage(async () => ({ Err: 'Media page index not ready' }), async () => ['old'], true)).assets).toEqual(['old']);
    const legacy = vi.fn();
    await expect(readCompatibleMediaPage(async () => ({ Err: 'Media page index not ready' }), legacy, false)).rejects.toThrow('not ready');
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each(['Account admission denied', 'Network unavailable', 'Media page revision changed', 'IC0536 rejected', 'otherHelper is not a function', 'has no query method other_method'])('does not fall back on %s', async message => {
    const legacy = vi.fn();
    await expect(readCompatibleMediaPage(async () => { throw Error(message); }, legacy, true)).rejects.toThrow(message);
    expect(legacy).not.toHaveBeenCalled();
  });
});