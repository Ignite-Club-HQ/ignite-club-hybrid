import { spawnSync } from 'node:child_process';

export function createJournalApi(repo, serialize, execute = spawnSync) {
  return (path, method = 'GET', body) => {
    const endpoint = `repos/${repo}${path ? `/${path}` : ''}`;
    const args = ['api', endpoint, '--method', method];
    if (body !== undefined) args.push('--input', '-');
    const result = execute('gh', args, {
      input: body !== undefined ? serialize(body) : undefined,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      // Never echo process output: it may contain credential-related diagnostics.
      throw new Error(`GitHub journal request failed (${method} ${endpoint}, exit ${result.status ?? 'unknown'}); no paid replay permitted`);
    }
    return JSON.parse(result.stdout);
  };
}