import { describe, it, expect, vi } from 'vitest';
import { planTransfer, TRANSFER_DOMAINS, type Transfer } from './groupTransfer';
import { runTransfer, type TransferAdapter } from './groupTransferRunner';

function adapter(o: Partial<TransferAdapter> = {}) {
  const store: Record<string, Record<string, number>> = { a: Object.fromEntries(TRANSFER_DOMAINS.map(d => [d, 3])), b: {} };
  const saved: Transfer[] = []; const fences: boolean[] = [];
  const a: TransferAdapter = {
    sameDeployment: async () => true,
    setFence: async (_g, _c, f) => { fences.push(f); },
    exportPage: async (_g, _c, _d, cursor) => cursor === null ? { rows: [new Uint8Array([1])], next: 'p2' } : { rows: [new Uint8Array([2])], next: null },
    importPage: async (g, _c, d, rows) => { store[g][d] = (store[g][d] ?? 0) + rows.length + (rows[0]?.[0] === 2 ? 1 : 0); },
    digest: async (g, _c, domain) => ({ domain, records: store[g][domain] ?? 0, digest: `h${store[g][domain] ?? 0}` }),
    readRegistryRevision: async () => 7n,
    swapAssignment: vi.fn(async () => {}),
    purgeSource: vi.fn(async () => {}),
    save: async t => { saved.push(t); },
    ...o,
  };
  return { a, saved, fences };
}
describe('transfer runner', () => {
  it.each(['fenced', 'copied'] as const)('checks media before resuming %s without copying or releasing locks', async phase => {
    const { a, fences } = adapter({ verifyMedia: async () => { throw new Error('media registry unavailable'); }, importPage: vi.fn() });
    await expect(runTransfer({ ...planTransfer('club','a','b',7n), phase }, a)).rejects.toThrow('media registry unavailable');
    expect(a.importPage).not.toHaveBeenCalled(); expect(a.swapAssignment).not.toHaveBeenCalled(); expect(fences).toEqual([]);
  });
  it('checks media before locking, copying or changing assignment', async () => {
    const { a, fences } = adapter({ verifyMedia: async () => { throw new Error('Encrypted media'); } });
    await expect(runTransfer(planTransfer('club', 'a', 'b', 7n), a)).rejects.toThrow('Encrypted media');
    expect(fences).toEqual([]);
    expect(a.swapAssignment).not.toHaveBeenCalled();
  });
  it('rechecks media after interrupted verification before cutover', async () => {
    const { a, saved } = adapter();
    await runTransfer(planTransfer('club', 'a', 'b', 7n), { ...a, readRegistryRevision: async () => { throw new Error('crash'); } }).catch(() => {});
    const verified = saved.at(-1);
    if (!verified) throw new Error('Missing persisted transfer');
    await expect(runTransfer(verified, { ...a, verifyMedia: async () => { throw new Error('quota unavailable'); } })).rejects.toThrow('quota unavailable');
    expect(a.swapAssignment).not.toHaveBeenCalled();
    expect(a.purgeSource).not.toHaveBeenCalled();
  });
  it('copies every domain, verifies, swaps with CAS and purges source last', async () => {
    const { a, saved, fences } = adapter();
    const t = await runTransfer(planTransfer('club', 'a', 'b', 7n), a);
    expect(t.phase).toBe('released'); expect(fences).toEqual([true]);
    expect(saved.map(s => s.phase)).toEqual(['fenced', 'copied', 'verified', 'cutover', 'released']);
    expect(a.swapAssignment).toHaveBeenCalledWith('club', 'b', 7n);
  });
  it('digest mismatch aborts, unfences source and never swaps', async () => {
    const { a, fences } = adapter({ digest: async (g, _c, domain) => ({ domain, records: 3, digest: g + domain }) });
    await expect(runTransfer(planTransfer('club', 'a', 'b', 7n), a)).rejects.toThrow('mismatch');
    expect(fences).toEqual([true, false]); expect(a.swapAssignment).not.toHaveBeenCalled(); expect(a.purgeSource).not.toHaveBeenCalled();
  });
  it('resumes from a persisted phase without refencing', async () => {
    const { a, saved, fences } = adapter();
    const first = await runTransfer(planTransfer('club', 'a', 'b', 7n), { ...a, readRegistryRevision: async () => { throw new Error('crash'); } }).catch(() => saved.at(-1));
    if (!first) throw new Error('Missing persisted transfer');
    expect(first.phase).toBe('verified');
    const done = await runTransfer(first, a); expect(done.phase).toBe('released'); expect(fences).toEqual([true]);
  });
  it('concurrent registry change keeps the club fenced and unswapped', async () => {
    const { a } = adapter({ readRegistryRevision: async () => 8n });
    await expect(runTransfer(planTransfer('club', 'a', 'b', 7n), a)).rejects.toThrow('re-plan');
    expect(a.swapAssignment).not.toHaveBeenCalled();
  });
  it('refuses cross-deployment transfers and stalled cursors', async () => {
    await expect(runTransfer(planTransfer('c', 'a', 'b', 1n), adapter({ sameDeployment: async () => false }).a)).rejects.toThrow('reviewed design');
    const { a, fences } = adapter({ exportPage: async () => ({ rows: [], next: 'same' }) });
    const x = { ...a, exportPage: async (_g: string, _c: string, _d: string, cur: string | null) => ({ rows: [], next: cur ?? 'same' }) };
    await expect(runTransfer(planTransfer('c', 'a', 'b', 1n), x)).rejects.toThrow('stalled'); expect(fences.at(-1)).toBe(false);
  });
  it('a write slipping past the fence after verification blocks cutover', async () => {
    let calls = 0;
    const { a, fences } = adapter(); const real = a.digest;
    a.digest = async (g, c, d) => { const r = await real(g, c, d);
      if (g === 'a' && d === 'vault_domain' && ++calls > 1) return { ...r, digest: 'changed' }; return r; };
    await expect(runTransfer(planTransfer('club', 'a', 'b', 7n), a)).rejects.toThrow('Source changed');
    expect(a.swapAssignment).not.toHaveBeenCalled(); expect(fences.at(-1)).toBe(false);
  });
});
