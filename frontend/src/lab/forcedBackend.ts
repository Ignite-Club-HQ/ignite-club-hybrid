export type ForcedBackend = 'icp' | 'supabase';

declare const __IGNITE_LAB_FORCED_BACKEND__: ForcedBackend | null | undefined;

export function resolveForcedBackend(value: unknown): ForcedBackend | null {
  if (value === undefined || value === null || value === '') return null;
  if (value === 'icp' || value === 'supabase') return value;
  throw new Error('IGNITE_LAB_FORCED_BACKEND must be "icp" or "supabase"');
}

/**
 * This value is injected only by the local Vite/Vitest configurations. It is
 * deliberately not read from browser-controlled query parameters.
 */
export function getForcedBackend(): ForcedBackend | null {
  return resolveForcedBackend(
    typeof __IGNITE_LAB_FORCED_BACKEND__ === 'undefined'
      ? null
      : __IGNITE_LAB_FORCED_BACKEND__,
  );
}
