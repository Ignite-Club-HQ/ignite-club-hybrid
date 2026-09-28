/**
 * Local port of the sanitized shared module
 * `reference/backend/supabase/functions/_shared/signedUrlBatch.ts.md`.
 *
 * Pure, dependency-injected batch logic for signing private Storage objects.
 * Extracted from the `get-signed-photo-url` Edge Function so it can be
 * tested without Deno/Supabase.
 */
import { parseStorageObjectRef, type StorageObjectRef } from './storageUrlAuth';

export interface Decision {
  bucket: string;
  path: string;
  allowed: boolean;
}

export interface SignBatchDeps {
  supabaseUrl: string;
  /** Batch authorization; must be called at most once per request. */
  authorize: (
    items: StorageObjectRef[],
  ) => Promise<{ data: Decision[] | null; error: { message: string } | null }>;
  sign: (
    bucket: string,
    path: string,
  ) => Promise<{ url: string | null; error: { message: string } | null }>;
}

export interface SignBatchResult {
  signedUrls: Record<string, string>;
  authorizationFailed?: boolean;
}

export async function signAuthorizedBatch(
  rawPaths: unknown[],
  deps: SignBatchDeps,
): Promise<SignBatchResult> {
  const refs = new Map<string, StorageObjectRef>();
  const signedUrls: Record<string, string> = {};

  for (const raw of rawPaths) {
    if (typeof raw !== 'string') continue;
    const ref = parseStorageObjectRef(raw, deps.supabaseUrl);
    if (ref) {
      refs.set(raw, ref);
      continue;
    }
    // Pass through only URLs that are not pretending to be storage objects.
    if (!/\/storage\/v1\/object\//.test(raw)) {
      signedUrls[raw] = raw;
    }
  }

  if (refs.size === 0) return { signedUrls };

  const { data, error } = await deps.authorize(Array.from(refs.values()));
  if (error) return { signedUrls: {}, authorizationFailed: true };

  const allowed = new Set(
    (data ?? []).filter((d) => d.allowed === true).map((d) => `${d.bucket}/${d.path}`),
  );

  for (const [raw, ref] of refs.entries()) {
    if (!allowed.has(`${ref.bucket}/${ref.path}`)) continue;
    const { url } = await deps.sign(ref.bucket, ref.path);
    if (url) signedUrls[raw] = url;
  }

  return { signedUrls };
}
