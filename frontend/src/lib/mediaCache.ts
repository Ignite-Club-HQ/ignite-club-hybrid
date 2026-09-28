// Local media cache for faster loading and offline support with stale-while-revalidate

import { supabase } from "@/integrations/supabase/client";

export interface CachedPhoto {
  id: string;
  file_url: string;
  title: string | null;
  caption?: string | null;
  created_at: string;
  uploader_id: string;
  team_id: string | null;
  club_id: string | null;
  folder_id: string | null;
  cached_at: number;
}

export interface CachedFolder {
  id: string;
  name: string;
  team_id: string | null;
  cached_at: number;
}

const PHOTOS_CACHE_KEY = "ignite_photos_cache";
const FOLDERS_CACHE_KEY = "ignite_folders_cache";
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours - fresh data
const STALE_TTL = 1000 * 60 * 60 * 48; // 48 hours - stale but usable
const MAX_CACHED_PHOTOS = 200;
const MAX_CACHED_FOLDERS = 50;

// In-memory caches for instant access
const photosMemoryCache = new Map<string, CachedPhoto[]>();
const foldersMemoryCache = new Map<string, CachedFolder[]>();
let memoryCacheLoaded = false;

// Debounced save timeouts
let savePhotosTimeout: number | null = null;
let saveFoldersTimeout: number | null = null;

function ensureMemoryCacheLoaded() {
  if (memoryCacheLoaded) return;
  try {
    // Check if localStorage is available (Safari private mode blocks it)
    if (typeof localStorage === 'undefined') {
      memoryCacheLoaded = true;
      return;
    }
    const photosStored = localStorage.getItem(PHOTOS_CACHE_KEY);
    if (photosStored) {
      const parsed = JSON.parse(photosStored) as Record<string, CachedPhoto[]>;
      Object.entries(parsed).forEach(([key, photos]) => {
        photosMemoryCache.set(key, photos);
      });
    }
    const foldersStored = localStorage.getItem(FOLDERS_CACHE_KEY);
    if (foldersStored) {
      const parsed = JSON.parse(foldersStored) as Record<string, CachedFolder[]>;
      Object.entries(parsed).forEach(([key, folders]) => {
        foldersMemoryCache.set(key, folders);
      });
    }
    memoryCacheLoaded = true;
  } catch {
    memoryCacheLoaded = true;
  }
}

// Duplicate declaration removed - already declared above

function savePhotosCache() {
  if (savePhotosTimeout) clearTimeout(savePhotosTimeout);
  savePhotosTimeout = window.setTimeout(() => {
    try {
      const obj: Record<string, CachedPhoto[]> = {};
      photosMemoryCache.forEach((photos, key) => {
        // Limit photos per context
        obj[key] = photos.slice(0, MAX_CACHED_PHOTOS);
      });
      localStorage.setItem(PHOTOS_CACHE_KEY, JSON.stringify(obj));
    } catch {
      try {
        localStorage.removeItem(PHOTOS_CACHE_KEY);
      } catch {}
    }
  }, 1000);
}

function saveFoldersCache() {
  if (saveFoldersTimeout) clearTimeout(saveFoldersTimeout);
  saveFoldersTimeout = window.setTimeout(() => {
    try {
      const obj: Record<string, CachedFolder[]> = {};
      foldersMemoryCache.forEach((folders, key) => {
        obj[key] = folders.slice(0, MAX_CACHED_FOLDERS);
      });
      localStorage.setItem(FOLDERS_CACHE_KEY, JSON.stringify(obj));
    } catch {
      try {
        localStorage.removeItem(FOLDERS_CACHE_KEY);
      } catch {}
    }
  }, 1000);
}

function isCacheFresh(cachedAt: number): boolean {
  return Date.now() - cachedAt < CACHE_TTL;
}

function isCacheStale(cachedAt: number): boolean {
  const age = Date.now() - cachedAt;
  return age >= CACHE_TTL && age < STALE_TTL;
}

function isCacheExpired(cachedAt: number): boolean {
  return Date.now() - cachedAt >= STALE_TTL;
}

// Get cache key for a specific context (team or club)
function getCacheKey(teamId: string | null, clubId: string | null, folderId: string | null): string {
  return `${teamId || 'no-team'}_${clubId || 'no-club'}_${folderId || 'no-folder'}`;
}

// Photos caching - with stale-while-revalidate support
export function getCachedPhotos(
  teamId: string | null,
  clubId: string | null,
  folderId: string | null,
  options: { allowStale?: boolean } = {}
): { photos: CachedPhoto[] | null; isStale: boolean } {
  const { allowStale = true } = options;
  ensureMemoryCacheLoaded();
  const key = getCacheKey(teamId, clubId, folderId);
  const photos = photosMemoryCache.get(key);
  
  if (!photos || photos.length === 0) return { photos: null, isStale: false };
  
  const cachedAt = photos[0].cached_at;
  
  // Fresh data
  if (isCacheFresh(cachedAt)) {
    return { photos, isStale: false };
  }
  
  // Stale but usable data
  if (isCacheStale(cachedAt) && allowStale) {
    return { photos, isStale: true };
  }
  
  // Expired - delete and return null
  if (isCacheExpired(cachedAt)) {
    photosMemoryCache.delete(key);
    return { photos: null, isStale: false };
  }
  
  return { photos: null, isStale: false };
}

export function cachePhotos(
  teamId: string | null,
  clubId: string | null,
  folderId: string | null,
  photos: Array<{
    id: string;
    file_url: string;
    title: string | null;
    caption?: string | null;
    created_at: string;
    uploader_id: string;
    team_id: string | null;
    club_id: string | null;
    folder_id: string | null;
  }>
) {
  ensureMemoryCacheLoaded();
  const key = getCacheKey(teamId, clubId, folderId);
  const now = Date.now();
  
  const cachedPhotos: CachedPhoto[] = photos.map(photo => ({
    ...photo,
    cached_at: now,
  }));
  
  photosMemoryCache.set(key, cachedPhotos);
  savePhotosCache();
}

export function addPhotoToCache(
  teamId: string | null,
  clubId: string | null,
  folderId: string | null,
  photo: {
    id: string;
    file_url: string;
    title: string | null;
    caption?: string | null;
    created_at: string;
    uploader_id: string;
    team_id: string | null;
    club_id: string | null;
    folder_id: string | null;
  }
) {
  ensureMemoryCacheLoaded();
  const key = getCacheKey(teamId, clubId, folderId);
  const existing = photosMemoryCache.get(key) || [];
  
  // Add to beginning (most recent first)
  const cachedPhoto: CachedPhoto = {
    ...photo,
    cached_at: Date.now(),
  };
  
  photosMemoryCache.set(key, [cachedPhoto, ...existing].slice(0, MAX_CACHED_PHOTOS));
  savePhotosCache();
}

export function removePhotoFromCache(photoId: string) {
  ensureMemoryCacheLoaded();
  photosMemoryCache.forEach((photos, key) => {
    const filtered = photos.filter(p => p.id !== photoId);
    if (filtered.length !== photos.length) {
      photosMemoryCache.set(key, filtered);
    }
  });
  savePhotosCache();
}

// Folders caching - with stale-while-revalidate support
export function getCachedFolders(
  teamId: string | null,
  clubId: string | null,
  options: { allowStale?: boolean } = {}
): { folders: CachedFolder[] | null; isStale: boolean } {
  const { allowStale = true } = options;
  ensureMemoryCacheLoaded();
  const key = `${teamId || 'no-team'}_${clubId || 'no-club'}`;
  const folders = foldersMemoryCache.get(key);
  
  if (!folders || folders.length === 0) return { folders: null, isStale: false };
  
  const cachedAt = folders[0].cached_at;
  
  if (isCacheFresh(cachedAt)) {
    return { folders, isStale: false };
  }
  
  if (isCacheStale(cachedAt) && allowStale) {
    return { folders, isStale: true };
  }
  
  if (isCacheExpired(cachedAt)) {
    foldersMemoryCache.delete(key);
    return { folders: null, isStale: false };
  }
  
  return { folders: null, isStale: false };
}

export function cacheFolders(
  teamId: string | null,
  clubId: string | null,
  folders: Array<{
    id: string;
    name: string;
    team_id: string | null;
  }>
) {
  ensureMemoryCacheLoaded();
  const key = `${teamId || 'no-team'}_${clubId || 'no-club'}`;
  const now = Date.now();
  
  const cachedFolders: CachedFolder[] = folders.map(folder => ({
    ...folder,
    cached_at: now,
  }));
  
  foldersMemoryCache.set(key, cachedFolders);
  saveFoldersCache();
}

// Clear all media cache
export function clearMediaCache() {
  photosMemoryCache.clear();
  foldersMemoryCache.clear();
  memoryCacheLoaded = false;
  try {
    localStorage.removeItem(PHOTOS_CACHE_KEY);
    localStorage.removeItem(FOLDERS_CACHE_KEY);
  } catch {}
}

// Clear cache for specific context
export function clearMediaCacheForContext(
  teamId: string | null,
  clubId: string | null,
  folderId: string | null
) {
  ensureMemoryCacheLoaded();
  const key = getCacheKey(teamId, clubId, folderId);
  photosMemoryCache.delete(key);
  savePhotosCache();
}

// Background refresh photos - fetches fresh data and updates cache silently
export async function backgroundRefreshPhotos(
  teamId: string | null,
  clubId: string | null,
  folderId: string | null,
  limit: number = 50
): Promise<CachedPhoto[] | null> {
  try {
    let query = supabase
      .from("photos")
      .select("id, file_url, title, caption, created_at, uploader_id, team_id, club_id, folder_id")
      .eq("show_in_feed", true)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (teamId) query = query.eq("team_id", teamId);
    if (clubId) query = query.eq("club_id", clubId);
    if (folderId) query = query.eq("folder_id", folderId);

    const { data, error } = await query;
    
    if (error || !data) return null;
    
    // Update cache with fresh data
    cachePhotos(teamId, clubId, folderId, data);
    
    return data.map(p => ({
      ...p,
      cached_at: Date.now(),
    }));
  } catch {
    return null;
  }
}

// Get feed photos from cache (null/null/null context)
export function getFeedPhotosFromCache(): { photos: CachedPhoto[] | null; isStale: boolean } {
  return getCachedPhotos(null, null, null, { allowStale: true });
}
