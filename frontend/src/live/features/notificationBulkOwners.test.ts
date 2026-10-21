import { it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ scopes: [] as unknown[], mark: vi.fn(), remove: vi.fn() }));
vi.mock('../groupActivation', () => ({ SHIPPED_GATES: {}, activationStatus: () => ({ active: true }) }));
vi.mock('../generalActivation', () => ({ routingActive: async () => true, generalRoutingStatus: async () => ({ active: true, missing: [] }), cachedGeneralRoutingActive: () => true, clearGeneralRoutingCache: () => {} }));
vi.mock('../domains', () => ({ connectLiveNotificationQueue: async () => ({ actor: {
  list_inbox: async () => ({ Ok: [{ id: 'n1', read: false }, { id: 'n2', read: true }] }),
  mark_read: m.mark, delete_notification: m.remove,
} }) }));
vi.mock('../internetIdentityAuth', () => ({ getCurrentInternetIdentityConfirmed: async () => ({ getPrincipal: () => ({ toText: () => 'user' }) }) }));
vi.mock('../targetRegistry', () => ({ getActiveIcpTarget: () => ({ alias: 'mainnet', host: 'https://icp-api.io', networkKind: 'public_mainnet', canisterIds: { shard_router: 'jcdfe-vqaaa-aaaal-qxloq-cai' } }) }));
vi.mock('../featureRouter', () => ({ withFeatureBackend: async (_feature: string, p: { icp(ctx: unknown): unknown }, scope: unknown) => { m.scopes.push(scope); return p.icp({}); } }));
import { markAllLiveNotificationsRead, clearLiveInbox } from './notifications';
it('marks unread rows exactly once through their own notification scope', async () => {
  m.mark.mockResolvedValue({ Ok: undefined });
  await markAllLiveNotificationsRead({} as never, 'user', null);
  expect(m.mark).toHaveBeenCalledExactlyOnceWith('n1');
  expect(m.scopes).toContainEqual(expect.objectContaining({ notificationId: 'n1' }));
});
it('reports partial failures rather than claiming the inbox was cleared', async () => {
  m.remove.mockResolvedValueOnce({ Ok: undefined }).mockRejectedValueOnce(new Error('offline'));
  await expect(clearLiveInbox({} as never, 'user', null)).rejects.toThrow('1 notification actions failed');
  expect(m.remove).toHaveBeenCalledTimes(2);
  expect(m.scopes).toContainEqual(expect.objectContaining({ notificationId: 'n2' }));
});