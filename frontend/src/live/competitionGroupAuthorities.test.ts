import { it, expect, vi } from 'vitest';
import { wireCompetitionGroupAuthorities } from './competitionGroupAuthorities';
const groups = [{ groupId: 'a', clubDomain: 'rrkah-fqaaa-aaaaa-aaaaq-cai', competitionDomain: 'ryjl3-tyaaa-aaaaa-aaaba-cai' }, { groupId: 'b', clubDomain: 'r7inp-6aaaa-aaaaa-aaabq-cai', competitionDomain: 'rkp4c-7iaaa-aaaaa-aaaca-cai' }];
it('wires every participant authority reciprocally before accepting traffic', async () => {
  const club = vi.fn(async () => ({ Ok: undefined })), comp = vi.fn(async () => ({ Ok: undefined }));
  await wireCompetitionGroupAuthorities(groups, { club: () => ({ set_competition_authorities: club }), competition: () => ({ set_participant_club_authorities: comp }) });
  expect(club).toHaveBeenCalledTimes(2); expect(comp).toHaveBeenCalledTimes(2);
  expect(club.mock.calls[0][0].map(p => p.toText())).toEqual(groups.map(g => g.competitionDomain));
  expect(comp.mock.calls[0][0].map(p => p.toText())).toEqual(groups.map(g => g.clubDomain));
});
it('stops on authority refusal without enabling anything', async () => {
  const comp = vi.fn();
  await expect(wireCompetitionGroupAuthorities(groups, { club: () => ({ set_competition_authorities: async () => ({ Err: 'Forbidden' }) }), competition: () => ({ set_participant_club_authorities: comp }) })).rejects.toThrow('Forbidden');
  expect(comp).not.toHaveBeenCalled();
});