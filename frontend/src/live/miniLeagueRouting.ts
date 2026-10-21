import { routingActive } from './generalActivation';
import { hasOwnerTestRouting } from './ownerTestRouting';
import { withFeatureBackend, type ClubScope, type FeatureBackendContext } from './featureRouter';

/** Nested reads must not reuse the first club's canisters for another club. */
export async function readMiniLeagueInScope<T>(
  context: FeatureBackendContext,
  scope: ClubScope,
  read: (context: FeatureBackendContext) => Promise<T>,
): Promise<T> {
  if (!await routingActive(context) && !hasOwnerTestRouting(context)) return read(context);
  return withFeatureBackend('mini_leagues', {
    supabase: () => { throw new Error('Internet Identity connection required'); },
    icp: read,
  }, scope);
}

/** Duplicate copies must not create duplicate league tiles or memberships. */
export function mergeMiniLeagueRows<T extends { id: string; club_id?: string }>(parts: T[][]): T[] {
  const rows = new Map<string, T>();
  for (const row of parts.flat()) {
    const previous = rows.get(row.id);
    if (previous && previous.club_id !== row.club_id) throw new Error('Conflicting mini-league ownership');
    rows.set(row.id, row);
  }
  return [...rows.values()];
}