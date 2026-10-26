import type { FeatureBackendContext } from '@/live/featureRouter';
import { assertReadNotAborted } from '@/live/readDeadline';
import type { MediaPageCursor } from '@/live/mediaPaging';

/** Newest-first authoritative pages stop when the thumbnail strip is full. */
export async function readLatestTeamAssets(ctx: FeatureBackendContext, clubId: string, teamId: string, signal?: AbortSignal) {
  const { listLiveAssetsPage } = await import('@/live/features/media');
  let cursor: MediaPageCursor | null = null;
  const found = new Map<string, Awaited<ReturnType<typeof listLiveAssetsPage>>['assets'][number]>();
  do {
    assertReadNotAborted(signal);
    const page = await listLiveAssetsPage(ctx, clubId, cursor);
    assertReadNotAborted(signal);
    for (const asset of page.assets) if (!asset.deleted && asset.team_id?.[0] === teamId) found.set(asset.id, asset);
    cursor = page.next;
  } while (cursor && found.size < 6);
  return [...found.values()].sort((a, b) => Number(b.created_at_ms) - Number(a.created_at_ms)).slice(0, 6);
}