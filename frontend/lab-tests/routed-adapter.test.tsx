import { expect, test } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createRoutedClubLinksService } from '../src/lab/routedClubLinksService';

const shardA = Principal.fromText('aaaaa-aa');
const shardB = Principal.fromText('2vxsx-fae');
const listing = (id: string, club: string) => ({ Ok: { revision: 1n, links: [{ id, club_id: club, draft: { title: 'x', subtitle: [], url: 'https://example.com', icon: 'link', open_mode: 'same_tab', is_active: true }, sort_order: 0, created_at_ms: 1n }] } });

test('routes each club to its selected shard and remembers link scope', async () => {
  const calls: string[] = [];
  const actors = new Map<string, any>();
  const makeActor = (shard: Principal) => ({ list_links: async (club: string) => { calls.push(`${shard.toText()}:${club}`); return listing(`link-${club}`, club); }, get_link: async () => listing('link-club-a', 'club-a') });
  const service = createRoutedClubLinksService({ get_route: async club => ({ Ok: [[{ club_id: club, revision: 1n, shard: club === 'club-a' ? shardA : shardB }][0]] }) }, async shard => { const key = shard.toText(); const actor = makeActor(shard); actors.set(key, actor); return actor; });
  await service.listAdmin('club-a');
  await service.listAdmin('club-b');
  expect(calls).toEqual([`${shardA.toText()}:club-a`, `${shardB.toText()}:club-b`]);
  expect(actors.size).toBe(2);
  await expect(service.get('link-club-a')).resolves.toMatchObject({ id: 'link-club-a' });
  service.dispose();
});

test('fails closed when a club has no route', async () => {
  const service = createRoutedClubLinksService({ get_route: async () => ({ Ok: [] }) }, async () => { throw new Error('must not create actor'); });
  await expect(service.listAdmin('unassigned')).rejects.toThrow('no shard route');
});
