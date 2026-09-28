/**
 * Truthful reporting for permanent Vault deletion (large-file cleanup).
 *
 * Server contract (`permanent-delete-photos`, wrapped by
 * `permanentlyDeleteVaultItems`):
 *   { photosDeleted: number; filesDeleted: number;
 *     succeeded: Array<{ id: string; kind: "photo" | "file" }>;
 *     failed: Array<{ id: string; kind: "photo" | "file"; code: string }> }
 *
 * Only explicit, validated `succeeded[]` entries can ever count as deleted.
 * A successful entry is validated when it:
 *   - was part of the requested set (matching id AND kind),
 *   - appears only once (duplicates collapse),
 *   - is not also present in `failed[]`.
 * Aggregate counts are used only as a cap — never as evidence of an item-level
 * deletion — so they can shrink but never inflate deleted counts or freed bytes.
 */

export interface VaultDeleteCandidate {
  id: string;
  type: "photo" | "file";
  size: number;
}

export interface VaultDeleteServerResult {
  photosDeleted: number;
  filesDeleted: number;
  succeeded?: Array<{ id: string; kind: "photo" | "file" }>;
  failed: Array<{ id: string; kind: "photo" | "file"; code: string }>;
}

export interface VaultDeleteSummary {
  deletedIds: string[];
  failedIds: string[];
  deletedCount: number;
  failedCount: number;
  freedBytes: number;
}

const key = (kind: "photo" | "file", id: string) => `${kind}:${id}`;

export function summarizeVaultDeletion(
  selected: VaultDeleteCandidate[],
  result: VaultDeleteServerResult,
): VaultDeleteSummary {
  const requested = new Map<string, VaultDeleteCandidate>();
  for (const item of selected) requested.set(key(item.type, item.id), item);

  const failedKeys = new Set<string>();
  const unknownFailures: string[] = [];
  for (const f of result.failed || []) {
    if (!f?.id || (f.kind !== "photo" && f.kind !== "file")) continue;
    const k = key(f.kind, f.id);
    failedKeys.add(k);
    if (!requested.has(k)) unknownFailures.push(f.id);
  }

  // Validate item-level successes.
  const validatedKeys = new Set<string>();
  for (const s of result.succeeded || []) {
    if (!s?.id || (s.kind !== "photo" && s.kind !== "file")) continue;
    const k = key(s.kind, s.id);
    if (!requested.has(k)) continue; // unknown or kind mismatch
    if (failedKeys.has(k)) continue; // present in both -> failed
    validatedKeys.add(k); // set membership collapses duplicates
  }

  // Preserve selection order, then cap per kind by the server aggregates so a
  // smaller aggregate can never be exceeded.
  const validated = selected.filter((i) => validatedKeys.has(key(i.type, i.id)));
  const caps = {
    photo: Math.max(0, result.photosDeleted || 0),
    file: Math.max(0, result.filesDeleted || 0),
  };
  const used = { photo: 0, file: 0 };
  const creditable = validated.filter((i) => {
    if (used[i.type] >= caps[i.type]) return false;
    used[i.type]++;
    return true;
  });

  const creditableKeys = new Set(creditable.map((i) => key(i.type, i.id)));

  return {
    deletedIds: creditable.map((i) => i.id),
    failedIds: [
      ...selected.filter((i) => !creditableKeys.has(key(i.type, i.id))).map((i) => i.id),
      ...unknownFailures,
    ],
    deletedCount: creditable.length,
    failedCount: selected.length - creditable.length,
    freedBytes: creditable.reduce((sum, i) => sum + (i.size || 0), 0),
  };
}

export type VaultDeleteOutcome = "success" | "partial" | "failure";

/** One toast per operation — success and error are never shown together. */
export function buildVaultDeleteMessage(
  summary: VaultDeleteSummary,
  formatSize: (bytes: number) => string,
): { outcome: VaultDeleteOutcome; message: string } {
  if (summary.deletedCount === 0) {
    return { outcome: "failure", message: `No files were deleted; ${summary.failedCount} failed` };
  }
  const base = `Deleted ${summary.deletedCount} file(s), freed ${formatSize(summary.freedBytes)}`;
  if (summary.failedCount > 0) {
    return { outcome: "partial", message: `${base}; ${summary.failedCount} failed` };
  }
  return { outcome: "success", message: base };
}
