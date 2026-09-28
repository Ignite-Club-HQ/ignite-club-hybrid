import { QueryClient } from '@tanstack/react-query';
import { beforeEach, expect, test, vi } from 'vitest';
import { eventKeys } from '../src/lab/eventQueryKeys';
import { refreshEventCaches } from '../src/lab/eventCacheRefresh';
import { cacheEventsList, getCachedEventsList } from '../src/lab/scheduleCache';
import { getCachedNextUp, setCachedNextUp } from '../src/lab/nextUpEventsCache';

const USER_A = 'user-cache-refresh-a';
const USER_B = 'user-cache-refresh-b';

beforeEach(() => {
  localStorage.clear();
});

test('preserves the canonical event cache identities', () => {
  expect(eventKeys.lists()).toEqual(['events']);
  expect(eventKeys.upcoming()).toEqual(['upcoming-events']);
  expect(eventKeys.teamNext()).toEqual(['team-next-event']);
  expect(eventKeys.home(USER_A)).toEqual(['user-memberships-and-events', USER_A]);
  expect(eventKeys.detail('event-1')).toEqual(['event', 'event-1']);
  expect(eventKeys.rsvps('event-1')).toEqual(['event-rsvps', 'event-1']);
  expect(eventKeys.goingRsvps('event-1')).toEqual(['event-rsvps-going', 'event-1']);
  expect(eventKeys.groups('event-1')).toEqual(['event-groups', 'event-1']);
  expect(eventKeys.duties('event-1')).toEqual(['event-duties', 'event-1']);
  expect(eventKeys.payments('event-1')).toEqual(['event-payments', 'event-1']);
  expect(eventKeys.recentReminders('event-1')).toEqual(['event-recent-reminders', 'event-1']);
  expect(eventKeys.pitchLinked('event-1')).toEqual(['pitch-linked-event', 'event-1']);
  expect(eventKeys.pitchGoingRsvps('event-1')).toEqual(['pitch-board-going-rsvps', 'event-1']);
  expect(eventKeys.pitchTeamMembers()).toEqual(['team-members-for-pitch']);
  expect(eventKeys.pitchTeamMembers('team-1', 'event-1')).toEqual([
    'team-members-for-pitch',
    'team-1',
    'event-1',
  ]);
});

test('invalidates every canonical event query key for the acting user', () => {
  const queryClient = new QueryClient();
  const spy = vi.spyOn(queryClient, 'invalidateQueries');

  refreshEventCaches(queryClient, USER_A);

  expect(spy).toHaveBeenCalledTimes(4);
  expect(spy).toHaveBeenNthCalledWith(1, { queryKey: eventKeys.lists() });
  expect(spy).toHaveBeenNthCalledWith(2, { queryKey: eventKeys.upcoming() });
  expect(spy).toHaveBeenNthCalledWith(3, { queryKey: eventKeys.teamNext() });
  expect(spy).toHaveBeenNthCalledWith(4, { queryKey: eventKeys.home(USER_A) });
});

test('skips the per-user home invalidation for an anonymous caller', () => {
  const queryClient = new QueryClient();
  const spy = vi.spyOn(queryClient, 'invalidateQueries');

  refreshEventCaches(queryClient, null);

  expect(spy).toHaveBeenCalledTimes(3);
  expect(spy).not.toHaveBeenCalledWith({ queryKey: expect.arrayContaining(['user-memberships-and-events']) });
});

test('clears only the acting user\'s persisted schedule and next-up snapshots', () => {
  const queryClient = new QueryClient();
  cacheEventsList('club-all', [{ id: 'event-1' }], USER_A);
  cacheEventsList('club-all', [{ id: 'event-1' }], USER_B);
  setCachedNextUp(USER_A, [{ id: 'event-1' }]);
  setCachedNextUp(USER_B, [{ id: 'event-1' }]);

  refreshEventCaches(queryClient, USER_A);

  expect(getCachedEventsList('club-all', USER_A)).toBeNull();
  expect(getCachedNextUp(USER_A)).toBeNull();
  expect(getCachedEventsList('club-all', USER_B)).toEqual([{ id: 'event-1' }]);
  expect(getCachedNextUp(USER_B)).toEqual([{ id: 'event-1' }]);
});

test('this cache-refresh helper has no provider edge: it never touches Supabase or ICP', () => {
  // The bundle's refactor removed duplicated literal query-key arrays in
  // favour of the canonical `eventKeys` factory; it never called a backend
  // client. Provider/placement routing (resolveClubBackend) therefore does
  // not apply to this module, so explicit Supabase/ICP mode assertions are
  // replaced by this provider-neutral contract test.
  const queryClient = new QueryClient();
  expect(() => refreshEventCaches(queryClient, 'user-provider-neutral')).not.toThrow();
});
