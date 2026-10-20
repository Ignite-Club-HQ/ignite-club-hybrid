import { it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ scopes: [] as unknown[], metadata: vi.fn(), events: vi.fn() }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: async (_feature: string, providers: { icp(ctx: unknown): unknown }, scope: unknown) => { m.scopes.push(scope); return providers.icp({ target: 'owner-group' }); } }));
vi.mock('@/live/features/messaging', () => ({ getLiveGroupMetadata: m.metadata }));
vi.mock('@/live/features/events', () => ({ listLiveEvents: m.events }));
import { getIcpNotificationRoute } from './icpNotificationRoute';
it('opens the exact chat message using the conversation owner', async () => {
  m.metadata.mockResolvedValue({ kind: 'group' });
  expect(await getIcpNotificationRoute({} as never, { kind: 'message_chat', relatedId: null, club: 'chat', messageId: 'message-7' })).toBe('/groups/chat?message=message-7');
  expect(m.scopes).toContainEqual({ conversationId: 'chat' });
});
it('looks up a photo reminder event in its owner group', async () => {
  m.events.mockResolvedValue([{ id: 'event', team_id: ['team'] }]);
  expect(await getIcpNotificationRoute({} as never, { kind: 'photo_prompt_reminder', relatedId: 'event', club: 'club', messageId: null })).toBe('/media?team=team&event=event&upload=1');
  expect(m.scopes).toContainEqual({ eventId: 'event' });
});