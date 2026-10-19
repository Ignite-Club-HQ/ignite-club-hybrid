import { writeOnce } from "@/live/clubScope";
import { supabase } from "@/integrations/supabase/client";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { withFeatureBackend } from "@/live/featureRouter";
import { getLiveVaultFile, permanentlyDeleteLiveVaultFile } from "@/live/features/vault";
import { deleteBlobFromStore } from "@/live/blobStoreUpload";
import { listBlobStoreKeys } from "@/live/mediaStorage";

/** Server-side batch bound for permanent-delete-photos. */
export const VAULT_DELETE_CHUNK = 100;

export interface VaultDeleteFailure {
  id: string;
  kind: "photo" | "file";
  code: string;
}

export interface VaultDeleteSuccess {
  id: string;
  kind: "photo" | "file";
}

export interface VaultDeleteResult {
  photosDeleted: number;
  filesDeleted: number;
  /** Explicit item-level server acknowledgements (deduplicated by kind+id). */
  succeeded: VaultDeleteSuccess[];
  failed: VaultDeleteFailure[];
}

const isKind = (k: unknown): k is "photo" | "file" => k === "photo" || k === "file";

/**
 * ICP branch of permanent vault deletion: hard-deletes each vault_domain file
 * row, then best-effort frees the matching media_blob_store bytes (a missing
 * blob-store canister id, or an already-removed blob, must never block the
 * metadata deletion that already succeeded).
 *
 * `photos.id` values have no counterpart on vault_domain (there is no
 * separate photos table), so `fileIds` here is every requested id — the
 * caller tags leftover `photoIds` as `unsupported_on_icp` failures.
 */
async function permanentlyDeleteVaultFilesIcp(fileIds: string[]): Promise<VaultDeleteResult> {
  let filesDeleted = 0;
  const succeeded: VaultDeleteSuccess[] = [];
  const failed: VaultDeleteFailure[] = [];

  for (const id of fileIds) {
    try {
      await withFeatureBackend("vault", {
        supabase: () => {
          throw new Error("unreachable: vault routing checked by the caller");
        },
        icp: async (ctx) => {
          const file = await getLiveVaultFile(ctx, id).catch(() => null);
          await permanentlyDeleteLiveVaultFile(ctx, id);
          const blobRef = file?.blob_ref?.[0];
          if (!blobRef) return;
          const storeKey = listBlobStoreKeys(ctx.target).find(
            (key) => ctx.target.canisterIds[key] === blobRef.canister,
          );
          if (!storeKey) return;
          try {
            await deleteBlobFromStore(ctx.target, ctx.identity, storeKey, blobRef.path);
          } catch (error) {
            // Metadata row is already gone; a stale/missing blob must not
            // surface as a deletion failure to the caller.
            console.warn("[vaultDelete] blob store cleanup failed", error);
          }
        },
      }, writeOnce({ vaultFileId: id }));
      filesDeleted += 1;
      succeeded.push({ id, kind: "file" });
    } catch (error) {
      failed.push({
        id,
        kind: "file",
        code: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  return { photosDeleted: 0, filesDeleted, succeeded, failed };
}

/**
 * Invoke the permanent-deletion function, chunked to the server's batch bound.
 * Aggregates per-item successes AND failures across every batch so partial
 * success is surfaced from explicit item-level acknowledgements, never inferred
 * from aggregate counts. A failed invocation throws, so later batches can never
 * be claimed as succeeded.
 */
export async function permanentlyDeleteVaultItems(opts: {
  photoIds?: string[];
  fileIds?: string[];
  deletionType?: string;
}): Promise<VaultDeleteResult> {
  const photoIds = Array.from(new Set(opts.photoIds ?? []));
  const fileIds = Array.from(new Set(opts.fileIds ?? []));
  const deletionType = opts.deletionType ?? "permanent";

  if (isFeatureRoutedToIcp("vault")) {
    const icpResult = await permanentlyDeleteVaultFilesIcp(fileIds);
    const photoFailures: VaultDeleteFailure[] = photoIds.map((id) => ({
      id,
      kind: "photo",
      code: "unsupported_on_icp",
    }));
    return {
      photosDeleted: icpResult.photosDeleted,
      filesDeleted: icpResult.filesDeleted,
      succeeded: icpResult.succeeded,
      failed: [...icpResult.failed, ...photoFailures],
    };
  }

  const batches: Array<{ photoIds: string[]; fileIds: string[] }> = [];
  const queue: Array<{ kind: "photo" | "file"; id: string }> = [
    ...photoIds.map((id) => ({ kind: "photo" as const, id })),
    ...fileIds.map((id) => ({ kind: "file" as const, id })),
  ];
  for (let i = 0; i < queue.length; i += VAULT_DELETE_CHUNK) {
    const slice = queue.slice(i, i + VAULT_DELETE_CHUNK);
    batches.push({
      photoIds: slice.filter((x) => x.kind === "photo").map((x) => x.id),
      fileIds: slice.filter((x) => x.kind === "file").map((x) => x.id),
    });
  }

  let photosDeleted = 0;
  let filesDeleted = 0;
  const succeededMap = new Map<string, VaultDeleteSuccess>();
  const failedMap = new Map<string, VaultDeleteFailure>();

  for (const batch of batches) {
    const { data, error } = await supabase.functions.invoke("permanent-delete-photos", {
      body: { ...batch, deletionType },
    });
    if (error) throw new Error(error.message);
    const result = data as
      | {
          photosDeleted?: number;
          filesDeleted?: number;
          succeeded?: Array<{ id?: unknown; kind?: unknown }>;
          failed?: Array<{ id?: unknown; kind?: unknown; code?: unknown }>;
        }
      | null;
    photosDeleted += result?.photosDeleted ?? 0;
    filesDeleted += result?.filesDeleted ?? 0;
    for (const s of result?.succeeded ?? []) {
      if (typeof s?.id !== "string" || !isKind(s.kind)) continue;
      succeededMap.set(`${s.kind}:${s.id}`, { id: s.id, kind: s.kind });
    }
    for (const f of result?.failed ?? []) {
      if (typeof f?.id !== "string" || !isKind(f.kind)) continue;
      failedMap.set(`${f.kind}:${f.id}`, {
        id: f.id,
        kind: f.kind,
        code: typeof f.code === "string" ? f.code : "unknown_error",
      });
    }
  }

  return {
    photosDeleted,
    filesDeleted,
    succeeded: [...succeededMap.values()],
    failed: [...failedMap.values()],
  };
}
