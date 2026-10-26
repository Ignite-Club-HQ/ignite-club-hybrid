import { describe, expect, it } from 'vitest';
import { chatProfileWorkset } from './chatProfileWorkset';

describe('private chat viewport workset', () => {
  const history = Array.from({ length: 180 }, (_, i) => ({ id: `m${i}`, author_id: `p${i}` }));
  it('requests visible later-history authors, not the first hundred people', () => {
    expect(chatProfileWorkset(history, ['m175', 'm176'])).toEqual(['p175', 'p176']);
  });
  it('warms only the latest 25 before measurement and accepts verified empty viewport', () => {
    const ids = chatProfileWorkset(history, undefined);
    expect(ids).toHaveLength(25);
    expect(ids[0]).toBe('p179');
    expect(ids).not.toContain('p0');
    expect(chatProfileWorkset(history, [])).toEqual([]);
  });
  it('includes exact visible replies and forwards without unrelated reactions', () => {
    const rows = [...history, { id: 'reply', author_id: 'speaker', reply_to_id: 'm0', forwarded_from_user_id: 'forward', reactions: [{ user_id: 'reactor' }] }];
    expect(chatProfileWorkset(rows, ['reply'], [
      { group_message_id: 'reply', user_id: 'visible-reactor' },
      { group_message_id: 'm1', user_id: 'hidden-reactor' },
    ])).toEqual(['speaker', 'p0', 'forward', 'reactor', 'visible-reactor']);
  });
  it('bounds total identities to 100 and keeps visible speakers before reactors', () => {
    const rows = history.slice(0, 40).map(row => ({ ...row, reactions: Array.from({ length: 150 }, (_, i) => ({ user_id: `r${i}` })) }));
    const ids = chatProfileWorkset(rows, rows.map(row => row.id));
    expect(ids).toHaveLength(100);
    expect(ids.slice(0, 40)).toEqual(rows.map(row => row.author_id));
    expect(new Set(ids).size).toBe(100);
  });
  it('stops touching reaction payloads once the hundred-name budget is full', () => {
    const rows = history.slice(0, 100).map(row => ({ ...row,
      get reactions(): { user_id: string }[] { throw new Error('Budget already full'); },
    }));
    expect(chatProfileWorkset(rows, rows.map(row => row.id))).toHaveLength(100);
  });
});