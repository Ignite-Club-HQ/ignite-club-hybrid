/**
 * Local equivalent of the exported `pitchTimerLostUpdate.guard.test.ts` suite.
 *
 * Deep-audit finding (pitch-board clock resets to 00:00): both server-side
 * writers of `active_games.timer_state` performed an unguarded
 * read-modify-write. Because each write stamps a FRESH `last_event_at`, the
 * loser of a race republishes an already-superseded anchor (typically
 * `half_started_at: null`) with a NEWER timestamp — which the client guards
 * (`shouldAcceptServerSnapshot`) then correctly accept, resetting a live
 * board to zero. Every write must therefore be a compare-and-swap on the
 * snapshot it was derived from. These assertions are structural on purpose:
 * the failure mode is invisible in normal single-writer testing and only
 * reappears if someone deletes the CAS filter.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

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

describe('pitch timer writers must compare-and-swap on last_event_at', () => {
  it('pitch-timer-event guards its update and retries against the winner', () => {
    const src = read('pitch-timer-event/index.ts.md');
    expect(src).toContain('filter("timer_state->>last_event_at", "eq"');
    // Legacy/empty previous state may only win while no v2 marker exists.
    expect(src).toContain('is("timer_state->>schema_version", null)');
    // Must re-apply the event to the winner's state rather than blindly retry.
    expect(src).toContain('applyEvent(attemptPrev, event, payload)');
    // Must report the committed state, not the first attempt's.
    expect(src).toContain('timer_state: attemptNext');
  });

  it('check-pending-subs guards both the halftime and full-time timer writes', () => {
    const src = read('check-pending-subs/index.ts.md');
    const casCount = src.split("filter('timer_state->>last_event_at', 'eq'").length - 1;
    expect(casCount).toBeGreaterThanOrEqual(2);
    // The is_active notification lock must stay unconditional (it is the
    // dedup claim); only the timer publish is CAS'd.
    expect(src).toContain('.update({ is_active: false })');
  });

  it('no timer_state write is awaited inline without a CAS chain', () => {
    for (const p of ['pitch-timer-event/index.ts.md', 'check-pending-subs/index.ts.md']) {
      const src = read(p);
      // `await supabase.from(...).update({ timer_state ... }).eq('id', x)` in a
      // single inline expression is the exact shape of the lost-update defect:
      // there is nowhere left to attach the CAS filter. Guarded writes build
      // the query into a variable first, then chain `.filter(...)`.
      expect(
        /await\s+(supabase|admin)\s*\n?\s*\.from\([^)]*\)\s*\.update\(\{\s*timer_state/.test(src),
      ).toBe(false);
    }
  });
});
