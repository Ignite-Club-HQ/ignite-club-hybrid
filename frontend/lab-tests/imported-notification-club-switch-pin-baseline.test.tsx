import { beforeEach, expect, test } from 'vitest';
import {
  clearAppliedNotificationClubSwitch,
  getAppliedNotificationClubSwitch,
  markNotificationClubSwitchApplied,
} from '../src/lib/notificationClubSwitch';

beforeEach(() => {
  clearAppliedNotificationClubSwitch();
});

test('round-trips a notification-applied club switch pin', () => {
  expect(getAppliedNotificationClubSwitch()).toBeNull();

  markNotificationClubSwitchApplied('club-switch-b');

  expect(getAppliedNotificationClubSwitch()).toBe('club-switch-b');
});

test('expires a stale pin before it can select a later session club', () => {
  sessionStorage.setItem(
    'ignite_notification_club_switch_applied',
    JSON.stringify({ clubId: 'club-switch-b', ts: Date.now() - 600_000 }),
  );

  expect(getAppliedNotificationClubSwitch()).toBeNull();
});

test('clears a pin when explicit club selection supersedes it', () => {
  markNotificationClubSwitchApplied('club-switch-b');

  clearAppliedNotificationClubSwitch();

  expect(getAppliedNotificationClubSwitch()).toBeNull();
});

test('uses an ignite-prefixed key for user-cache cleanup', () => {
  markNotificationClubSwitchApplied('club-switch-b');

  expect(
    Object.keys(sessionStorage).some(
      key => key.startsWith('ignite_') && key.includes('club_switch_applied'),
    ),
  ).toBe(true);
});
