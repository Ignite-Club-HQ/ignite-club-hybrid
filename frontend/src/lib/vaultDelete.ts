import { supabase } from "@/integrations/supabase/client";

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

