import { expect, test } from 'vitest';
import { resolveRouteClubScope } from '../src/lib/routeClubScope';

test('adapts the imported route scope baseline for the lab frontend', () => {
  expect(resolveRouteClubScope('/clubs/abc')).toEqual({ kind: 'direct', clubId: 'abc' });
  expect(resolveRouteClubScope('/clubs/abc/seasons')).toEqual({ kind: 'direct', clubId: 'abc' });
  expect(resolveRouteClubScope('/messages/club/abc')).toEqual({ kind: 'direct', clubId: 'abc' });
  expect(resolveRouteClubScope('/pay-fees/abc')).toEqual({ kind: 'direct', clubId: 'abc' });

  expect(resolveRouteClubScope('/teams/t1')).toEqual({ kind: 'lookup', table: 'teams', id: 't1' });
  expect(resolveRouteClubScope('/messages/t1')).toEqual({ kind: 'lookup', table: 'teams', id: 't1' });
  expect(resolveRouteClubScope('/groups/g1')).toEqual({ kind: 'lookup', table: 'chat_groups', id: 'g1' });
  expect(resolveRouteClubScope('/events/e1')).toEqual({ kind: 'lookup', table: 'events', id: 'e1' });
  expect(resolveRouteClubScope('/mini-leagues/m1')).toEqual({ kind: 'lookup', table: 'mini_leagues', id: 'm1' });
  expect(resolveRouteClubScope('/vault/folder/f1')).toEqual({ kind: 'lookup', table: 'vault_folders', id: 'f1' });
  expect(resolveRouteClubScope('/messages/club-admin/c1')).toEqual({
    kind: 'lookup',
    table: 'club_admin_conversations',
    id: 'c1',
  });

  expect(resolveRouteClubScope('/messages/dm/c1')).toEqual({ kind: 'dm', conversationId: 'c1' });
  expect(resolveRouteClubScope('/messages/dm')).toEqual({ kind: 'none' });
});

test('keeps current club-owned routes scoped and normalizes query strings and fragments', () => {
  expect(resolveRouteClubScope('/club-link/link-1?source=member#details')).toEqual({
    kind: 'lookup',
    table: 'club_links',
    id: 'link-1',
  });
  expect(resolveRouteClubScope('/media/photo-1')).toEqual({ kind: 'lookup', table: 'photos', id: 'photo-1' });
  expect(resolveRouteClubScope('/competitions/competition-1')).toEqual({
    kind: 'membership',
    competitionId: 'competition-1',
  });
  expect(resolveRouteClubScope('/clubs/new')).toEqual({ kind: 'none' });
  expect(resolveRouteClubScope('/events/import')).toEqual({ kind: 'none' });
});

test('leaves cross-club, personal, and creation routes unscoped', () => {
  for (const pathname of [
    '/',
    '/events',
    '/events/new',
    '/messages',
    '/messages/broadcast',
    '/messages/welcome',
    '/vault',
    '/media',
    '/leaderboard',
    '/clubs',
    '/clubs/new',
    '/teams/new',
    '/associations/x',
    '/admin/users',
    '/profile',
    '/settings',
  ]) {
    expect(resolveRouteClubScope(pathname), pathname).toEqual({ kind: 'none' });
  }
});
