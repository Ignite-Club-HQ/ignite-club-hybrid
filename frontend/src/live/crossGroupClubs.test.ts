import { describe, expect, it } from 'vitest';
import { settleAll, completeClubRows } from './crossGroupClubs';

describe('cross-group partial results', () => {
  it('does not certify a successful one-club result as the complete inventory when another club failed', () => {
    expect(() => completeClubRows({ values: ['giddy-goat'], failed: 1 })).toThrow('Some clubs');
    expect(completeClubRows({ values: ['giddy-goat', 'riverdogs'], failed: 0 })).toEqual(['giddy-goat', 'riverdogs']);
  });
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

import { vi } from 'vitest';
vi.mock('./membershipRouting', () => ({
  readMembershipInScope: (_ctx: unknown, scope: { clubId: string }, fn: (s: unknown) => unknown) => fn(scope.clubId),
}));
vi.mock('./features/club', () => ({
  getLiveClubProfile: (id: string) => id === 'slow'
    ? new Promise(r => setTimeout(() => r([{ id, deleted_at_ms: [] }]), 20))
    : Promise.resolve([{ id, deleted_at_ms: [] }]),
}));
vi.mock('./features/membership', () => ({ getLiveMyRoleGrants: async () => [] }));

describe('progressive club loading', () => {
  it('reports the fast group club before the slow group answers', async () => {
    const { readClubsInOwnGroups } = await import('./crossGroupClubs');
    const seen: string[][] = [];
    const r = await readClubsInOwnGroups({} as never, ['slow', 'fast'], l => seen.push(l.map(c => c.id)));
    expect(seen[0]).toEqual(['fast']);
    expect(seen.at(-1)).toEqual(['slow', 'fast']);
    expect(r.values.map(c => c.id)).toEqual(['slow', 'fast']);
  });
});
