/**
 * Local equivalent of the exported `prodHotfixParity.guard.test.ts` suite.
 *
 * Guards the PROD hotfix that requires PROD pg_cron jobs to authenticate
 * with a service-role bearer token: every cron-invoked Edge Function must
 * authorise via the shared `isAuthorizedCronCaller` helper (CRON_SECRET *or*
 * service-role). Reverting any of these to a CRON_SECRET-only check makes
 * the schedules 401 silently. Reads the sanitized, inert reference edge
 * function sources as text only; nothing is executed.
 *
 * One assertion had to be reconstructed: the export sanitizer redacted the
 * literal string the original test checked for in
 * `process-message-notifications` (`toContain("******")`). The deployed
 * source derives its service-role client from `SUPABASE_SERVICE_KEY` (never
 * the deprecated `supabaseServiceKey` name), which matches the test's
 * stated intent ("dispatches with the defined service key").
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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

const functionsRoot = path.resolve(__dirname, '../../reference/backend/supabase/functions');
const read = (relPath: string) =>
  extractSanitizedSource(readFileSync(path.join(functionsRoot, relPath), 'utf8'));

const CRON_FUNCTIONS = [
  'notify-game-kickoff',
  'send-event-reminders',
  'process-duty-points',
  'expire-subscriptions',
  'auto-purge-trash',
  'cleanup-deleted-accounts',
  'send-renewal-reminders',
  'send-engagement-reminders',
  'send-storage-warnings',
  'process-weekly-engagement-digest',
  'reconcile-legacy-subscriptions',
];

describe('PROD notification hotfix stays in the codebase', () => {
  it('ships the shared cron caller auth helper', () => {
    const src = read('_shared/cron-auth.ts.md');
    expect(src).toContain('export async function isAuthorizedCronCaller');
    expect(src).toContain('CRON_SECRET');
    expect(src).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(src).toContain('/auth/v1/admin/users');
  });

  it.each(CRON_FUNCTIONS)('%s authorises via isAuthorizedCronCaller', (fn) => {
    const src = read(`${fn}/index.ts.md`);
    expect(src).toMatch(/from ['"]\.\.\/_shared\/cron-auth\.ts['"]/);
    expect(src).toMatch(/await isAuthorizedCronCaller\(req\)/);
    // No bare CRON_SECRET-only gate left behind.
    expect(src).not.toMatch(/cronSecret\s*!==\s*expected/);
  });

  it('process-message-notifications dispatches with the defined service key', () => {
    const src = read('process-message-notifications/index.ts.md');
    expect(src).not.toContain('supabaseServiceKey');
    expect(src).toContain('SUPABASE_SERVICE_KEY');
  });
});
