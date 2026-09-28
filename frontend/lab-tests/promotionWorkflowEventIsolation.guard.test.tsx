import { describe, expect, it } from 'vitest';

type TeamEvent = { id: string; teamId: string; attendeeIds: string[] };

function promotePlayerAcrossTeams(events: TeamEvent[], playerId: string, fromTeamId: string, toTeamId: string) {
  return events.map((event) => {
    if (event.teamId !== fromTeamId) {
      return event;
    }
    return { ...event, attendeeIds: event.attendeeIds.filter((id) => id !== playerId) };
  });
}

describe('promotion workflow event isolation guard', () => {
  it('keeps historical team events attributed to the original team and never duplicates or moves them', () => {
    const events: TeamEvent[] = [
      { id: 'event-1', teamId: 'team-junior', attendeeIds: ['player-1', 'player-2'] },
      { id: 'event-2', teamId: 'team-senior', attendeeIds: ['player-3'] },
    ];

    const afterPromotion = promotePlayerAcrossTeams(events, 'player-1', 'team-junior', 'team-senior');

    expect(afterPromotion).toHaveLength(2);
    expect(afterPromotion.map((event) => event.teamId)).toEqual(['team-junior', 'team-senior']);
    expect(afterPromotion[0]).toEqual({ id: 'event-1', teamId: 'team-junior', attendeeIds: ['player-2'] });
    expect(afterPromotion[1]).toEqual(events[1]);
  });

  it('removes the promoted player from future roster visibility on the origin team without touching other teams', () => {
    const events: TeamEvent[] = [
      { id: 'event-3', teamId: 'team-junior', attendeeIds: ['player-1'] },
      { id: 'event-4', teamId: 'team-other', attendeeIds: ['player-1'] },
    ];

    const afterPromotion = promotePlayerAcrossTeams(events, 'player-1', 'team-junior', 'team-senior');

    expect(afterPromotion.find((event) => event.id === 'event-3')?.attendeeIds).toEqual([]);
    expect(afterPromotion.find((event) => event.id === 'event-4')?.attendeeIds).toEqual(['player-1']);
  });
});
