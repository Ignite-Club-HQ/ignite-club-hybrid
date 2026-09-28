import { useState, useEffect, useCallback, useRef } from "react";
import { CachedProfile, cacheProfiles, fetchProfilesWithCache, getProfileFromCache, getProfilesFromCache, onProfileCacheUpdate, selectCachedProfilesByIds } from "@/lib/profileCache";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hook to fetch and cache multiple profiles efficiently
 * Returns cached profiles immediately, then updates with fresh data
 * AGGRESSIVE CACHING: Prioritizes cached/stale data to avoid blocking on DB
 * 
 * NEW: Automatically refreshes profiles when app becomes visible (e.g., phone unlock)
 */
export function useProfiles(ids: string[]) {
  const [profiles, setProfiles] = useState<Map<string, CachedProfile>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const lastFetchRef = useRef<number>(0);
  const idsRef = useRef<string[]>([]);
  idsRef.current = ids;

  // Core fetch function - can be called on mount or visibility change
  const fetchProfiles = useCallback(async (forceRefresh = false) => {
    const currentIds = idsRef.current;
    if (currentIds.length === 0) {
      setProfiles(new Map());
      return;
    }

    const uniqueIds = [...new Set(currentIds.filter(Boolean))];
    
    // Immediately set cached profiles (including stale ones)
    const { cached, missing, stale } = getProfilesFromCache(uniqueIds);
    if (cached.size > 0) {
      setProfiles(cached);
    }
    
    // Determine what needs fetching
    const needsFetch = forceRefresh ? uniqueIds : missing;
    const needsBackgroundRefresh = forceRefresh ? [] : stale;
    
    if (needsFetch.length > 0) {
      setIsLoading(true);
      try {
        const allProfiles = await fetchProfilesWithCache(uniqueIds, { allowStale: true, timeout: 15000 });
        setProfiles(allProfiles);
        lastFetchRef.current = Date.now();
      } finally {
        setIsLoading(false);
      }
    } else if (needsBackgroundRefresh.length > 0) {
      // Stale profiles exist - refresh in background without loading state
      fetchProfilesWithCache(uniqueIds, { allowStale: true, timeout: 15000 })
        .then(allProfiles => {
          setProfiles(allProfiles);
          lastFetchRef.current = Date.now();
        });
    }
  }, []);

  // Initial fetch on mount/ids change
  useEffect(() => {
    fetchProfiles(false);
  }, [ids.join(","), fetchProfiles]);

  // Listen for profile cache updates (e.g., when user edits their own profile)
  useEffect(() => {
    const unsubscribe = onProfileCacheUpdate((updatedId) => {
      if (idsRef.current.includes(updatedId)) {
        // Update state immediately from cache
        setProfiles(prev => {
          const updated = new Map(prev);
          const cached = getProfileFromCache(updatedId);
          if (cached) updated.set(updatedId, cached);
          return updated;
        });
      }
    });
    return unsubscribe;
  }, []);


  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const timeSinceLastFetch = Date.now() - lastFetchRef.current;
        // Only refresh if it's been more than 30 seconds since last fetch
        if (timeSinceLastFetch > 30000 && idsRef.current.length > 0) {
          console.log("[useProfiles] App became visible, refreshing profiles");
          fetchProfiles(true);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [fetchProfiles]);

  // Stable identity across `profiles` updates. Reads via ref so we never bust
  // memoised children (e.g. GroupChatMessageRow) when a background profile
  // hydration replaces the `profiles` Map. Children that actually need to
  // re-render on profile changes should subscribe to a profile-specific signal
  // or read `profiles` directly.
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const getProfile = useCallback((id: string) => {
    return profilesRef.current.get(id) || null;
  }, []);

  // Manual refresh function for external use
  const refreshProfiles = useCallback(() => {
    fetchProfiles(true);
  }, [fetchProfiles]);

  return { profiles, getProfile, isLoading, refreshProfiles };
}

/**
 * Fetch profiles and cache them - for use in async functions
 * Uses aggressive caching with stale data fallback
 */
export async function fetchAndCacheProfiles(ids: string[]): Promise<Map<string, CachedProfile>> {
  return fetchProfilesWithCache(ids, { allowStale: true, timeout: 15000 });
}

/**
 * Prefetch profiles for a list of user IDs (fire and forget)
 * Silent background fetch that doesn't block
 */
export function prefetchProfiles(ids: string[]) {
  if (ids.length === 0) return;
  
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const { missing } = getProfilesFromCache(uniqueIds);
  
  if (missing.length > 0) {
    // Use a moderate timeout for prefetch - wrapped in async IIFE for proper error handling
    (async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      try {
        const { data } = await selectCachedProfilesByIds(missing);
        
        clearTimeout(timeoutId);
        if (data) {
          cacheProfiles(data);
        }
      } catch {
        clearTimeout(timeoutId);
        // Silent fail for prefetch
      }
    })();
  }
}
