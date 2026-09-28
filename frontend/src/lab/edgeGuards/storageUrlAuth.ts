/**
 * Local port of the sanitized shared module
 * `reference/backend/supabase/functions/_shared/storageUrlAuth.ts.md`.
 *
 * Authorizes Supabase Storage object access before signing: only URLs that
 * genuinely belong to the configured project origin, in a recognized private
 * bucket, with a traversal-safe path, resolve to a storage reference.
 */

export const PRIVATE_BUCKETS = ['photos', 'chat-attachments', 'avatars'] as const;
export type PrivateBucket = (typeof PRIVATE_BUCKETS)[number];

export const MIN_EXPIRES_IN = 60;
export const MAX_EXPIRES_IN = 3600;
export const DEFAULT_EXPIRES_IN = 3600;

export interface StorageObjectRef {
  bucket: PrivateBucket;
  path: string;
}

/**
 * Validate and clamp a caller-supplied `expiresIn`.
 * Only finite integers are accepted; anything else falls back to the default.
 * Values outside [MIN, MAX] are clamped.
 */
export function normalizeExpiresIn(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return DEFAULT_EXPIRES_IN;
  }
  if (value < MIN_EXPIRES_IN) return MIN_EXPIRES_IN;
  if (value > MAX_EXPIRES_IN) return MAX_EXPIRES_IN;
  return value;
}

function isTraversal(path: string): boolean {
  if (!path) return true;
  const segments = path.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return true;
  if (path.includes('\\') || path.includes('\0')) return true;
  return false;
}

/**
 * Resolve a caller-supplied URL to a { bucket, path } pair, but ONLY when the URL
 * genuinely belongs to this project's Storage origin and a recognized private
 * bucket. Returns null for public/unknown/external/malformed URLs.
 */
export function parseStorageObjectRef(
  rawUrl: string,
  supabaseUrl: string,
): StorageObjectRef | null {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return null;

  let url: URL;
  let origin: URL;
  try {
    url = new URL(rawUrl);
    origin = new URL(supabaseUrl);
  } catch {
    return null;
  }

  // The URL must genuinely be hosted on the configured Storage origin — a
  // malicious external URL containing a matching path substring is rejected.
  if (url.origin !== origin.origin) return null;

  const match = url.pathname.match(
    /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/,
  );
  if (!match) return null;

  const bucket = match[1];
  if (!(PRIVATE_BUCKETS as readonly string[]).includes(bucket)) return null;

  let path: string;
  try {
    path = decodeURIComponent(match[2]);
  } catch {
    return null; // undecodable path
  }

  if (isTraversal(path)) return null;

  return { bucket: bucket as PrivateBucket, path };
}
