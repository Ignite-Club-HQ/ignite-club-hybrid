import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { resolveClubProAccess } from "@/lib/proEntitlement";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";

export const CLUB_MEDIA_BASE_BYTES = 5 * 1024 ** 3;
type Client = SupabaseClient<Database>;
export type StoredClubMedia = { path: string; bucket: string; size: number };

function assertSupabaseMediaAllowancePath(): void {
  if (isFeatureRoutedToIcp("vault")) {
    throw new Error("Club storage must be checked through its Internet Computer photo store.");
  }
}

// Count physical objects, not gallery/vault mirrors or forwarded message URLs.
// Storage listing is paged and errors never masquerade as zero usage.
export async function listStoredClubMedia(clubId: string, client: Client = supabase): Promise<StoredClubMedia[]> {
  assertSupabaseMediaAllowancePath();
  const objects: StoredClubMedia[] = [];
  for (const bucket of ["photos", "chat-attachments", "competition-vault"]) {
    const folders = [`clubs/${clubId}`];
    while (folders.length) {
      const folder = folders.pop();
      if (!folder) continue;
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await client.storage.from(bucket).list(folder, {
          limit: 1000, offset, sortBy: { column: "name", order: "asc" },
        });
        if (error) throw error;
        for (const entry of data ?? []) {
          const path = `${folder}/${entry.name}`;
          if (!entry.id && !entry.metadata) folders.push(path);
          else {
            const size = Number(entry.metadata?.size);
            if (!Number.isFinite(size) || size < 0) throw new Error("Could not check club storage. Please try again.");
            objects.push({ path, bucket, size });
          }
        }
        if (!data || data.length < 1000) break;
      }
    }
  }
  return objects;
}

export function clubMediaLimit(purchasedGb: number): number {
  if (!Number.isFinite(purchasedGb) || purchasedGb < 0) throw new Error("Could not check storage allowance.");
  return CLUB_MEDIA_BASE_BYTES + purchasedGb * 1024 ** 3;
}

export function assertClubMediaFits(used: number, requested: number, purchasedGb: number): void {
  if (!Number.isFinite(used) || used < 0 || !Number.isFinite(requested) || requested < 0) {
    throw new Error("Could not check club storage. Please try again.");
  }
  if (used + requested > clubMediaLimit(purchasedGb)) {
    throw new Error("Your club has used all of its storage. Delete files or purchase more storage to keep uploading.");
  }
}

const uploads = new Map<string, Promise<unknown>>();

/** App-side only: serialize same-device uploads through the check and write. */
export async function uploadWithinClubMediaAllowance<T>(
  clubId: string | null | undefined,
  bytes: number,
  upload: () => Promise<T>,
  client: Client = supabase,
): Promise<T> {
  assertSupabaseMediaAllowancePath();
  if (!clubId) return upload(); // Personal/competition-only chats have no club pot.
  const previous = uploads.get(clubId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    assertSupabaseMediaAllowancePath();
    const { data: sub, error } = await client.from("club_subscriptions")
      .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at, is_trial, trial_ends_at, storage_purchased_gb")
      .eq("club_id", clubId).maybeSingle();
    if (error) throw error;
    const trial = sub?.is_trial && (!sub.trial_ends_at || new Date(sub.trial_ends_at) > new Date());
    if (resolveClubProAccess(sub).hasPro || trial) {
      const objects = await listStoredClubMedia(clubId, client);
      assertClubMediaFits(objects.reduce((sum, object) => sum + object.size, 0), bytes, Number(sub?.storage_purchased_gb ?? 0));
    }
    assertSupabaseMediaAllowancePath();
    return upload();
  });
  uploads.set(clubId, current);
  try { return await current; }
  finally { if (uploads.get(clubId) === current) uploads.delete(clubId); }
}