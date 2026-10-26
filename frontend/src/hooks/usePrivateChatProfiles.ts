import { useCallback, useEffect, useState } from 'react';
import { withFeatureBackend } from '@/live/featureRouter';
import { readChatRelationshipProfiles, type ChatProfile } from '@/live/chatRelationshipProfiles';

/** Decrypted chat names live only in this mounted audience, never the global
 * profile/message cache or persisted QueryClient snapshots. */
export function usePrivateChatProfiles(conversationId: string | undefined, viewerId: string | undefined, ids: readonly string[], enabled: boolean) {
  const idsKey = JSON.stringify([...new Set(ids)].sort());
  const scopeKey = JSON.stringify([conversationId, viewerId, idsKey, enabled]);
  const [snapshot, setSnapshot] = useState<{ key: string; profiles: Map<string, ChatProfile> }>();
  useEffect(() => {
    if (!enabled || !conversationId || !viewerId || !ids.length) return;
    let controller: AbortController | undefined;
    let disposed = false;
    const refresh = async () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      // Each visibility refresh rechecks the exact authority, not a device copy.
      setSnapshot(undefined);
      try {
        const profiles = await withFeatureBackend('messaging', {
          supabase: async () => { throw new Error('Private chat profiles require Internet Identity.'); },
          icp: owner => readChatRelationshipProfiles(owner, conversationId, JSON.parse(idsKey), current.signal),
        }, { conversationId });
        if (!disposed && !current.signal.aborted) setSnapshot({ key: scopeKey, profiles });
      } catch {
        // Messages stay usable with neutral author labels; denial never falls
        // back to an audience-agnostic name cache.
      }
    };
    void refresh();
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { disposed = true; controller?.abort(); document.removeEventListener('visibilitychange', visible); };
  }, [conversationId, viewerId, idsKey, enabled, scopeKey]);
  return useCallback((id: string) => snapshot?.key === scopeKey ? snapshot.profiles.get(id) ?? null : null, [snapshot, scopeKey]);
}