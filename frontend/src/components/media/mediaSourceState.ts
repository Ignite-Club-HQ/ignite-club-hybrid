export type MediaSourceStatus = { clubId: string; state: 'ready' | 'failed' | 'denied' };
export async function readMediaSources<T>(clubIds: readonly string[], read: (clubId: string) => Promise<T>) {
  const settled = await Promise.all(clubIds.map(async clubId => {
    try { return { clubId, value: await read(clubId), state: 'ready' as const }; }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { clubId, error, state: /forbidden|not authorized|access denied|membership denied/i.test(message) ? 'denied' as const : 'failed' as const };
    }
  }));
  const values = settled.flatMap(row => 'value' in row ? [row.value as T] : []);
  if (clubIds.length && !values.length) {
    const first = settled.find(row => 'error' in row);
    throw first && 'error' in first ? first.error : new Error('Media sources unavailable');
  }
  return { values, sources: settled.map(({ clubId, state }) => ({ clubId, state })) };
}