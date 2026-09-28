import { expect, test } from 'vitest';
import { createLocalSupabaseProvider } from '../src/lab/localSupabaseAdapter';

const draft = { title: 'Local link', subtitle: null, url: 'https://example.com', icon: 'link', open_mode: 'browser', is_active: true };

test('requires an explicit allowlisted environment and isolates its stores', async () => {
  const provider = createLocalSupabaseProvider({ environments: ['au', 'us'], clubIdForEnvironment: environment => `club-${environment}` });
  await expect(provider('prod')).rejects.toThrow('not allowlisted');
  const au = await provider('au');
  const us = await provider('us');
  await au.save('club-au', draft);
  await expect(us.listAdmin('club-us')).resolves.toHaveLength(0);
  await expect(au.listAdmin('club-au')).resolves.toHaveLength(1);
});

test('fails closed for blocked writes and permits only read-only reads', async () => {
  const provider = createLocalSupabaseProvider({ environments: ['au'], clubIdForEnvironment: () => 'club-au' });
  const service = await provider('au');
  await service.save('club-au', draft);
  provider.setState('au', 'ReadOnly');
  await expect(service.listVisible('club-au')).resolves.toHaveLength(1);
  await expect(service.save('club-au', draft)).rejects.toThrow('read-only');
  provider.setState('au', 'MigrationRequired');
  await expect(service.listAdmin('club-au')).resolves.toHaveLength(1);
  await expect(service.remove('missing')).rejects.toThrow('migration required');
  provider.setState('au', 'Blocked');
  await expect(service.listAdmin('club-au')).rejects.toThrow('blocked');
});

test('blocks reads during migration and rejects unknown environments', async () => {
  const provider = createLocalSupabaseProvider({ environments: ['au'], clubIdForEnvironment: () => 'club-au' });
  const service = await provider('au');
  await service.save('club-au', draft);
  provider.setState('au', 'MigrationRequired');
  await expect(service.listVisible('club-au')).resolves.toHaveLength(1);
  expect(() => provider.setState('unknown', 'Active')).toThrow('not allowlisted');
  service.dispose();
  await expect(service.listAdmin('club-au')).rejects.toThrow('Identity changed');
});

test('does not silently fall back after a provider failure', async () => {
  const provider = createLocalSupabaseProvider({ environments: ['au'], clubIdForEnvironment: () => 'club-au' });
  const service = await provider('au');
  provider.setState('au', 'Blocked');
  await expect(service.save('club-au', draft)).rejects.toThrow('blocked');
  await expect(provider('missing')).rejects.toThrow('not allowlisted');
});