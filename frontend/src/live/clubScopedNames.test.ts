import { describe, it, expect, vi, beforeEach } from 'vitest';

const reads: string[][] = [];
vi.mock('./privateClubNameDisplayMode', () => ({ privateClubNameDisplaysEnabled: () => true }));
vi.mock('./privateProfileSession', () => ({ onPrivateProfileSessionRetired: () => () => {} }));
vi.mock('./featureRouter', () => ({
  withFeatureBackend: async (_f: string, impl: { icp: (ctx: unknown) => unknown }) => impl.icp(ctxStub),
}));
vi.mock('./relationshipProfileRead', () => ({
  readRelationshipProfiles: async (_ctx: unknown, ids: string[], rel: { kind: string; resource: string }) => {
    reads.push([...ids]);
    expect(rel).toEqual({ kind: 'club', resource: 'club-1' });
    if (ids.includes('outsider')) throw new Error('Private-name audience is incomplete or unavailable.');
    return ids.map(id => ({ account_id: id, display_name: `Name ${id}`, avatar_ref: [] }));
  },
}));

const identity = { getPrincipal: () => ({ toText: () => 'caller' }) };
const ctxStub = { identity } as never;

import { unlockClubScopedNames, __resetClubScopedNames } from './clubScopedNames';

describe('club-scoped names', () => {
  beforeEach(() => { reads.length = 0; __resetClubScopedNames(); });

  it('unlocks other members through the shared club', async () => {
    const names = await unlockClubScopedNames(ctxStub, 'club-1', ['a', 'b']);
    expect(names.get('a')).toBe('Name a');
    expect(names.get('b')).toBe('Name b');
  });

  it('one person outside the club does not blank everyone else', async () => {
    const names = await unlockClubScopedNames(ctxStub, 'club-1', ['a', 'outsider', 'b', 'c']);
    expect(names.has('outsider')).toBe(false);
    expect([...names.keys()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('reuses unlocked names without asking again', async () => {
    await unlockClubScopedNames(ctxStub, 'club-1', ['a']);
    reads.length = 0;
    const names = await unlockClubScopedNames(ctxStub, 'club-1', ['a']);
    expect(names.get('a')).toBe('Name a');
    expect(reads).toEqual([]);
  });
});
