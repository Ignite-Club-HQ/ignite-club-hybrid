import { supabase } from "@/integrations/supabase/client";

export const VAULT_BUCKET = "photos";

/** Project storage origin, derived from env — never hard-coded per environment. */
export function vaultStorageOrigin(): string {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) throw new Error("Storage is not configured");
  return url.replace(/\/$/, "");
}

export function buildVaultStorageUrl(storagePath: string): string {
  const encoded = storagePath.split("/").map(encodeURIComponent).join("/");
  return `${vaultStorageOrigin()}/storage/v1/object/public/${VAULT_BUCKET}/${encoded}`;
}

/**
 * Atomically reserve quota for an upload. The server evaluates the club's real
 * limit (Free / Pro / purchased) against committed usage PLUS other in-flight
 * reservations, so concurrent uploads cannot both slip past the boundary.
 * Returns null when there is no club scope to charge (unassigned uploads).
 */
export async function reserveVaultStorage(
  clubId: string | null | undefined,
  bytes: number,
): Promise<string | null> {
  if (!clubId) return null;
  const { data, error } = await supabase.rpc("reserve_vault_storage", {
    _club_id: clubId,
    _bytes: bytes,
  });
  if (error) {
    if ((error as { message?: string }).message?.includes("quota_exceeded")) {
      throw new Error("Storage limit reached. Delete files or purchase more storage.");
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row as { reservation_id?: string } | null)?.reservation_id ?? null;
}

export async function settleVaultStorage(reservationId: string | null, committed: boolean) {
  if (!reservationId) return;
  try {
    await supabase.rpc("settle_vault_storage", {
      _reservation_id: reservationId,
      _committed: committed,
    });
  } catch (err) {
    console.warn("[vaultUpload] failed to settle storage reservation", err);
  }
}

/** Best-effort removal of an orphaned object after a failed metadata insert. */
export async function compensateVaultUpload(storagePath: string) {
  try {
    await supabase.storage.from(VAULT_BUCKET).remove([storagePath]);
  } catch (err) {
    console.warn("[vaultUpload] failed to remove orphaned object", err);
  }
}
