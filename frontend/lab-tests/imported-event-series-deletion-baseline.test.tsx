import { Principal } from '@icp-sdk/core/principal';
import { expect, test } from 'vitest';
import {
  createHybridEventDeletionService,
  type EventDeletionProvider,
  type EventDeleteResult,
} from '../src/lab/hybridEventDeletion';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

const CLUB_A = 'club-delete-a';
const ICP_A = Principal.fromText('aaaaa-aa');

function result(data: unknown = [], error: { message: string } | null = null): EventDeleteResult {
  return { data, error };
}

function makeProvider(results: EventDeleteResult[], calls: string[]): EventDeletionProvider {
  let index = 0;
  return {
    deleteById: async id => {
      calls.push(`id:${id}`);
      return results[index++] ?? result();
    },
    deleteByParentId: async parentEventId => {
      calls.push(`parent:${parentEventId}`);
      return results[index++] ?? result();
    },
  };
}

for (const mode of ['supabase', 'icp'] as const) {
  test(`preserves event deletion semantics in explicit ${mode} mode`, async () => {
    const registry = createSyntheticPlacementRegistry([{
      clubId: CLUB_A,
      country: 'AU',
      backend: mode === 'supabase'
        ? { Supabase: { environment: 'events-delete-au' } }
        : { Icp: { canister: ICP_A } },
    }]);
    const calls: string[] = [];
    const provider = makeProvider([
      result([{ id: 'child-1' }, { id: 'child-2' }]),
      result([{ id: 'root-1' }]),
    ], calls);
    const providerCalls: string[] = [];
    const service = createHybridEventDeletionService(registry, {
      supabase: async environment => {
        providerCalls.push(`supabase:${environment}`);
        return provider;
      },
      icp: async canister => {
        providerCalls.push(`icp:${canister.toText()}`);
        return provider;
      },
    });

    await expect(service.delete(CLUB_A, {
      id: 'child-1',
      parentEventId: 'root-1',
    }, 'series')).resolves.toEqual({
      kind: 'success',
      deletedIds: ['child-1', 'child-2', 'root-1'],
    });
    expect(calls).toEqual(['parent:root-1', 'id:root-1']);
    expect(providerCalls).toEqual([
      mode === 'supabase' ? 'supabase:events-delete-au' : `icp:${ICP_A.toText()}`,
    ]);
  });
}

test('stops before deleting the root when child deletion is denied', async () => {
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: ICP_A } },
  }]);
  const calls: string[] = [];
  const service = createHybridEventDeletionService(registry, {
    supabase: async () => makeProvider([], calls),
    icp: async () => makeProvider([result([], { message: 'children denied' })], calls),
  });

  await expect(service.delete(CLUB_A, { id: 'root-1', isRecurring: true }, 'series'))
    .resolves.toEqual({ kind: 'failed', message: 'children denied' });
  expect(calls).toEqual(['parent:root-1']);
});

test('reports a partial series when child deletion commits but root confirmation fails', async () => {
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Supabase: { environment: 'events-delete-au' } },
  }]);
  const calls: string[] = [];
  const service = createHybridEventDeletionService(registry, {
    supabase: async () => makeProvider([
      result([{ id: 'child-1' }]),
      result([]),
    ], calls),
    icp: async () => makeProvider([], calls),
  });

  await expect(service.delete(CLUB_A, {
    id: 'root-1',
    isRecurring: true,
  }, 'series')).resolves.toMatchObject({
    kind: 'partial-series',
    deletedIds: ['child-1'],
  });
  expect(calls).toEqual(['parent:root-1', 'id:root-1']);
});

test('treats a zero-row single deletion as failure', async () => {
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Supabase: { environment: 'events-delete-au' } },
  }]);
  const service = createHybridEventDeletionService(registry, {
    supabase: async () => makeProvider([result([])], []),
    icp: async () => makeProvider([], []),
  });

  await expect(service.delete(CLUB_A, { id: 'event-1' }, 'single'))
    .resolves.toMatchObject({ kind: 'failed' });
});

test('does not fall back to Supabase when the selected ICP provider fails', async () => {
  let supabaseCalls = 0;
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: ICP_A } },
  }]);
  const service = createHybridEventDeletionService(registry, {
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error('Supabase must not be used in ICP mode');
    },
    icp: async () => {
      throw new Error('local ICP event deletion unavailable');
    },
  });

  await expect(service.delete(CLUB_A, { id: 'event-1' }, 'single'))
    .rejects.toThrow('local ICP event deletion unavailable');
  expect(supabaseCalls).toBe(0);
});
