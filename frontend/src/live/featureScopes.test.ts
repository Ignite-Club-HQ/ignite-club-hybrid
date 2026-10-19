import { describe, it, expect } from 'vitest';
import { vaultViewScope, scheduleTargetScope, acrossLists } from './featureScopes';
describe('resource scopes', () => {
  it('routes a competition vault to its host rather than the viewer club', () => {
    expect(vaultViewScope({ type: 'competition', clubId: 'viewer', competitionId: 'cup' })).toEqual({ competitionId: 'cup' });
  });
  it('keeps direct message scheduling personal', () => {
    expect(scheduleTargetScope({ chat_type: 'direct', club_id: 'viewer', conversation_id: 'dm' })).toEqual({ shared: 'person' });
  });
  it('routes team schedules by team when no club is given', () => {
    expect(scheduleTargetScope({ chat_type: 'team', team_id: 'team' })).toEqual({ teamId: 'team' });
  });
  it('does not invent a location for a group schedule', () => {
    expect(() => scheduleTargetScope({ chat_type: 'group' })).toThrow('scope required');
  });
  it('deduplicates copies rather than double-counting list rows', () => {
    if (!('everyGroup' in acrossLists)) throw new Error('Expected list scope');
    expect(acrossLists.merge([[{ id: 'one' }], [{ id: 'one' }, { id: 'two' }]])).toEqual([{ id: 'one' }, { id: 'two' }]);
  });
});