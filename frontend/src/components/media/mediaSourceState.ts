export type MediaSourceStatus = { clubId: string; state: 'loading' | 'ready' | 'failed' | 'denied' };
export type MediaSourceSnapshot<T> = { values: T[]; sources: MediaSourceStatus[]; complete: boolean };
export async function readMediaSources<T>(clubIds: readonly string[], read: (clubId: string) => Promise<T>,
  onUpdate?: (snapshot: MediaSourceSnapshot<T>) => void) {
  const ids = [...new Set(clubIds)];
  const ready = new Map<string, T>();
  const status = new Map<string, MediaSourceStatus['state']>(ids.map(id => [id, 'loading']));
  const publish = () => onUpdate?.({ values: ids.flatMap(id => ready.has(id) ? [ready.get(id) as T] : []),
    sources: ids.map(clubId => ({ clubId, state: status.get(clubId) ?? 'loading' })),
    complete: [...status.values()].every(state => state === 'ready') });
  const settled = await Promise.all(ids.map(async clubId => {
    try {
      const value = await read(clubId);
      ready.set(clubId, value); status.set(clubId, 'ready'); publish();
      return { clubId, value, state: 'ready' as const };
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const state = /forbidden|not authorized|access denied|membership denied/i.test(message) ? 'denied' as const : 'failed' as const;
      status.set(clubId, state); publish();
      return { clubId, error, state };
    }
  }));
  const values = settled.flatMap(row => 'value' in row ? [row.value as T] : []);
  if (ids.length && !values.length) {
    const first = settled.find(row => 'error' in row);
    throw first && 'error' in first ? first.error : new Error('Media sources unavailable');
  }
  return { values, sources: settled.map(({ clubId, state }) => ({ clubId, state })) };
}