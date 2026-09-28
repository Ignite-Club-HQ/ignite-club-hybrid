import { expect, test } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createHybridMessageRouter } from '../src/lab/hybridMessageRouter';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

type Message = {
  id: string;
  clubId: string;
  threadId: string;
  body: string;
  sequence: number;
  status: 'queued' | 'delivered';
};

const client = (messages: Message[]) => ({
  send: async (message: Omit<Message, 'sequence' | 'status'>) => {
    const next: Message = {
      ...message,
      sequence: messages.filter(item => item.clubId === message.clubId && item.threadId === message.threadId).length + 1,
      status: 'queued',
    };
    messages.push(next);
    return next;
  },
  list: async (clubId: string, threadId: string) => messages.filter(item => item.clubId === clubId && item.threadId === threadId),
});

test('routes messaging writes and reads through the authoritative placement', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: 'club-au', country: 'AU', backend: { Supabase: { environment: 'synthetic-au' } } },
    { clubId: 'club-us', country: 'US', backend: { Icp: { canister: Principal.fromText('aaaaa-aa') } } },
  ]);
  const messages: Message[] = [];
  const router = createHybridMessageRouter(registry, {
    supabase: async () => client(messages),
    icp: async () => client(messages),
  });

  const sent = await router.send('club-us', 'thread-1', 'hello', 'message-1');
  expect(sent.clubId).toBe('club-us');
  expect(sent.body).toBe('hello');
  expect(sent.id).toBe('message-1');
  expect(await router.list('club-us', 'thread-1')).toHaveLength(1);
  expect(await router.listAfter('club-us', 'thread-1', 0)).toHaveLength(1);
  await expect(router.listAfter('club-us', 'thread-1', -1)).rejects.toThrow('Invalid message sequence');
  expect(await router.list('club-au', 'thread-1')).toHaveLength(0);

  router.dispose();
});

test('blocks disabled and read-only messaging backends', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: 'club-au', country: 'AU', backend: { Supabase: { environment: 'synthetic-au' } } },
  ]);
  const router = createHybridMessageRouter(registry, {
    supabase: async () => client([]),
    icp: async () => { throw new Error('ICP provider must not be called'); },
  });

  await expect(router.send('club-au', 'thread-1', 'x')).resolves.toMatchObject({ clubId: 'club-au' });
  registry.setAvailability('supabase', false);
  await expect(router.list('club-au', 'thread-1')).rejects.toThrow('supabase disabled');
  registry.setAvailability('supabase', true);
  registry.setState('club-au', 'ReadOnly');
  await expect(router.send('club-au', 'thread-1', 'y')).rejects.toThrow('readonly');

  router.dispose();
});
