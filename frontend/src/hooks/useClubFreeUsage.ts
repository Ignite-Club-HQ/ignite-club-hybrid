import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { withFeatureBackend } from "@/live/featureRouter";
import { isLiveClubPro } from "@/live/features/club";
import { getLiveClubMediaUsage } from "@/live/blobStoreUpload";

const REFRESH_EVENT = "club-free-usage:refresh";

/**
 * Trigger an immediate refresh of the Free-tier usage meter for a club.
 * Call this after any action that affects the cycle counters (photo
 * upload, file upload, poll create, chat image send) so the meter
 * reflects the new count without waiting for staleTime to elapse.
 */
export function notifyClubFreeUsageChanged(clubId?: string | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(REFRESH_EVENT, { detail: { clubId: clubId ?? null } }));
}

export const FREE_PHOTO_UPLOADS_PER_CYCLE = 10;
export const FREE_CHAT_PHOTOS_PER_CYCLE = 10;
export const FREE_FILE_COUNT = 10;
export const FREE_FILE_STORAGE_BYTES = 25 * 1024 * 1024; // 25 MB
export const FREE_CHAT_FILE_COUNT = 10;
export const FREE_CHAT_FILE_STORAGE_BYTES = 25 * 1024 * 1024; // 25 MB
export const FREE_POLLS_PER_CYCLE = 2;

export interface ClubFreeUsage {
  isPro: boolean;
  cycleStart: Date | null;
  cycleEnd: Date | null;
  photo: {
    used: number;
    limit: number;
    atCountCap: boolean;
    atCap: boolean;
  };
  chatPhoto: {
    used: number;
    limit: number;
    atCap: boolean;
  };
  file: {
    used: number;
    limit: number;
    storageUsed: number;
    storageLimit: number;
    atCountCap: boolean;
    atStorageCap: boolean;
    atCap: boolean;
  };
  chatFile: {
    used: number;
    limit: number;
    storageUsed: number;
    storageLimit: number;
    atCountCap: boolean;
    atStorageCap: boolean;
    atCap: boolean;
  };
  poll: {
    used: number;
    limit: number;
    atCap: boolean;
  };
}

export function resolveClubFreeUsage(row: Record<string, unknown>): ClubFreeUsage {
  const photoUsed = Number(row.photo_uploads_this_cycle ?? 0);
  const chatPhotoUsed = Number(row.chat_photo_uploads_this_cycle ?? 0);
  const fileUsed = Number(row.file_count ?? 0);
  const fileBytes = Number(row.file_storage_bytes ?? 0);
  const chatFileUsed = Number(row.chat_file_uploads_this_cycle ?? 0);
  const chatFileBytes = Number(row.chat_file_storage_bytes ?? 0);
  const pollUsed = Number(row.polls_this_cycle ?? 0);
  const isPro = !!row.is_pro;

  return {
    isPro,
    cycleStart: row.cycle_start ? new Date(String(row.cycle_start)) : null,
    cycleEnd: row.cycle_end ? new Date(String(row.cycle_end)) : null,
    photo: { used: photoUsed, limit: FREE_PHOTO_UPLOADS_PER_CYCLE, atCountCap: !isPro && photoUsed >= FREE_PHOTO_UPLOADS_PER_CYCLE, atCap: !isPro && photoUsed >= FREE_PHOTO_UPLOADS_PER_CYCLE },
    chatPhoto: { used: chatPhotoUsed, limit: FREE_CHAT_PHOTOS_PER_CYCLE, atCap: !isPro && chatPhotoUsed >= FREE_CHAT_PHOTOS_PER_CYCLE },
    file: { used: fileUsed, limit: FREE_FILE_COUNT, storageUsed: fileBytes, storageLimit: FREE_FILE_STORAGE_BYTES, atCountCap: !isPro && fileUsed >= FREE_FILE_COUNT, atStorageCap: !isPro && fileBytes >= FREE_FILE_STORAGE_BYTES, atCap: !isPro && (fileUsed >= FREE_FILE_COUNT || fileBytes >= FREE_FILE_STORAGE_BYTES) },
    chatFile: { used: chatFileUsed, limit: FREE_CHAT_FILE_COUNT, storageUsed: chatFileBytes, storageLimit: FREE_CHAT_FILE_STORAGE_BYTES, atCountCap: !isPro && chatFileUsed >= FREE_CHAT_FILE_COUNT, atStorageCap: !isPro && chatFileBytes >= FREE_CHAT_FILE_STORAGE_BYTES, atCap: !isPro && (chatFileUsed >= FREE_CHAT_FILE_COUNT || chatFileBytes >= FREE_CHAT_FILE_STORAGE_BYTES) },
    poll: { used: pollUsed, limit: FREE_POLLS_PER_CYCLE, atCap: !isPro && pollUsed >= FREE_POLLS_PER_CYCLE },
  };
}

export interface ClubFreeUsageSnapshot {
  isPro: boolean;
  photoUsed: number;
  cycleEnd: string | null;
}

const SNAPSHOT_PREFIX = "ignite_free_usage_snapshot_";

export function readClubFreeUsageSnapshot(
  clubId: string | null | undefined,
): ClubFreeUsageSnapshot | null {
  if (!clubId) return null;
  try {
    const raw = localStorage.getItem(`${SNAPSHOT_PREFIX}${clubId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ClubFreeUsageSnapshot>;
    if (typeof parsed.isPro !== "boolean") return null;
    return {
      isPro: parsed.isPro,
      photoUsed: Number(parsed.photoUsed ?? 0),
      cycleEnd: typeof parsed.cycleEnd === "string" ? parsed.cycleEnd : null,
    };
  } catch {
    return null;
  }
}

function writeClubFreeUsageSnapshot(clubId: string, snap: ClubFreeUsageSnapshot) {
  try {
    localStorage.setItem(`${SNAPSHOT_PREFIX}${clubId}`, JSON.stringify(snap));
  } catch {
    // storage full / unavailable — purely cosmetic, ignore
  }
}

/**
 * Read Free-tier usage counters for a club. Used to render usage meters and
 * gate uploads/polls at the call site. Returns isPro=true for clubs with
 * active Pro access — callers should skip caps in that case.
 */
export function useClubFreeUsage(clubId: string | null | undefined) {
  const enabled = !!clubId;
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["club-free-usage", clubId],
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ClubFreeUsage | null> => {
      if (resolveAuthBackend() === "icp") {
        const live = await withFeatureBackend("membership", {
          icp: async (ctx) => {
            const [isPro, media] = await Promise.all([
              isLiveClubPro(ctx, clubId!).catch(() => false),
              getLiveClubMediaUsage(ctx.target, ctx.identity, clubId!),
            ]);
            return { isPro, media };
          },
          supabase: async () => null,
        }, { clubId: clubId! });
        if (!live) return null;

        // Media caps are enforced by the photo-store canister per 30-day
        // cycle; polls are not capped on-chain.
        const { isPro, media } = live;
        const count = (c: string) => (isPro ? 0 : media[c]?.count ?? 0);
        const bytes = (c: string) => (isPro ? 0 : media[c]?.bytes ?? 0);
        const photoUsed = count("gallery_photo");
        const chatPhotoUsed = count("chat_photo");
        const fileUsed = count("vault");
        const fileBytes = bytes("vault");
        const chatFileUsed = count("chat_file");
        const chatFileBytes = bytes("chat_file");
        const fileCountCap = fileUsed >= FREE_FILE_COUNT;
        const fileStoreCap = fileBytes >= FREE_FILE_STORAGE_BYTES;
        const chatFileCountCap = chatFileUsed >= FREE_CHAT_FILE_COUNT;
        const chatFileStoreCap = chatFileBytes >= FREE_CHAT_FILE_STORAGE_BYTES;
        return {
          isPro,
          cycleStart: null,
          cycleEnd: null,
          photo: { used: photoUsed, limit: FREE_PHOTO_UPLOADS_PER_CYCLE, atCountCap: photoUsed >= FREE_PHOTO_UPLOADS_PER_CYCLE, atCap: photoUsed >= FREE_PHOTO_UPLOADS_PER_CYCLE },
          chatPhoto: { used: chatPhotoUsed, limit: FREE_CHAT_PHOTOS_PER_CYCLE, atCap: chatPhotoUsed >= FREE_CHAT_PHOTOS_PER_CYCLE },
          file: { used: fileUsed, limit: FREE_FILE_COUNT, storageUsed: fileBytes, storageLimit: FREE_FILE_STORAGE_BYTES, atCountCap: fileCountCap, atStorageCap: fileStoreCap, atCap: fileCountCap || fileStoreCap },
          chatFile: { used: chatFileUsed, limit: FREE_CHAT_FILE_COUNT, storageUsed: chatFileBytes, storageLimit: FREE_CHAT_FILE_STORAGE_BYTES, atCountCap: chatFileCountCap, atStorageCap: chatFileStoreCap, atCap: chatFileCountCap || chatFileStoreCap },
          poll: { used: 0, limit: FREE_POLLS_PER_CYCLE, atCap: false },
        };
      }

      const { data, error } = await supabase.rpc("get_club_free_usage", {
        _club_id: clubId!,
      });
      if (error) {
        console.error("[useClubFreeUsage] rpc failed", error);
        return null;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;

      const usage = resolveClubFreeUsage(row as Record<string, unknown>);

      writeClubFreeUsageSnapshot(clubId!, {
        isPro: usage.isPro,
        photoUsed: usage.photo.used,
        cycleEnd: row.cycle_end ? String(row.cycle_end) : null,
      });

      return usage;
    },
  });

  useEffect(() => {
    if (!enabled) return;
    const onRefresh = (e: Event) => {
      const detail = (e as CustomEvent<{ clubId: string | null }>).detail;
      if (!detail?.clubId || detail.clubId === clubId) {
        refetch();
      }
    };
    window.addEventListener(REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(REFRESH_EVENT, onRefresh);
  }, [enabled, clubId, refetch]);

  return { usage: data ?? null, isLoading, refetch };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
