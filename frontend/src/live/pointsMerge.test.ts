import { describe, expect, it } from 'vitest';
import { mergeClubPointBalances } from './pointsMerge';

describe('club points across groups', () => {
  it('keeps distinct club balances separate', () => {
    expect(mergeClubPointBalances([[{ club_id: 'a', points: 5 }], [{ club_id: 'b', points: 12 }]]))
      .toEqual([{ club_id: 'a', points: 5 }, { club_id: 'b', points: 12 }]);
  });
  it('does not double a copied balance', () => {
    expect(mergeClubPointBalances([[{ club_id: 'a', points: 5 }], [{ club_id: 'a', points: 5 }]]))
      .toEqual([{ club_id: 'a', points: 5 }]);
  });
  it('refuses conflicting authority copies', () => {
    expect(() => mergeClubPointBalances([[{ club_id: 'a', points: 5 }], [{ club_id: 'a', points: 6 }]]))
      .toThrow('Conflicting points balances');
  });
});