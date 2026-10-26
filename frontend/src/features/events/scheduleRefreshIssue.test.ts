import { describe, expect, it } from 'vitest';
import { scheduleRefreshIssue } from './scheduleRefreshIssue';
describe('schedule refresh source classification', () => {
  it('does not mistake optional duty failure for failed event retrieval', () => {
    const issue = scheduleRefreshIssue(['duties:g1']);
    expect(issue).toContain('duty-team assignments');
    expect(issue).not.toContain('events could not');
  });
  it('combines all failed sources without leaking club identifiers', () => {
    const issue = scheduleRefreshIssue(['club:private-id', 'team:t1', 'profile:g1', 'duties:g2']);
    expect(issue).toContain('clubs’ events');
    expect(issue).toContain('team names');
    expect(issue).toContain('club names');
    expect(issue).toContain('duty-team assignments');
    expect(issue).not.toContain('private-id');
  });
  it('explains read timeouts without exposing technical details', () => {
    expect(scheduleRefreshIssue([], new Error('Schedule events timed out after 20000ms'))).toContain('took too long');
  });
  it('does not report a complete healthy schedule as failed', () => {
    expect(scheduleRefreshIssue([])).toBeUndefined();
  });
});