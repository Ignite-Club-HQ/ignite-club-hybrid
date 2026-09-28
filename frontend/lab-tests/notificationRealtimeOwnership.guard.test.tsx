import { describe, expect, it } from 'vitest';

type Notification = {
  userId: string;
  clubId: string;
  kind: string;
  payload: Record<string, string>;
};

function shouldDeliverRealtimeNotification(notification: Notification, viewerUserId: string, viewerClubId: string) {
  if (notification.userId !== viewerUserId || notification.clubId !== viewerClubId) {
    return false;
  }
  return true;
}

describe('notification realtime ownership guard', () => {
  it('delivers only notifications that match the current user and club ownership', () => {
    const notification = { userId: 'u-1', clubId: 'club-1', kind: 'invite', payload: { teamId: 'team-1' } };
    expect(shouldDeliverRealtimeNotification(notification, 'u-1', 'club-1')).toBe(true);
    expect(shouldDeliverRealtimeNotification(notification, 'u-2', 'club-1')).toBe(false);
    expect(shouldDeliverRealtimeNotification(notification, 'u-1', 'club-2')).toBe(false);
  });
});
