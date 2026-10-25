import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), events: vi.fn(), folder: vi.fn(), file: vi.fn() }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: mocks.dispatch }));
vi.mock('@/live/features/events', () => ({ listLiveEvents: mocks.events }));
vi.mock('@/live/features/vault', () => ({ getLiveVaultFolder: mocks.folder, getLiveVaultFile: mocks.file }));
import { fetchIcpEventTitleMap, fetchIcpVaultNameMap } from './icpPreviewReferenceNames';
describe('authorized ICP inbox labels', () => {
  it('reads each event in its own event scope', async () => {
    mocks.dispatch.mockImplementation(async (_feature, providers, scope) => providers.icp(scope));
    mocks.events.mockImplementation(async scope => [{ id: scope.eventId, title: `Title ${scope.eventId}` }]);
    expect(await fetchIcpEventTitleMap(['event-A', 'event-B'])).toEqual({ 'event-a': 'Title event-A', 'event-b': 'Title event-B' });
    expect(mocks.dispatch).toHaveBeenCalledWith('events', expect.anything(), { eventId: 'event-A' });
  });
  it('uses exact folder/file scopes and never invents missing names', async () => {
    mocks.dispatch.mockImplementation(async (_feature, providers, scope) => providers.icp(scope));
    mocks.folder.mockResolvedValue({ name: 'Committee' });
    mocks.file.mockResolvedValue(null);
    expect(await fetchIcpVaultNameMap(['folder-1'], 'folder')).toEqual({ 'folder-1': 'Committee' });
    expect(mocks.dispatch).toHaveBeenCalledWith('vault', expect.anything(), { vaultFolderId: 'folder-1' });
    expect(await fetchIcpVaultNameMap(['file-1'], 'file')).toEqual({});
    expect(mocks.dispatch).toHaveBeenCalledWith('vault', expect.anything(), { vaultFileId: 'file-1' });
  });
  it('preserves authorization failures rather than treating them as absence', async () => {
    mocks.folder.mockRejectedValue(new Error('Access required'));
    await expect(fetchIcpVaultNameMap(['private'], 'folder')).rejects.toThrow('Access required');
  });
});