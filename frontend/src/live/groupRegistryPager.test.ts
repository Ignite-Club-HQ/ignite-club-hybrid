import { describe, it, expect } from 'vitest';
import { readPinnedGroupRegistry } from './groupRegistryPager';
const transport = (change?: number) => {
  let calls = 0;
  return async (revision: [] | [bigint], cursor: [] | [string], limit: number) => {
    const rev = ++calls === change ? 2n : 1n;
    if (revision.length && revision[0] !== rev) return { Err: 'Revision conflict' };
    const start = cursor.length ? Number(cursor[0]) : 0;
    const end = Math.min(200, start + limit);
    return { Ok: { revision: rev,
      groups: Array.from({ length: end - start }, (_, i) => ({ id: String(i + start) })),
      placements: Array.from({ length: end - start }, (_, i) => ({ group_id: String(i + start) })),
      next_cursor: (end < 200 ? [String(end).padStart(3, '0')] : []) as [] | [string] } };
  };
};
describe('revision pinned registry paging', () => {
  it('collects 200 groups through both consensus reads', async () => {
    const result = await readPinnedGroupRegistry(transport());
    expect(result.groups).toHaveLength(200); expect(result.placements).toHaveLength(200); expect(result.revision).toBe(1n);
  });
  it('fails closed on mid-page revision change', async () => {
    await expect(readPinnedGroupRegistry(transport(2))).rejects.toThrow('Revision conflict');
  });
  it('pins the second consensus read too', async () => {
    await expect(readPinnedGroupRegistry(transport(5))).rejects.toThrow('Revision conflict');
  });
  it('rechecks after every await', async () => {
    let checks = 0;
    await expect(readPinnedGroupRegistry(transport(), undefined, () => { if (++checks === 2) throw Error('Identity changed'); })).rejects.toThrow('Identity changed');
  });
});
