import { expect, it } from 'vitest';
import { updateMemberReaction } from './reactionUpdates';
it('reconciles one member without rolling back other members or duplicating a reaction', () => {
  const current = [{ user_id: 'other', reaction_type: 'heart' }, { user_id: 'self', reaction_type: 'like' }];
  expect(updateMemberReaction(current, 'self', [{ user_id: 'self', reaction_type: 'heart' }])).toEqual([
    { user_id: 'other', reaction_type: 'heart' }, { user_id: 'self', reaction_type: 'heart' },
  ]);
  expect(updateMemberReaction(current, 'self', [])).toEqual([{ user_id: 'other', reaction_type: 'heart' }]);
});