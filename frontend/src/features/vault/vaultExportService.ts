import JSZip from "jszip";

export interface VaultZipPhoto {
  id: string;
  file_url: string;
  title?: string | null;
  path?: string | null;
}

export interface VaultZipFile {
  id: string;
  file_url: string;
  name: string;
  path?: string | null;
}

export interface VaultZipFailure {
  id: string;
  type: "photo" | "file";
  error: unknown;
}

export interface VaultZipResult {
  blob: Blob | null;
  successfulCount: number;
  failures: VaultZipFailure[];
}

interface VaultZipWriter {
  file(path: string, data: Blob): unknown;
  generateAsync(options: { type: "blob" }): Promise<Blob>;
}

type VaultExportFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "blob">>;

export interface BuildVaultZipOptions {
  photos: ReadonlyArray<VaultZipPhoto>;
  files: ReadonlyArray<VaultZipFile>;
  signal: AbortSignal;
  onProgress?: (successfulCount: number, totalCount: number) => void;
  onItemFailure?: (failure: VaultZipFailure) => void;
  fetcher?: VaultExportFetcher;
  zipFactory?: () => VaultZipWriter;
}

export const VAULT_EXPORT_CANCELLED_MESSAGE = "Export cancelled";

const throwIfCancelled = (signal: AbortSignal) => {
  if (signal.aborted) throw new Error(VAULT_EXPORT_CANCELLED_MESSAGE);
};

const isCancelled = (error: unknown, signal: AbortSignal) =>
  signal.aborted ||
  (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError");

/**
 * Fetch Vault items sequentially and assemble a ZIP while allowing individual
 * download failures. Cancellation always stops the whole export immediately.
 */
export async function buildVaultZip({
  photos,
  files,
  signal,
  onProgress,
  onItemFailure,
  fetcher = fetch,
  zipFactory = () => new JSZip(),
}: BuildVaultZipOptions): Promise<VaultZipResult> {
  const zip = zipFactory();
  const totalCount = photos.length + files.length;
  const failures: VaultZipFailure[] = [];
  let successfulCount = 0;

  const addItem = async (
    item: VaultZipPhoto | VaultZipFile,
    type: VaultZipFailure["type"],
    filename: string,
  ) => {
    throwIfCancelled(signal);
    try {
      const response = await fetcher(item.file_url, { signal });
      const blob = await response.blob();
      throwIfCancelled(signal);
      const fullPath = item.path ? `${item.path}/${filename}` : filename;
      zip.file(fullPath, blob);
      successfulCount += 1;
      onProgress?.(successfulCount, totalCount);
    } catch (error) {
      if (isCancelled(error, signal)) throw new Error(VAULT_EXPORT_CANCELLED_MESSAGE);
      const failure = { id: item.id, type, error };
      failures.push(failure);
      onItemFailure?.(failure);
    }
  };

  for (const photo of photos) {
    await addItem(photo, "photo", photo.title || `photo-${photo.id}.jpg`);
  }
  for (const file of files) {
    await addItem(file, "file", file.name);
  }

  if (successfulCount === 0) {
    return { blob: null, successfulCount, failures };
  }

  throwIfCancelled(signal);
  const blob = await zip.generateAsync({ type: "blob" });
  throwIfCancelled(signal);
  return { blob, successfulCount, failures };
}
