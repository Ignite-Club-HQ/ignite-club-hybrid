import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ events: vi.fn(), vault: vi.fn(), legacy: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'paul' } }) }));
vi.mock('@/live/loadBackendRouting', () => ({ isFeatureRoutedToIcp: () => true }));
vi.mock('./inboxRepositories', () => ({ fetchInboxEventTitleMap: mocks.legacy,
  fetchInboxVaultFolderNameMap: mocks.legacy, fetchInboxVaultFileNameMap: mocks.legacy }));
vi.mock('./icpPreviewReferenceNames', () => ({ fetchIcpEventTitleMap: mocks.events, fetchIcpVaultNameMap: mocks.vault }));
import { useInboxPreviewReferenceNames } from './useInboxPreviewReferenceNames';
describe('mounted ICP inbox references', () => {
  it('resolves all three label types without invoking old-system readers', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    mocks.events.mockResolvedValue({ [id]: 'Game' });
    mocks.vault.mockImplementation(async (_ids, kind) => ({ [id]: kind === 'folder' ? 'Committee' : 'Minutes' }));
    const client = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useInboxPreviewReferenceNames([
      { lastMessage: { text: `[event:${id}] [vaultfolder:${id}] [vault:${id}]` } },
    ], {} as Parameters<typeof useInboxPreviewReferenceNames>[1]), { wrapper });
    await waitFor(() => expect(result.current.vaultFileNameMap[id]).toBe('Minutes'));
    expect(result.current.eventTitleMap[id]).toBe('Game');
    expect(result.current.vaultFolderNameMap[id]).toBe('Committee');
    expect(mocks.legacy).not.toHaveBeenCalled();
    expect(client.getQueryData(['messages-page-event-titles', 'other', true, id])).toBeUndefined();
    client.clear();
  });
});