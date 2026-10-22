import { describe, expect, it } from 'vitest';
import { uniqueGroupSummaries } from './uniqueGroupSummaries';
describe('conversation identity preservation', () => {
  it('keeps one listing per exact ID', () => {
    const row = { id: 'chat-1', club_id: 'giddy', name: 'Coaches' };
    expect(uniqueGroupSummaries([row, { ...row, name: 'Updated name' }])).toEqual([row]);
  });
  it('preserves distinct same-name conversations and their histories', () => {
    const rows = [1, 2].map(n => ({ id: `chat-${n}`, club_id: 'giddy', name: 'Coaches' }));
    expect(uniqueGroupSummaries(rows)).toEqual(rows);
  });
  it('does not guess the owner of conflicting same-ID records', () => {
    expect(() => uniqueGroupSummaries([{ id: 'a', club_id: 'g1' }, { id: 'a', club_id: 'g2' }])).toThrow('Conflicting');
  });
});