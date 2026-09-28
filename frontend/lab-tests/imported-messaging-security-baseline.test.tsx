import { Principal } from '@icp-sdk/core/principal';
import { expect, test } from 'vitest';
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

type MessageClient = {
  send(message: Omit<Message, 'sequence' | 'status'>): Promise<Message>;
  list(clubId: string, threadId: string): Promise<Message[]>;
};

const CLUB_A = 'club-message-a';
const CLUB_B = 'club-message-b';
const ICP_A = Principal.fromText('aaaaa-aa');
const ICP_B = Principal.fromText('2vxsx-fae');

function createMessageClient(): MessageClient {
  const messages: Message[] = [];
  return {
    async send(message) {
      const sequence = messages.filter(item => item.clubId === message.clubId && item.threadId === message.threadId).length + 1;
      const stored = { ...message, sequence, status: 'queued' as const };
      messages.push(stored);
      return stored;
    },
    async list(clubId, threadId) {
      return messages.filter(item => item.clubId === clubId && item.threadId === threadId);
    },
  };
}

for (const mode of ['supabase', 'icp'] as const) {
  test(`keeps imported messaging security semantics isolated in explicit ${mode} mode`, async () => {
    const registry = createSyntheticPlacementRegistry([
      {
        clubId: CLUB_A,
        country: 'AU',
        backend: mode === 'supabase'
          ? { Supabase: { environment: 'message-au' } }
          : { Icp: { canister: ICP_A } },
      },
      {
        clubId: CLUB_B,
        country: 'US',
        backend: mode === 'supabase'
          ? { Supabase: { environment: 'message-us' } }
          : { Icp: { canister: ICP_B } },
      },
    ]);
    const calls: string[] = [];
    const clients = new Map<string, MessageClient>();
    const provider = (key: string) => {
      let client = clients.get(key);
      if (!client) {
        client = createMessageClient();
        clients.set(key, client);
      }
      return client;
    };
    const router = createHybridMessageRouter(registry, {
      supabase: async environment => {
        calls.push(`supabase:${environment}`);
        return provider(`supabase:${environment}`);
      },
      icp: async canister => {
        const key = canister.toText();
        calls.push(`icp:${key}`);
        return provider(`icp:${key}`);
      },
    });

    await router.send(CLUB_A, 'thread-1', 'Club A message', 'message-a');
    await router.send(CLUB_B, 'thread-1', 'Club B message', 'message-b');

    await expect(router.list(CLUB_A, 'thread-1')).resolves.toEqual([
      expect.objectContaining({ id: 'message-a', clubId: CLUB_A, body: 'Club A message' }),
    ]);
    await expect(router.list(CLUB_B, 'thread-1')).resolves.toEqual([
      expect.objectContaining({ id: 'message-b', clubId: CLUB_B, body: 'Club B message' }),
    ]);

    const expectedPrefix = mode === 'supabase' ? 'supabase:' : 'icp:';
    expect(calls.every(call => call.startsWith(expectedPrefix))).toBe(true);
    expect(clients).toHaveLength(2);
    router.dispose();
  });
}

test('does not fall back to Supabase when the selected ICP message provider fails', async () => {
  let supabaseCalls = 0;
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: ICP_A } },
  }]);
  const router = createHybridMessageRouter(registry, {
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error('Supabase must not be used in ICP mode');
    },
    icp: async () => {
      throw new Error('local ICP message provider unavailable');
    },
  });

  await expect(router.send(CLUB_A, 'thread-1', 'Synthetic failure', 'message-failure'))
    .rejects.toThrow('local ICP message provider unavailable');
  expect(supabaseCalls).toBe(0);
  router.dispose();
});
