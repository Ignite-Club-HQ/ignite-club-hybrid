import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ upload: vi.fn(), register: vi.fn(), scope: vi.fn(), copy: vi.fn() }));
vi.mock('@/hooks/useClubTheme', () => ({ useClubTheme: () => ({ activeClubFilter: null }) }));
vi.mock('@/live/internetIdentityAuth', () => ({ getCurrentInternetIdentity: async () => null }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: async (_: unknown, providers: any) => providers.icp({}) }));
vi.mock('@/live/features/media', () => ({ registerLiveAsset: mocks.register, setLiveAssetScope: mocks.scope,
  announceLiveGalleryAsset: async () => 'queued' }));
vi.mock('@/live/mediaUpload', () => ({ tryUploadMediaToBlobStore: mocks.upload }));
vi.mock('./galleryVaultCopy', () => ({ copyGalleryAssetToVault: mocks.copy }));
vi.mock('@/lib/imageCompression', () => ({ compressImage: async (file: File) => ({ file }) }));
vi.mock('@/components/ui/sheet', () => ({ Sheet: ({ children }: any) => <div>{children}</div>,
  SheetContent: ({ children }: any) => <div>{children}</div>, SheetHeader: ({ children }: any) => <div>{children}</div>,
  SheetTitle: ({ children }: any) => <h2>{children}</h2> }));
import { IcpUploadPhotoSheet } from './IcpUploadPhotoSheet';
import { reconcileGalleryUploads, usePendingGalleryUploads } from './pendingGalleryUploads';
function Preview({ client }: { client: QueryClient }) {
  const rows = usePendingGalleryUploads(client, 'paul');
  return <output>{rows.map(row => `${row.id}:${row.assetId ?? 'pending'}`).join(',')}</output>;
}
function Upload() {
  const [open, setOpen] = useState(true);
  return <IcpUploadPhotoSheet principal="paul" open={open} onOpenChange={setOpen} onUploaded={() => undefined}
    clubs={[{ id: 'riverdogs', name: 'Riverdogs' }]} teams={[]} miniLeagues={[]} competitions={[]} />;
}
beforeEach(() => {
  mocks.register.mockResolvedValue({ id: 'saved-photo' }); mocks.scope.mockResolvedValue(undefined);
  mocks.copy.mockResolvedValue(undefined);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:local-photo') }));
});
describe('actual upload workflow across navigation', () => {
  it('continues after leaving, restores pending previews and refreshes the inactive feed on completion', async () => {
    let resolveUpload: (value: unknown) => void = () => {};
    mocks.upload.mockReturnValue(new Promise(resolve => { resolveUpload = resolve; }));
    const client = new QueryClient();
    client.setQueryData(['icp-media-feed', 'paul'], { posts: [] });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const page = render(<><Upload /><Preview client={client} /></>, { wrapper });
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
    const input = page.container.querySelector('input[type="file"]');
    if (!input) throw new Error('File picker missing');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Share/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Share/ }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status').textContent).toContain('pending');
    page.unmount();
    const returned = render(<Preview client={client} />, { wrapper });
    expect(screen.getByRole('status').textContent).toContain('pending');
    returned.unmount();
    await act(async () => resolveUpload({ url: 'https://store/photo', blobRef: { path: 'photo', content_hash: 'hash' } }));
    await waitFor(() => expect(client.getQueryState(['icp-media-feed', 'paul'])?.isInvalidated).toBe(true));
    render(<Preview client={client} />, { wrapper });
    expect(screen.getByRole('status').textContent).toContain('saved-photo');
    expect(mocks.register).toHaveBeenCalledTimes(1);
    act(() => reconcileGalleryUploads(client, 'paul', ['saved-photo']));
    expect(screen.getByRole('status').textContent).toBe('');
  });
});