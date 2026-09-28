import { expect, test } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';
import { resolveClubBackend, withClubBackend } from '../src/lab/backendRouter';
import { resolveLocalAuthMode } from '../src/lab/localRuntimeMode';
import * as fixtureData from '../src/lab/fixtureDataLayer';

test('resolves ICP and Supabase providers from authoritative placement', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: 'club-icp', country: 'US', backend: { Icp: { canister: Principal.fromText('aaaaa-aa') } } },
    { clubId: 'club-supabase', country: 'AU', backend: { Supabase: { environment: 'staging-au' } } },
  ]);

  await expect(resolveClubBackend(registry, 'club-icp')).resolves.toMatchObject({ kind: 'icp' });
  await expect(resolveClubBackend(registry, 'club-supabase')).resolves.toMatchObject({ kind: 'supabase' });

  await expect(withClubBackend(
    registry,
    {
      icp: async canister => `icp:${canister.toText()}`,
      supabase: async environment => `supabase:${environment}`,
    },
    'club-supabase',
    provider => provider,
  )).resolves.toBe('supabase:staging-au');
});

test('fails closed when placement is missing, disabled, or in a blocked migration state', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: 'club-icp', country: 'US', backend: { Icp: { canister: Principal.fromText('aaaaa-aa') } } },
  ]);
  registry.setAvailability('icp', false);

  await expect(resolveClubBackend(registry, 'unknown')).rejects.toThrow('no backend placement');
  await expect(resolveClubBackend(registry, 'club-icp')).rejects.toThrow('Backend unavailable');

  registry.setAvailability('icp', true);
  registry.setState('club-icp', 'Blocked');
  await expect(resolveClubBackend(registry, 'club-icp')).rejects.toThrow('Backend unavailable');

  registry.setState('club-icp', 'Active');
  registry.setState('club-icp', 'MigrationRequired');
  await expect(resolveClubBackend(registry, 'club-icp')).rejects.toThrow('Backend unavailable');
});

test('selects the local lab auth mode without forcing production Supabase', () => {
  expect(resolveLocalAuthMode('', true)).toBe(true);
  expect(resolveLocalAuthMode('?backend=icp', true)).toBe(true);
  expect(resolveLocalAuthMode('?backend=supabase', true)).toBe(false);
  expect(resolveLocalAuthMode('?backend=supabase', false)).toBe(false);
});

test('provides local fixture data for the core hybrid pages', () => {
  const home = fixtureData.getLocalLabHomeSnapshot('icp-member');
  expect(home.memberships.clubIds).toContain('club-icp-001');
  expect(home.memberships.teamIds).toContain('team-icp-001');
  expect(home.events[0]?.title).toContain('ICP');

  const clubs = fixtureData.getLocalLabClubList();
  expect(clubs[0]?.name).toBe('ICP Test Club');

  const club = fixtureData.getLocalLabClubDetail('club-icp-001');
  expect(club?.name).toBe('ICP Test Club');

  const team = fixtureData.getLocalLabTeamDetail('team-icp-001');
  expect(team?.name).toBe('ICP Test Team');

  const messages = fixtureData.getLocalLabMessagesSnapshot('icp-member');
  expect(messages.memberClubs[0]?.id).toBe('club-icp-001');

  const notifications = fixtureData.getLocalLabNotifications('icp-member');
  expect(notifications[0]?.read).toBe(false);
  expect(notifications[0]?.related_id).toBe('event-icp-001');

  const group = fixtureData.getLocalLabGroup('group-icp-001', 'icp-member');
  expect(group?.name).toBe('ICP Test Team Chat');
  expect(fixtureData.getLocalLabGroupMessages('group-icp-001', 'icp-member')[0]?.text).toContain('local ICP');

  const events = fixtureData.getLocalLabEventList();
  expect(events.find((event) => event.id === 'event-icp-001')?.clubs?.name).toBe('ICP Test Club');
  expect(events[0]?.type).toBe('game');

  const news = fixtureData.getLocalLabNewsPosts('club-icp-001');
  expect(news[0]?.title).toContain('ICP');
  expect(fixtureData.getLocalLabNewsPost('news-icp-001')?.author_id).toBe('icp-member');

  const leaderboard = fixtureData.getLocalLabLeaderboard('club-icp-001');
  expect(leaderboard[0]?.is_viewer).toBe(true);

  const rewards = fixtureData.getLocalLabRewards('club-icp-001');
  expect(rewards[0]?.points_required).toBe(50);
  expect(fixtureData.getLocalLabRewardRedemptions('club-icp-001')[0]?.status).toBe('pending');
});
