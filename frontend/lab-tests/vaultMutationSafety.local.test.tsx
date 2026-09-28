/**
 * Local equivalent of the exported `vaultMutationSafety.security.test.ts`
 * suite: request validation, canonical storage resolution, the
 * `permanent-delete-photos` edge-function contract, and upload quota /
 * compensation safety for the Vault feature.
 *
 * Request-validation and storage-resolution logic is exercised directly via
 * a faithful local port of the sanitized `_shared/vaultDeleteRequest.ts` +
 * `_shared/storageUrlAuth.ts` modules (pure, dependency-free — no Deno/
 * Supabase coupling). The edge-function contract and upload-safety
 * assertions read the real, currently-shipped frontend sources (`VaultPage`,
 * `vaultUpload`, `vaultUploadService`) and the sanitized, inert edge
 * function reference text — nothing is executed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  parseVaultDeleteRequest,
  resolveStorageRef,
  isUuid,
  MAX_DELETION_BATCH,
} from '../src/lab/edgeGuards/vaultDeleteRequest';

const SUPABASE_URL = 'https://ecsdwrarzfexssxtrymj.supabase.co';

function extractSanitizedSource(mdText: string): string {
  const lines = mdText.split('\n');
  const openIndex = lines.findIndex((line) => /^`{4,}/.test(line));
  if (openIndex === -1) throw new Error('Missing fenced source block in reference markdown');
  const closeIndex = lines.findIndex(
    (line, index) => index > openIndex && /^`{4,}\s*$/.test(line),
  );
  if (closeIndex === -1) throw new Error('Unterminated fenced source block in reference markdown');
  return lines.slice(openIndex + 1, closeIndex).join('\n');
}

const referenceRoot = path.resolve(__dirname, '../../reference/backend/supabase');
const fnSource = extractSanitizedSource(
  readFileSync(path.join(referenceRoot, 'functions/permanent-delete-photos/index.ts.md'), 'utf8'),
);

const uuid = (n: number) => `0000000${n}-0000-4000-8000-000000000000`.slice(-36);

describe('vault deletion — request validation', () => {
  it('1. rejects a non-object body', () => {
    expect(parseVaultDeleteRequest('nope').ok).toBe(false);
  });

  it('2. rejects an array body', () => {
    expect(parseVaultDeleteRequest([uuid(1)]).ok).toBe(false);
  });

  it('3. rejects null body', () => {
    expect(parseVaultDeleteRequest(null).ok).toBe(false);
  });

  it('4. rejects a body with no identifiers', () => {
    expect(parseVaultDeleteRequest({}).ok).toBe(false);
  });

  it('5. rejects empty arrays', () => {
    expect(parseVaultDeleteRequest({ photoIds: [], fileIds: [] }).ok).toBe(false);
  });

  it('6. rejects non-array photoIds', () => {
    expect(parseVaultDeleteRequest({ photoIds: uuid(1) }).ok).toBe(false);
  });

  it('7. rejects non-array fileIds', () => {
    expect(parseVaultDeleteRequest({ fileIds: {} }).ok).toBe(false);
  });

  it('8. rejects non-UUID photo identifiers', () => {
    expect(parseVaultDeleteRequest({ photoIds: ['all'] }).ok).toBe(false);
  });

  it('9. rejects SQL-ish injection strings as identifiers', () => {
    expect(parseVaultDeleteRequest({ fileIds: ["1' OR '1'='1"] }).ok).toBe(false);
  });

  it('10. rejects numeric identifiers', () => {
    expect(parseVaultDeleteRequest({ photoIds: [123] }).ok).toBe(false);
  });

  it('11. rejects unknown fields (no client-supplied club/team scope)', () => {
    const r = parseVaultDeleteRequest({ photoIds: [uuid(1)], clubId: uuid(2) });
    expect(r.ok).toBe(false);
  });

  it('12. rejects an unsupported deletionType', () => {
    expect(parseVaultDeleteRequest({ photoIds: [uuid(1)], deletionType: 'drop_table' }).ok).toBe(false);
  });

  it('13. defaults deletionType to permanent', () => {
    const r = parseVaultDeleteRequest({ photoIds: [uuid(1)] });
    expect(r.ok && r.value.deletionType).toBe('permanent');
  });

  it('14. accepts a valid mixed request', () => {
    const r = parseVaultDeleteRequest({ photoIds: [uuid(1)], fileIds: [uuid(2)] });
    expect(r.ok).toBe(true);
  });

  it('15. de-duplicates repeated identifiers', () => {
    const r = parseVaultDeleteRequest({ photoIds: [uuid(1), uuid(1)] });
    expect(r.ok && r.value.photoIds).toHaveLength(1);
  });

  it('16. enforces the batch bound across both arrays', () => {
    const many = Array.from({ length: MAX_DELETION_BATCH }, (_, i) =>
      `${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`);
    const r = parseVaultDeleteRequest({ photoIds: many, fileIds: [uuid(9)] });
    expect(r.ok).toBe(false);
  });

  it('17. isUuid rejects traversal-style strings', () => {
    expect(isUuid('../../etc/passwd')).toBe(false);
  });
});

describe('vault deletion — canonical storage resolution', () => {
  it('18. prefers stored bucket/path metadata over any URL', () => {
    const ref = resolveStorageRef(
      { storage_bucket: 'photos', storage_path: 'clubs/a/b.jpg', url: `${SUPABASE_URL}/storage/v1/object/public/photos/other.jpg` },
      SUPABASE_URL,
    );
    expect(ref).toEqual({ bucket: 'photos', path: 'clubs/a/b.jpg' });
  });

  it('19. falls back to parsing the stored URL', () => {
    const ref = resolveStorageRef(
      { url: `${SUPABASE_URL}/storage/v1/object/public/photos/clubs/a/b.jpg` },
      SUPABASE_URL,
    );
    expect(ref?.path).toBe('clubs/a/b.jpg');
  });

  it('20. rejects an external origin masquerading as storage', () => {
    const ref = resolveStorageRef(
      { url: `https://evil.example.com/storage/v1/object/public/photos/clubs/a/b.jpg` },
      SUPABASE_URL,
    );
    expect(ref).toBeNull();
  });

  it('21. rejects a non-allowlisted bucket', () => {
    const ref = resolveStorageRef(
      { url: `${SUPABASE_URL}/storage/v1/object/public/backups/dump.sql` },
      SUPABASE_URL,
    );
    expect(ref).toBeNull();
  });

  it('22. rejects path traversal in the stored path', () => {
    const ref = resolveStorageRef(
      { storage_bucket: 'photos', storage_path: 'clubs/../../secret.jpg' },
      SUPABASE_URL,
    );
    expect(ref).toBeNull();
  });

  it('23. rejects percent-encoded traversal in a URL', () => {
    const ref = resolveStorageRef(
      { url: `${SUPABASE_URL}/storage/v1/object/public/photos/clubs/%2e%2e/%2e%2e/secret.jpg` },
      SUPABASE_URL,
    );
    expect(ref).toBeNull();
  });

  it('24. returns null when there is nothing stored (external link)', () => {
    expect(resolveStorageRef({ url: null }, SUPABASE_URL)).toBeNull();
  });

  it('25. handles paths containing spaces safely', () => {
    const ref = resolveStorageRef(
      { storage_bucket: 'photos', storage_path: 'clubs/a/my file.pdf' },
      SUPABASE_URL,
    );
    expect(ref?.path).toBe('clubs/a/my file.pdf');
  });
});

describe('vault deletion — edge function contract', () => {
  it('26. derives the caller only from a verified bearer token', () => {
    expect(fnSource).toContain('auth.getUser(token)');
    expect(fnSource).not.toMatch(/body\.(userId|callerId)/);
  });

  it('27. authorizes every record server-side, per item', () => {
    expect(fnSource).toContain('admin.rpc(\n        "authorize_vault_deletion"');
    expect(fnSource).toContain('for (const item of items)');
  });

  it('28. validates the request before any privileged query', () => {
    const validateAt = fnSource.indexOf('parseVaultDeleteRequest(parsedBody)');
    const adminAt = fnSource.indexOf('createClient(supabaseUrl, serviceKey)');
    expect(validateAt).toBeGreaterThan(-1);
    expect(validateAt).toBeLessThan(adminAt);
  });

  it('29. writes the audit record atomically with the deletion job', () => {
    expect(fnSource).toContain('begin_vault_deletion');
    expect(fnSource).not.toContain('photo_deletion_logs');
    expect(fnSource).not.toContain('file_deletion_logs');
  });

  it('30. retains metadata when storage deletion fails, and marks the job retryable', () => {
    expect(fnSource).toContain('storage_delete_failed');
    expect(fnSource).toContain('fail_vault_deletion');
    expect(fnSource).toContain('continue; // metadata intentionally retained');
  });

  it('31. only removes metadata after storage removal succeeded', () => {
    const storageAt = fnSource.indexOf('admin.storage.from(ref.bucket).remove');
    const finalizeAt = fnSource.indexOf('finalize_vault_deletion');
    expect(storageAt).toBeLessThan(finalizeAt);
  });

  it('32. reports partial failures instead of a blanket success', () => {
    expect(fnSource).toContain('failed.length === 0 ? 200 : 207');
    expect(fnSource).toContain('success: failed.length === 0');
  });

  it('33. never leaks raw database or storage error text to the client', () => {
    expect(fnSource).not.toMatch(/error\.message\s*\}\)/);
    expect(fnSource).toContain('error: "unexpected_error"');
  });

  it('34. never trusts client-supplied bucket or object paths', () => {
    expect(fnSource).not.toMatch(/body\.(bucket|storagePath|objectPath)/);
    expect(fnSource).toContain('resolveStorageRef(');
  });
});

describe('vault uploads — quota and compensation', () => {
  const vaultPage = readFileSync(path.resolve(__dirname, '../src/pages/VaultPage.tsx'), 'utf8');
  const helper = readFileSync(path.resolve(__dirname, '../src/lib/vaultUpload.ts'), 'utf8');
  const uploadService = readFileSync(
    path.resolve(__dirname, '../src/features/vault/vaultUploadService.ts'),
    'utf8',
  );

  it('35. no hard-coded project origin remains in the vault UI', () => {
    expect(vaultPage).not.toContain('yabcfiuntwqjwvschnji');
    expect(helper).toContain('VITE_SUPABASE_URL');
  });

  it('36. quota is reserved server-side before bytes are written', () => {
    const reserveAt = uploadService.indexOf('dependencies.reserveStorage(');
    const uploadAt = uploadService.indexOf('client.storage');
    expect(reserveAt).toBeGreaterThan(-1);
    expect(reserveAt).toBeLessThan(uploadAt);
  });

  it('37. orphaned objects are removed and reservations released on insert failure', () => {
    expect(uploadService).toContain('dependencies.compensateUpload(storagePath)');
    expect(uploadService).toContain('dependencies.settleStorage(reservationId, false)');
    expect(uploadService).toContain('dependencies.settleStorage(reservationId, true)');
  });

  it('38. canonical bucket/path metadata is persisted with each upload', () => {
    expect(uploadService).toContain('storage_bucket: "photos"');
    expect(uploadService).toContain('storage_path: storagePath');
  });
});
