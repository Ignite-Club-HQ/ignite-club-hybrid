import type { Principal } from '@icp-sdk/core/principal';
import { withClubBackend } from './backendRouter';
import type { PlacementRegistry } from './hybridClubLinksService';

export type DeleteType = 'single' | 'series';

export type EventDeletionOutcome =
  | { kind: 'success'; deletedIds: string[] }
  | { kind: 'failed'; message: string }
  | { kind: 'partial-series'; message: string; deletedIds: string[] };

export interface DeletableEvent {
  id: string;
  isRecurring?: boolean | null;
  parentEventId?: string | null;
}

export interface EventDeleteResult {
  data: unknown;
  error: { message: string } | null;
}

export interface EventDeletionProvider {
  deleteById(id: string): Promise<EventDeleteResult>;
  deleteByParentId(parentEventId: string): Promise<EventDeleteResult>;
}

export interface EventDeletionProviders {
  icp: (canister: Principal) => Promise<EventDeletionProvider>;
  supabase: (environment: string) => Promise<EventDeletionProvider>;
}

/** The root id of the series the given event belongs to, for both shapes. */
export function resolveSeriesRootId(event: DeletableEvent): string {
  return event.parentEventId ?? event.id;
}

function idsOf(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data
    .map(row => {
      if (!row || typeof row !== 'object') return null;
      const id = (row as Record<string, unknown>).id;
      return typeof id === 'string' ? id : null;
    })
    .filter((id): id is string => id !== null);
}

function backendKey(backend: { Icp: { canister: Principal } } | { Supabase: { environment: string } }): string {
  return 'Icp' in backend
    ? `icp:${backend.Icp.canister.toText()}`
    : `supabase:${backend.Supabase.environment}`;
}

/**
 * Routes event deletion to the club's selected writable provider and
 * preserves the bundle's explicit confirmation and partial-failure contract.
 */
export function createHybridEventDeletionService(
  registry: PlacementRegistry,
  providers: EventDeletionProviders,
) {
  const clients = new Map<string, EventDeletionProvider>();

  return {
    async delete(
      clubId: string,
      event: DeletableEvent,
      deleteType: DeleteType,
    ): Promise<EventDeletionOutcome> {
      const provider = await withClubBackend(registry, {
        icp: providers.icp,
        supabase: providers.supabase,
      }, clubId, async (value, routed) => {
        if (!routed.decision.writable) {
          throw new Error(`Event deletion backend unavailable: ${routed.decision.reason}`);
        }
        const key = `club:${clubId}`;
        const existing = clients.get(key);
        if (existing) return existing;
        clients.set(key, value);
        return value;
      });

      const isSeries = deleteType === 'series'
        && (!!event.parentEventId || !!event.isRecurring);
      if (!isSeries) {
        const result = await provider.deleteById(event.id);
        if (result.error) return { kind: 'failed', message: result.error.message };
        const deletedIds = idsOf(result.data);
        if (!deletedIds.includes(event.id)) {
          return {
            kind: 'failed',
            message: 'The provider did not confirm the deletion — you may not have permission to delete this event.',
          };
        }
        return { kind: 'success', deletedIds };
      }

      const rootId = resolveSeriesRootId(event);
      const childResult = await provider.deleteByParentId(rootId);
      if (childResult.error) return { kind: 'failed', message: childResult.error.message };
      const childIds = idsOf(childResult.data);

      const rootResult = await provider.deleteById(rootId);
      if (rootResult.error) {
        return { kind: 'partial-series', message: rootResult.error.message, deletedIds: childIds };
      }
      const rootIds = idsOf(rootResult.data);
      if (!rootIds.includes(rootId)) {
        return {
          kind: 'partial-series',
          message: 'The provider did not confirm deletion of the original event in the series.',
          deletedIds: childIds,
        };
      }

      return { kind: 'success', deletedIds: [...childIds, ...rootIds] };
    },
    clearProviderCache() {
      clients.clear();
    },
  };
}
