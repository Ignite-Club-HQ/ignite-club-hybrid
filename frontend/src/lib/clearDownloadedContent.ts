import { clearDeviceReadCacheStorage } from './deviceCacheBudget';
import { clearAllMessageCaches } from './messageCache';
import { clearMessagesPageCache } from './messagesPageCache';
import { forgetSavedQueryCopies } from './queryCachePersistence';
import { clearMediaCache } from './mediaCache';
import { clearClubTeamCache } from './clubTeamCache';

/** Never sweep a namespace: auth, drafts and write receipts must survive.
 * Saved key copies are removed here — sign-out keeps them for speed, so this
 * explicit action is the user's way of taking them back. */
export async function clearDownloadedContent(): Promise<void> {
  clearAllMessageCaches();
  clearMessagesPageCache();
  clearMediaCache();
  clearClubTeamCache();
  forgetSavedQueryCopies();
  const [photos, queries, signedUrls] = await Promise.all([
    import('@/live/deviceMediaCache'), import('./icpQueryCachePersist'),
    import('@/hooks/useSignedPhotoUrl'),
  ]);
  signedUrls.clearSignedUrlCache();
  photos.clearStoredDeviceKeys();
  await Promise.all([photos.clearDeviceCachedPhotos(), queries.clearPersistedIcpQueryCache()]);
  clearDeviceReadCacheStorage();
}