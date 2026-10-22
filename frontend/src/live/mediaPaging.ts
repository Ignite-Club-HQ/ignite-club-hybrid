/** Gallery continuations live only in the owning account/target request. */
export type MediaPageCursor = { club_id: string; revision: bigint; before: string };
export type MediaAssetPage<T> = { assets: T[]; next: MediaPageCursor | null; bounded: boolean };

export async function readCompatibleMediaPage<T>(
  paged: () => Promise<{ Ok: { assets: T[]; next: [] | [MediaPageCursor] } } | { Err: string }>,
  legacy: () => Promise<T[]>,
  first: boolean,
): Promise<MediaAssetPage<T>> {
  try {
    const reply = await paged();
    if ('Err' in reply) {
      // A not-ready upgrade may retain the unchanged complete legacy read.
      if (first && reply.Err === 'Media page index not ready') return { assets: await legacy(), next: null, bounded: false };
      throw new Error(reply.Err);
    }
    return { assets: reply.Ok.assets, next: reply.Ok.next[0] ?? null, bounded: true };
  } catch (error) {
    const message = String((error as { message?: unknown })?.message ?? error);
    // Only an explicit missing method permits legacy compatibility. Denied,
    // unavailable, stale and interrupted continuations must remain failures.
    if (first && /has no (query|update) method|method not found|is not a function/i.test(message)) {
      return { assets: await legacy(), next: null, bounded: false };
    }
    throw error;
  }
}