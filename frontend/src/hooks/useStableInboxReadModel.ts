import { useRef } from "react";

export interface StableInboxReadModelState<T> {
  value: T[];
  retained: T[] | null;
}

/**
 * Commits the final inbox read model only when every source used to derive it
 * is authoritative. During a refetch/remount settlement window the previously
 * committed model remains visible as one coherent snapshot.
 */
export function resolveStableInboxReadModel<T>(
  next: T[],
  retained: T[] | null,
  authoritative: boolean,
): StableInboxReadModelState<T> {
  if (authoritative) return { value: next, retained: next };
  if (retained) return { value: retained, retained };
  return { value: next, retained };
}

export function useStableInboxReadModel<T>(
  next: T[],
  opts: { authoritative: boolean; resetKey: string | null },
): T[] {
  const retainedRef = useRef<T[] | null>(null);
  const resetKeyRef = useRef(opts.resetKey);

  if (resetKeyRef.current !== opts.resetKey) {
    resetKeyRef.current = opts.resetKey;
    retainedRef.current = null;
  }

  const resolved = resolveStableInboxReadModel(
    next,
    retainedRef.current,
    opts.authoritative,
  );
  retainedRef.current = resolved.retained;
  return resolved.value;
}