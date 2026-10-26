// Durable remote recovery: mirrors the local migration journal to a dedicated
// branch of the migration repository via the GitHub contents API, so a lost
// runner can resume. Every push is read back and hash-verified; a failed or
// mismatched write stops the run (the local journal is retained, never
// replayed blindly).

import { createHash } from 'node:crypto';

const BRANCH = 'migration-journals';

export function remoteJournalPath(clubId) {
  return `journals/${clubId}.json`;
}

function remoteConfig(env) {
  const token = env.MIGRATION_JOURNAL_TOKEN ?? env.GITHUB_TOKEN;
  const repo = env.MIGRATION_JOURNAL_REPO ?? env.GITHUB_REPOSITORY;
  if (!token || !repo) return null;
  return { token, repo, base: `https://api.github.com/repos/${repo}/contents` };
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Fetch the remote journal for a club, or null when none exists. */
export async function pullJournal(env, clubId, fetchImpl = fetch) {
  const cfg = remoteConfig(env);
  if (!cfg) return null; // remote persistence not configured -> local only
  const get = (ref) => fetchImpl(`${cfg.base}/${remoteJournalPath(clubId)}${ref ? `?ref=${ref}` : ''}`, {
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json' },
  });
  let res = await get(BRANCH);
  if (res.status === 404) res = await get(null); // first push may have landed on the default branch
  if (res.status === 404) return null;
  if (!res.ok) throw Error(`Remote journal read failed: ${res.status}`);
  const body = await res.json();
  const text = Buffer.from(body.content, 'base64').toString('utf8');
  return { journal: JSON.parse(text), sha: body.sha, hash: sha256(text) };
}

/**
 * Push the journal and verify the readback. Throws on any failure — the
 * caller treats that as an unknown outcome and stops.
 */
export async function pushJournal(env, clubId, journal, fetchImpl = fetch) {
  const cfg = remoteConfig(env);
  if (!cfg) return false; // not configured -> caller keeps local-only journal
  const text = JSON.stringify(journal, null, 2);
  const existing = await pullJournal(env, clubId, fetchImpl);
  if (existing && existing.journal.planHash !== journal.planHash) {
    throw Error('Remote journal belongs to a different plan; refusing to overwrite');
  }
  const put = (branch) => fetchImpl(`${cfg.base}/${remoteJournalPath(clubId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `migration journal ${clubId} (${Object.keys(journal.steps ?? {}).length} steps)`,
      content: Buffer.from(text, 'utf8').toString('base64'),
      ...(branch ? { branch } : {}),
      ...(existing ? { sha: existing.sha } : {}),
    }),
  });
  let res = await put(BRANCH);
  // First ever push: the journal branch may not exist yet — create the file
  // on the default branch instead of failing the migration step.
  if (!res.ok && !existing && (res.status === 404 || res.status === 422)) res = await put(null);
  if (!res.ok) throw Error(`Remote journal write failed: ${res.status}`);
  const back = await pullJournal(env, clubId, fetchImpl);
  if (!back || back.hash !== sha256(text)) throw Error('Remote journal readback mismatch; stopping before any further write');
  return true;
}
