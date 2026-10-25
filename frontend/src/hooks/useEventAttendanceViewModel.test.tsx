import { render, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useEventAttendanceViewModel } from './useEventAttendanceViewModel';
import { EventAttendeeCard } from '@/components/event/EventAttendeeCard';

describe('attendance identity after responding', () => {
  it('moves the named nonresponder into Going without losing their name after refresh', () => {
    const paul = { id: 'paul', display_name: 'Paul Cranwell', avatar_url: null, roles: ['club_admin'] };
    const props = {
      event: {}, rsvps: [] as any[], playerMembers: [], effectiveShowAll: true, isMiniLeagueEvent: false,
      targetTeamIdsForFetch: undefined, allChildrenOnTeam: [], attendanceMembers: [paul], attendancePlayerMembers: [],
      childGuardiansOnTeam: [], scopedChildNames: new Map<string, string>(), miniLeaguePlayers: [], miniLeagueAdults: [],
      members: [paul], linkedAdultProfiles: [], reminderMembers: [paul], eventGuests: [],
    };
    const hook = renderHook(value => useEventAttendanceViewModel(value), { initialProps: props });
    expect(hook.result.current.notResponded[0].display_name).toBe('Paul Cranwell');
    hook.rerender({ ...props, rsvps: [{ id: 'event:paul:self', user_id: 'paul', child_id: null, status: 'going', profiles: null }] });
    expect(hook.result.current.notResponded).toHaveLength(0);
    expect(hook.result.current.goingRsvps).toHaveLength(1);
    const card = render(<EventAttendeeCard rsvp={hook.result.current.goingRsvps[0]} currentStatus="going" />);
    expect(card.getByText('Paul Cranwell')).toBeTruthy();
    expect(card.queryByText('Unknown')).toBeNull();
    card.unmount();
    hook.unmount();
  });
});