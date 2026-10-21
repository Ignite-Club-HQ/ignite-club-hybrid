import { createHash } from 'node:crypto';

/** Read the exact acknowledged commit, not a potentially stale branch head.
 * Never retry a write: an unknown write result must stop before any install. */
export function persistGroup2Journal(api, path, branch, stored, journal, label) {
  const json = JSON.stringify(journal);
  const bytes = Buffer.from(json);
  const expectedSha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const saved = api(path, 'PUT', { branch, message: `Group 2 ${label} checkpoint`,
    content: bytes.toString('base64'), ...(stored ? { sha: stored.sha } : {}) });
  const commit = saved?.commit?.sha;
  if (!/^[a-f0-9]{40}$/.test(commit ?? '') || saved?.content?.sha !== expectedSha) {
    throw new Error(`${label} checkpoint acknowledgement invalid; stop without replay`);
  }
  const verified = api(`${path}?ref=${commit}`);
  if (verified?.sha !== expectedSha || verified?.encoding !== 'base64' ||
      typeof verified.content !== 'string' ||
      !Buffer.from(verified.content, 'base64').equals(bytes)) {
    throw new Error(`${label} intent readback failed at acknowledged commit; stop without replay`);
  }
  return verified;
}