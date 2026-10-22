import { CLUB_MEDIA_BYTES, mediaAllowance, type MediaSubscription } from "@/lib/subscriptionPlans";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { getActiveSupabaseTarget } from "@/live/targetRegistry";
import { MEASURED_MEDIA_UPLOAD_ENABLED } from "./mediaUploadRelease";

export const CLUB_MEDIA_BASE_BYTES = CLUB_MEDIA_BYTES;
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

type MeasuredUpload = { bucket: string; path: string; file: Blob; vault?: boolean };

async function uploadMeasuredMedia(clubId: string, teamId: string | null | undefined, input: MeasuredUpload, client: Client) {
  const { data: { session }, error } = await client.auth.getSession();
  if (error || !session) throw new Error("Sign-in required");
  const target = getActiveSupabaseTarget();
  const response = await fetch(`${target.url}/functions/v1/verify-iap-receipt-icp?job=media-upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${session.access_token}`, apikey: target.anonKey,
      "content-type": input.file.type || "application/octet-stream", "x-media-club": clubId,
      "x-media-team": teamId ?? "", "x-media-bucket": input.bucket, "x-media-path": input.path,
      "x-media-vault": String(input.vault ?? false) },
    body: input.file,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Upload could not be confirmed.");
  if (result.path !== input.path || result.measured_bytes !== input.file.size) throw new Error("Upload confirmation did not match the file.");
  return { data: { path: input.path }, error: null };
}

/** App-side only: serialize same-device uploads through the check and write. */
export async function uploadWithinClubMediaAllowance<T>(
  clubId: string | null | undefined,
  bytes: number,
  upload: () => Promise<T>,
  client: Client = supabase,
  teamId?: string | null,
  measuredUpload?: MeasuredUpload,
): Promise<T> {
  assertSupabaseMediaAllowancePath();
  if (!clubId) return upload(); // Personal/competition-only chats have no club pot.
  const previous = uploads.get(clubId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    assertSupabaseMediaAllowancePath();
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Could not check file size.");
    const { data: sub, error } = await client.from("club_subscriptions")
      .select("plan, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at, is_trial, trial_ends_at, storage_purchased_gb, pricing_version")
      .eq("club_id", clubId).maybeSingle();
    if (error) throw error;
    let teamSub: MediaSubscription = null;
    if (teamId) {
      const { data: team, error: teamError } = await client.from("teams").select("club_id, deleted_at").eq("id", teamId).maybeSingle();
      if (teamError) throw teamError;
      if (team?.club_id !== clubId || team.deleted_at) throw new Error("Team does not belong to this club.");
      const { data, error: subscriptionError } = await client.from("team_subscriptions")
        .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at, is_trial, trial_ends_at")
        .eq("team_id", teamId).maybeSingle();
      if (subscriptionError) throw subscriptionError;
      teamSub = data;
    }
    const allowance = mediaAllowance(sub, teamSub);
    const objects = await listStoredClubMedia(clubId, client);
    const scoped = allowance.teamScoped ? objects.filter(object => object.path.startsWith(`clubs/${clubId}/teams/${teamId}/`) || object.path.startsWith(`clubs/${clubId}/vault/teams/${teamId}/`)) : objects;
    const used = scoped.reduce((sum, object) => sum + object.size, 0);
    if (used + bytes > allowance.limitBytes) {
      throw new Error(allowance.premium ? "Your storage allowance is full. Delete files or purchase more storage to keep uploading." : "Your club has used its 250 MB Free storage. Delete files or upgrade to Pro to keep uploading.");
    }
    assertSupabaseMediaAllowancePath();
    if (MEASURED_MEDIA_UPLOAD_ENABLED && measuredUpload) return await uploadMeasuredMedia(clubId, teamId, measuredUpload, client) as T;
    return upload();
  });
  uploads.set(clubId, current);
  try { return await current; }
  finally { if (uploads.get(clubId) === current) uploads.delete(clubId); }
}