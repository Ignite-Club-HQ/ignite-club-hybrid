/**
 * Truthful folder ZIP export.
 *
 * Invariants:
 *  1. Only items actually added to the ZIP are counted as exported.
 *  2. Photo failures and file failures are tracked separately.
 *  3. Cancellation stops immediately (checked before each request and again
 *     after the fetch resolves) and never produces a ZIP.
 *  4. An individual failure never aborts the remaining items.
 *  5. If nothing was added, no ZIP is generated.
 *  6. Progress advances for every *processed* item; the reported success count
 *     includes only successfully added items.
 */

export interface ZipExportItem {
  id: string;
  kind: "photo" | "file";
  url: string;
  filename: string;
}

export interface ZipExportResult {
  processed: number;
  added: number;
  failedPhotos: number;
  failedFiles: number;
  cancelled: boolean;
}

export interface ZipExportDeps {
  fetchBlob: (url: string, signal?: AbortSignal) => Promise<Blob>;
  addToZip: (filename: string, blob: Blob) => void;
  onProgress?: (processed: number) => void;
  isAborted: () => boolean;
  signal?: AbortSignal;
}

/** Photos are processed before files (preserved ordering guarantee). */
export function orderZipExportItems(items: ZipExportItem[]): ZipExportItem[] {
  return [
    ...items.filter((i) => i.kind === "photo"),
    ...items.filter((i) => i.kind === "file"),
  ];
}

export async function runZipExport(
  items: ZipExportItem[],
  deps: ZipExportDeps,
): Promise<ZipExportResult> {
  const result: ZipExportResult = {
    processed: 0,
    added: 0,
    failedPhotos: 0,
    failedFiles: 0,
    cancelled: false,
  };

  for (const item of orderZipExportItems(items)) {
    if (deps.isAborted()) {
      result.cancelled = true;
      return result;
    }
    try {
      const blob = await deps.fetchBlob(item.url, deps.signal);
      if (deps.isAborted()) {
        result.cancelled = true;
        return result;
      }
      deps.addToZip(item.filename, blob);
      result.added++;
    } catch {
      if (deps.isAborted()) {
        result.cancelled = true;
        return result;
      }
      if (item.kind === "photo") result.failedPhotos++;
      else result.failedFiles++;
    }
    result.processed++;
    deps.onProgress?.(result.processed);
  }

  return result;
}

export type ZipExportOutcome = "cancelled" | "failure" | "partial" | "success";

export function summarizeZipExport(result: ZipExportResult): {
  outcome: ZipExportOutcome;
  message: string;
  shouldDownload: boolean;
} {
  if (result.cancelled) {
    return { outcome: "cancelled", message: "Export cancelled", shouldDownload: false };
  }
  const failed = result.failedPhotos + result.failedFiles;
  if (result.added === 0) {
    return { outcome: "failure", message: "No files could be added to ZIP", shouldDownload: false };
  }
  if (failed > 0) {
    return {
      outcome: "partial",
      message: `Exported ${result.added} items as ZIP, ${failed} failed`,
      shouldDownload: true,
    };
  }
  return {
    outcome: "success",
    message: `Exported ${result.added} items as ZIP`,
    shouldDownload: true,
  };
}
