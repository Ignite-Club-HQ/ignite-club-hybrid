/**
 * Local port of the sanitized shared module
 * `reference/backend/supabase/functions/_shared/vaultDeleteRequest.ts.md`.
 *
 * Strict validation + canonical storage resolution for Vault permanent
 * deletion requests. Kept free of Deno globals so it runs identically under
 * Vitest.
 */
import { parseStorageObjectRef, type StorageObjectRef } from './storageUrlAuth';

export const MAX_DELETION_BATCH = 100;
export const ALLOWED_DELETION_TYPES = ['permanent', 'admin_cleanup', 'auto_purge'] as const;
export type DeletionType = (typeof ALLOWED_DELETION_TYPES)[number];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export interface ParsedDeleteRequest {
  photoIds: string[];
  fileIds: string[];
  deletionType: DeletionType;
}

export type ParseResult =
  | { ok: true; value: ParsedDeleteRequest }
  | { ok: false; code: 'invalid_request'; message: string };

function invalid(message: string): ParseResult {
  return { ok: false, code: 'invalid_request', message };
}

/**
 * Validate a permanent-deletion request body. Runs BEFORE any privileged query:
 * every id must be a well-formed UUID, duplicates are collapsed, the combined
 * batch is bounded and empty requests are rejected.
 */
export function parseVaultDeleteRequest(body: unknown): ParseResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return invalid('Request body must be a JSON object');
  }

  const raw = body as Record<string, unknown>;

  for (const key of Object.keys(raw)) {
    if (!['photoIds', 'fileIds', 'deletionType'].includes(key)) {
      return invalid('Unsupported field in request body');
    }
  }

  if (raw.photoIds !== undefined && !Array.isArray(raw.photoIds)) {
    return invalid('photoIds must be an array');
  }
  if (raw.fileIds !== undefined && !Array.isArray(raw.fileIds)) {
    return invalid('fileIds must be an array');
  }

  const rawPhotos = (raw.photoIds ?? []) as unknown[];
  const rawFiles = (raw.fileIds ?? []) as unknown[];

  if (rawPhotos.some((id) => !isUuid(id)) || rawFiles.some((id) => !isUuid(id))) {
    return invalid('All identifiers must be UUIDs');
  }

  const photoIds = Array.from(new Set(rawPhotos as string[]));
  const fileIds = Array.from(new Set(rawFiles as string[]));

  if (photoIds.length + fileIds.length === 0) {
    return invalid('At least one identifier is required');
  }
  if (photoIds.length + fileIds.length > MAX_DELETION_BATCH) {
    return invalid(`At most ${MAX_DELETION_BATCH} items may be deleted per request`);
  }

  const deletionType = raw.deletionType === undefined ? 'permanent' : raw.deletionType;
  if (
    typeof deletionType !== 'string' ||
    !(ALLOWED_DELETION_TYPES as readonly string[]).includes(deletionType)
  ) {
    return invalid('Unsupported deletionType');
  }

  return { ok: true, value: { photoIds, fileIds, deletionType: deletionType as DeletionType } };
}

/**
 * Canonical bucket/path for a stored record. Prefers stored metadata; falls back
 * to strict URL parsing (exact origin match, allowlisted buckets, traversal-safe).
 * Never accepts a bucket or path supplied by the client.
 */
export function resolveStorageRef(
  record: { storage_bucket?: string | null; storage_path?: string | null; url?: string | null },
  supabaseUrl: string,
): StorageObjectRef | null {
  const bucket = record.storage_bucket;
  const path = record.storage_path;
  if (bucket && path) {
    const synthetic = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
    return parseStorageObjectRef(synthetic, supabaseUrl);
  }
  if (!record.url) return null;
  return parseStorageObjectRef(record.url, supabaseUrl);
}
