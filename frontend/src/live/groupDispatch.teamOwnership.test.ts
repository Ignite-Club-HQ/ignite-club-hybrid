import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearGroupDispatchCache, createClubDispatcher, type DispatchDeps } from './groupDispatch';
import { OFF } from './groupActivation';
import type { FeatureBackendContext } from './featureRouter';

const context = (alias: string) => ({
  identity: { getPrincipal: () => ({ toText: () => 'account' }) },
  target: { alias, host: 'https://icp-api.io', networkKind: 'public_mainnet', canisterIds: {} },
}) as unknown as FeatureBackendContext;

beforeEach(clearGroupDispatchCache);

describe('team ownership across groups', () => {
  function setup() {
    const shared = context('shared');
    const group = context('g2');
    const lookup = vi.fn(async () => null as string | null);
    const readClub = vi.fn(async (_club, _domain, read) => read(group));
    const legacy = vi.fn(async (_feature, _club, read) => read(shared));
    const open = vi.fn(async () => ({
      isAssigned: (club: string) => club === 'group-2-test',
      dispose: vi.fn(), readClub,
      writeClub: vi.fn(),
      readEveryGroup: vi.fn(async (_domain, read) => read(group)),
    }));
    const dispatcher = createClubDispatcher({ gates: () => OFF, generalActive: async () => true,
      context: async () => shared, lookup, legacy, open } as unknown as DispatchDeps);
    return { dispatcher, lookup, readClub, legacy };
  }

  it('opens U9 in Group 2 even after an earlier shared ownership answer', async () => {
    const { dispatcher, lookup, readClub, legacy } = setup();
    await dispatcher.remember('team', [['u9', 'original-club']]);
    lookup.mockResolvedValue('group-2-test');
    const result = await dispatcher.readFor('membership', { teamId: 'u9' }, 'club_domain', async ctx => ctx.target.alias);
    expect(result).toBe('g2');
    expect(readClub).toHaveBeenCalledWith('group-2-test', 'club_domain', expect.any(Function));
    expect(legacy).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('confirms original-group teams in the shared directory', async () => {
    const { dispatcher, lookup } = setup();
    lookup.mockImplementation(async ctx => ctx.target.alias === 'shared' ? 'original-club' : null);
    expect(await dispatcher.readFor('membership', { teamId: 'original-u9' }, 'club_domain', async ctx => ctx.target.alias)).toBe('shared');
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('does not run a page read on an unrelated group when team discovery fails', async () => {
    const { dispatcher, lookup, legacy } = setup();
    lookup.mockRejectedValue(new Error('Team lookup unavailable'));
    const read = vi.fn(async () => null);
    await expect(dispatcher.readFor('membership', { teamId: 'u9' }, 'club_domain', read)).rejects.toThrow('Team lookup unavailable');
    expect(read).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });
});