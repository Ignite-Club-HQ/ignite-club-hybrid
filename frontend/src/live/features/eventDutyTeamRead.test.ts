import { describe, expect, it, vi } from 'vitest';
vi.mock('@/live/domains', async (orig) => ({ ...(await orig<any>()), connectLiveEventsDomain: async () => ({ actor: { get_event_duty_team: async () => ({ Ok: [{ event_id: 'e1', team_id: 'team-a' }] }) } }) }));
import { getLiveEventDutyTeam } from './events';
describe('getLiveEventDutyTeam', () => {
  it('returns the saved duty team', async () => {
    expect(await getLiveEventDutyTeam({ target: {} , identity: {} } as any, 'e1')).toBe('team-a');
  });
});
