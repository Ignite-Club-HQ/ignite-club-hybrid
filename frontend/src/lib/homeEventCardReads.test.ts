import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ rsvps: vi.fn(), duties: vi.fn(), roster: vi.fn(), from: vi.fn(), scope: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: m.from } }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: (_: string, handlers: { icp: (ctx: object) => unknown }, scope: object) => {
  m.scope(scope); return handlers.icp({});
} }));
vi.mock('@/live/features/events', () => ({ listLiveMyRsvps: m.rsvps, listLiveDuties: m.duties, getLiveEventRosterDetailed: m.roster }));
import { readHomeCardRsvp, readHomeCardDuties, readHomeCardIcpSummary } from './homeEventCardReads';

describe('ICP Home event card isolation', () => {
  beforeEach(() => vi.clearAllMocks());
  it('reads only the caller adult response for the exact event', async () => {
    m.rsvps.mockResolvedValue([
      { event_id: 'other', account_id: 'paul', child_id: [], state: 'maybe' },
      { event_id: 'event', account_id: 'paul', child_id: ['child'], state: 'not_going' },
      { event_id: 'event', account_id: 'principal:paul', child_id: [], state: 'going' },
    ]);
    expect(await readHomeCardRsvp('event', 'paul')).toEqual({ id: 'event:principal:paul', status: 'going' });
    expect(m.scope).toHaveBeenCalledWith({ eventId: 'event' });
    expect(m.from).not.toHaveBeenCalled();
  });
  it('keeps absent responses absent', async () => {
    m.rsvps.mockResolvedValue([]);
    expect(await readHomeCardRsvp('event', 'paul')).toBeNull();
  });
  it('normalizes the assignee and preserves completed duties', async () => {
    m.duties.mockResolvedValue([
      { account_id: 'principal:paul', duty: 'Subs Manager', completed: true },
      { account_id: 'someone', duty: 'Referee', completed: false },
    ]);
    expect(await readHomeCardDuties('event', 'paul')).toEqual([
      { id: 'event:principal:paul:Subs Manager', name: 'Subs Manager', status: 'completed', start_time: null, end_time: null },
    ]);
    expect(m.from).not.toHaveBeenCalled();
  });
  it('counts going children for games and all going respondents for social events', async () => {
    m.roster.mockResolvedValue({ rsvps: [
      { rsvp: { account_id: 'paul', child_id: [], state: 'going' } },
      { rsvp: { account_id: 'paul', child_id: ['child'], state: 'going' } },
      { rsvp: { account_id: 'someone', child_id: [], state: 'maybe' } },
    ] });
    expect((await readHomeCardIcpSummary('event', false)).totalCount).toBe(1);
    expect((await readHomeCardIcpSummary('event', true)).totalCount).toBe(2);
    expect(m.from).not.toHaveBeenCalled();
  });
  it('propagates a failed authorized read instead of claiming no attendance', async () => {
    m.roster.mockRejectedValue(new Error('unavailable'));
    await expect(readHomeCardIcpSummary('event', true)).rejects.toThrow('unavailable');
  });
});