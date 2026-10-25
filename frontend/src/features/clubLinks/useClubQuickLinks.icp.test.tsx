import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ from: vi.fn(), folders: vi.fn(), files: vi.fn(), grants: vi.fn(), scopes: [] as object[] }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: m.from } }));
vi.mock('@/live/authBackendMode', () => ({ resolveAuthBackend: () => 'icp' }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: (_: string, h: { icp: (c: object) => unknown }, scope: object) => { m.scopes.push(scope); return h.icp(scope); } }));
vi.mock('@/live/features/vault', () => ({ listLiveVaultFolders: m.folders, listLiveVaultFiles: m.files }));
vi.mock('@/live/features/membership', () => ({ getLiveMyRoleGrants: m.grants }));
vi.mock('@/features/vault/vaultReadRepository', () => ({ mapLiveVaultFile: (f: object) => f }));
vi.mock('@/lib/homeSectionSnapshot', () => ({ readHomeSectionSnapshot: () => null, writeHomeSectionSnapshot: vi.fn() }));
import { useClubPolicyDocs } from './useClubQuickLinks';

describe('Home ICP policy documents', () => {
  afterEach(cleanup);
  beforeEach(() => { vi.clearAllMocks(); m.scopes = []; });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
  }
  const folder = (id: string, name: string, team: string[] = [], deleted: bigint[] = []) => ({
    id, name, team, deleted_at_ms: deleted, competition_id: [], mini_league_id: [],
  });
  it('reads authorized selected-club policy folders, excluding team and deleted folders/files', async () => {
    m.folders.mockResolvedValue([folder('policies', 'Club Policies'), folder('team', 'Policies', ['team']), folder('deleted', 'Policies', [], [1n]), folder('other', 'Photos')]);
    m.files.mockResolvedValue([{ id: 'file', name: 'Safety', deleted_at_ms: [] }, { id: 'gone', name: 'Gone', deleted_at_ms: [1n] }]);
    const { result } = renderHook(() => useClubPolicyDocs('club-a'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map(f => f.id)).toEqual(['file']);
    expect(m.files).toHaveBeenCalledTimes(1);
    expect(m.files).toHaveBeenCalledWith({ clubId: 'club-a' }, 'policies');
    expect(m.from).not.toHaveBeenCalled();
  });
  it('discovers caller clubs and dispatches each independently for All Clubs', async () => {
    m.grants.mockResolvedValue([{ club: ['a'] }, { club: ['b'] }, { club: ['a'] }]);
    m.folders.mockResolvedValue([]);
    const { result } = renderHook(() => useClubPolicyDocs(null), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(m.scopes).toEqual([{ shared: 'person' }, { clubId: 'a' }, { clubId: 'b' }]);
    expect(m.from).not.toHaveBeenCalled();
  });
  it('keeps failed Vault access as an error rather than a completed empty inventory', async () => {
    m.folders.mockRejectedValue(new Error('unavailable'));
    const { result } = renderHook(() => useClubPolicyDocs('club-a'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(m.from).not.toHaveBeenCalled();
  });
});