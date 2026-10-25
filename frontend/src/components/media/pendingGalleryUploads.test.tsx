import { QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { beginGalleryUpload, acknowledgeGalleryUpload, finishGalleryUpload, reconcileGalleryUploads, usePendingGalleryUploads } from './pendingGalleryUploads';

const row = (id: string, batchId = 'batch-1') => ({ id, batchId, src: `blob:${id}`, clubId: 'riverdogs',
  teamId: null, competitionId: null, clubName: 'Riverdogs', scopeName: null, isVideo: false });
describe('gallery upload navigation', () => {
  it('retains pending photos on remount without leaking to another account or client', () => {
    const client = new QueryClient();
    const first = renderHook(() => usePendingGalleryUploads(client, 'paul'));
    act(() => beginGalleryUpload(client, 'paul', [row('photo-1')]));
    expect(first.result.current.map(r => r.id)).toEqual(['photo-1']);
    first.unmount();
    const reopened = renderHook(() => usePendingGalleryUploads(client, 'paul'));
    expect(reopened.result.current[0]?.src).toBe('blob:photo-1');
    expect(renderHook(() => usePendingGalleryUploads(client, 'other')).result.current).toEqual([]);
    expect(renderHook(() => usePendingGalleryUploads(new QueryClient(), 'paul')).result.current).toEqual([]);
  });
  it('marks an inactive feed stale and retains confirmed photos until their exact IDs arrive', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });
    client.setQueryData(['icp-media-feed', 'paul'], { posts: [] });
    client.setQueryData(['icp-media-feed', 'other'], { posts: [] });
    beginGalleryUpload(client, 'paul', [row('photo-1')]);
    acknowledgeGalleryUpload(client, 'paul', 'photo-1', 'saved-1');
    await finishGalleryUpload(client, 'paul', 'batch-1');
    expect(client.getQueryState(['icp-media-feed', 'paul'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['icp-media-feed', 'other'])?.isInvalidated).toBe(false);
    const reopened = renderHook(() => usePendingGalleryUploads(client, 'paul'));
    expect(reopened.result.current[0]?.settled).toBe(true);
    act(() => reconcileGalleryUploads(client, 'paul', ['unrelated']));
    expect(reopened.result.current).toHaveLength(1);
    act(() => reconcileGalleryUploads(client, 'paul', ['saved-1']));
    expect(reopened.result.current).toEqual([]);
  });
  it('settles only the finished batch, retaining partial successes and concurrent uploads', async () => {
    const client = new QueryClient();
    beginGalleryUpload(client, 'paul', [row('saved'), row('failed'), row('concurrent', 'batch-2')]);
    acknowledgeGalleryUpload(client, 'paul', 'saved', 'asset-1');
    await finishGalleryUpload(client, 'paul', 'batch-1');
    const reopened = renderHook(() => usePendingGalleryUploads(client, 'paul'));
    expect(reopened.result.current.map(r => r.id)).toEqual(['saved', 'concurrent']);
    expect(reopened.result.current[1]?.settled).toBeUndefined();
  });
});