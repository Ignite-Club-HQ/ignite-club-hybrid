/**
 * Hybrid data fetcher for pages supporting both ICP and Supabase backends.
 * 
 * Usage:
 *   const { data: clubs } = useHybridQuery(
 *     ['user-clubs', userId],
 *     userId,
 *     (supabaseClient) => supabaseClient.from('clubs').select(...),
 *     () => fixtureDataLayer.getFixtureUserClubs(userId),
 *   );
 */

import { useQuery, UseQueryOptions } from '@tanstack/react-query';
import { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
// Uses the `@/lab/...` alias (not a relative import) so the live build's
// `vite.live.config.ts` can substitute a live-track implementation here,
// exactly as it does for every other call site of this module.
import { resolveLocalAuthMode } from '@/lab/localRuntimeMode';

export type HybridBackendMode = 'icp' | 'supabase';

export function hybridQueryKey(
  queryKey: (string | number)[],
  backend: HybridBackendMode,
  userId?: string | null,
) {
  return [...queryKey, { backend, userId: userId ?? null }] as const;
}

export async function executeHybridQuery<T>(
  backend: HybridBackendMode,
  userId: string | undefined | null,
  supabaseQueryFn: (client: SupabaseClient) => Promise<{ data: T | null; error: Error | null }>,
  fixtureQueryFn: (userId: string) => T,
) {
  if (!userId) return null;

  if (backend === 'icp') {
    return fixtureQueryFn(userId);
  }

  const { data, error } = await supabaseQueryFn(supabase);
  if (error) throw error;
  return data;
}

/**
 * Hook that automatically routes queries to ICP fixtures (in lab mode)
 * or Supabase (in normal mode).
 * 
 * This is a transitional pattern for testing the app shell with both backends.
 * In production hybrid deployments, real canister implementations would replace
 * the fixture layer.
 */
export function useHybridQuery<T>(
  queryKey: (string | number)[],
  userId: string | undefined | null,
  supabaseQueryFn: (client: SupabaseClient) => Promise<{ data: T | null; error: Error | null }>,
  fixtureQueryFn: (userId: string) => T,
  options?: Omit<UseQueryOptions, 'queryKey' | 'queryFn' | 'enabled'>,
) {
  const useIcp = resolveLocalAuthMode(typeof window !== 'undefined' ? window.location.search : '', true);
  const backend: HybridBackendMode = useIcp ? 'icp' : 'supabase';
  
  return useQuery({
    queryKey: hybridQueryKey(queryKey, backend, userId),
    queryFn: () => executeHybridQuery(backend, userId, supabaseQueryFn, fixtureQueryFn),
    enabled: !!userId,
    ...options,
  });
}

/**
 * Variant for queries that don't depend on userId (e.g., global data).
 */
export function useHybridQueryGlobal<T>(
  queryKey: (string | number)[],
  supabaseQueryFn: (client: SupabaseClient) => Promise<{ data: T | null; error: Error | null }>,
  fixtureQueryFn: () => T,
  options?: Omit<UseQueryOptions, 'queryKey' | 'queryFn'>,
) {
  const useIcp = resolveLocalAuthMode(typeof window !== 'undefined' ? window.location.search : '', true);
  const backend: HybridBackendMode = useIcp ? 'icp' : 'supabase';
  
  return useQuery({
    queryKey: hybridQueryKey(queryKey, backend),
    queryFn: () => executeHybridQuery(
      backend,
      'global',
      supabaseQueryFn,
      () => fixtureQueryFn(),
    ),
    ...options,
  });
}
